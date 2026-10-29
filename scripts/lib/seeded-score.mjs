const PERCENT = 100;
const OK_LABELS = {
  break: "caught",
  door: "caught",
  control: "no alarm",
  touched: "no alarm",
};
const COST_DIGITS = 2;
const SECONDS = 1000;

const ofFeature = (entry, feature) =>
  entry.toLowerCase() === feature.toLowerCase() ||
  entry.toLowerCase().startsWith(`${feature.toLowerCase()}/`);

/**
 * Judges one case from the verdict the verifier returned. A break is caught
 * when the verdict is FAIL, names the feature and the feature's journeys ran
 * (a FAIL for journeys that could not start proves nothing); a door is caught when the
 * One-way doors section names its kind; the unpatched head passes when the
 * verdict is not FAIL. A case with no verdict is an error and counts as missed;
 * an interrupted case is neither caught nor missed.
 */
export function judgeCase(item, outcome) {
  const { verdict } = outcome;
  if (outcome.interrupted)
    return { passed: false, status: "interrupted", why: outcome.error };
  if (!verdict) return { passed: false, status: "error", why: outcome.error };
  const named = (names, wanted) =>
    names.some((name) => name.toLowerCase() === wanted.toLowerCase());
  const falseAlarm = () =>
    verdict.result === "FAIL"
      ? `false alarm: FAIL naming ${verdict.failedFeatures.join(", ") || "no feature"}`
      : undefined;
  const checks = {
    break: () => {
      if (
        verdict.result !== "FAIL" ||
        !named(verdict.failedFeatures, item.subject)
      )
        return `expected FAIL naming ${item.subject}, got ${verdict.result} naming ${verdict.failedFeatures.join(", ") || "no feature"}`;
      const skipped = verdict.notRun.filter((entry) =>
        ofFeature(entry, item.subject),
      );
      return skipped.length
        ? `FAIL naming ${item.subject}, but its journeys did not run: ${skipped.join(", ")}`
        : undefined;
    },
    door: () =>
      named(verdict.doors, item.subject)
        ? undefined
        : `expected the door kind ${item.subject}, got ${verdict.doors.join(", ") || "none"}`,
    control: falseAlarm,
    touched: falseAlarm,
  };
  const why = checks[item.kind]();
  return { passed: !why, status: why ? "wrong" : "ok", why };
}

/**
 * Counts a break as caught when its FAIL names the feature and the only
 * journeys of that feature that did not run are journeys that do not pass on
 * the unpatched head either: a journey that is never verified there (a SaaS
 * sandbox without keys) cannot be required to run for the catch. The
 * unpatched head is the control when its verdict covers the feature, else the
 * feature's touched twin; with neither, the break keeps its strict judgement.
 */
export function excuseControlGaps(results) {
  const control = results.find((result) => result.kind === "control");
  const baselineOf = (feature) => {
    const covers = (verdict) =>
      verdict &&
      [...verdict.passed, ...verdict.notRun].some((entry) =>
        ofFeature(entry, feature),
      );
    if (covers(control?.verdict)) return control.verdict;
    const twin = results.find(
      (result) => result.kind === "touched" && result.subject === feature,
    );
    return covers(twin?.verdict) ? twin.verdict : undefined;
  };
  return results.map((result) => {
    const verdict = result.verdict;
    if (result.kind !== "break" || result.passed || !verdict) return result;
    const names = verdict.failedFeatures.map((name) => name.toLowerCase());
    if (
      verdict.result !== "FAIL" ||
      !names.includes(result.subject.toLowerCase())
    )
      return result;
    const skipped = verdict.notRun.filter((entry) =>
      ofFeature(entry, result.subject),
    );
    const baseline = baselineOf(result.subject);
    const passing = new Set(
      (baseline?.passed ?? []).map((entry) => entry.toLowerCase()),
    );
    if (
      !baseline ||
      !skipped.length ||
      skipped.some((entry) => passing.has(entry.toLowerCase()))
    )
      return result;
    return {
      ...result,
      passed: true,
      status: "ok",
      why: `caught; ${skipped.join(", ")} do not pass on the unpatched head either`,
    };
  });
}

function rate(results, kind) {
  const of = results.filter(
    (result) => result.kind === kind && result.status !== "interrupted",
  );
  return {
    total: of.length,
    caught: of.filter((result) => result.passed).length,
    rate: of.length
      ? of.filter((result) => result.passed).length / of.length
      : undefined,
    missed: of.filter((result) => !result.passed).map((result) => result.id),
  };
}

function separation(all) {
  const results = all.filter((result) => result.status !== "interrupted");
  const twins = new Map(
    results
      .filter((result) => result.kind === "touched")
      .map((result) => [result.subject, result]),
  );
  const breaks = results.filter((result) => result.kind === "break");
  const withTwin = breaks.filter((item) => twins.has(item.subject));
  const failing = (item) => {
    const twin = twins.get(item.subject);
    return twin.status === "wrong" && !twin.passed;
  };
  const clean = withTwin.filter((item) => twins.get(item.subject).passed);
  return {
    total: clean.length,
    caught: clean.filter((item) => item.passed).length,
    rate: clean.length
      ? clean.filter((item) => item.passed).length / clean.length
      : undefined,
    missed: clean.filter((item) => !item.passed).map((item) => item.id),
    indistinct: withTwin.filter(failing).map((item) => item.id),
  };
}

/**
 * The catch rate of the seeded breaks, the door catch rate and the control,
 * with the gates: `minCatch`, `minDoorCatch` and `minClean` (the touched
 * heads that did not FAIL) are ratios, and a control that returned FAIL (a
 * false alarm) or never finished fails the run whatever the gates. A touched
 * head gates only under `minClean`: a feature with known findings fails its
 * verdict by the skill's own rule whenever a diff touches it.
 */
export function summarizeSeeded(
  results,
  { minCatch, minDoorCatch, minClean } = {},
) {
  const breaks = rate(results, "break");
  const doors = rate(results, "door");
  const control = rate(results, "control");
  const touched = rate(results, "touched");
  const failures = [];
  if (minCatch !== undefined && (breaks.rate ?? 0) < minCatch)
    failures.push(
      `catch rate ${format(breaks.rate)} is under ${format(minCatch)}: ${breaks.missed.join(", ") || "no break ran"}`,
    );
  if (minDoorCatch !== undefined && (doors.rate ?? 0) < minDoorCatch)
    failures.push(
      `door catch rate ${format(doors.rate)} is under ${format(minDoorCatch)}: ${doors.missed.join(", ") || "no door ran"}`,
    );
  if (control.missed.length)
    failures.push("the unpatched head returned FAIL or no verdict");
  if (minClean !== undefined && (touched.rate ?? 0) < minClean)
    failures.push(
      `clean rate with a feature touched ${format(touched.rate)} is under ${format(minClean)}: ${touched.missed.join(", ") || "no touched case ran"}`,
    );
  const interrupted = results.filter(
    (result) => result.status === "interrupted",
  );
  if (interrupted.length)
    failures.push(
      `interrupted: ${interrupted.length} case(s) did not finish, rates cover the others: ${interrupted.map((result) => result.id).join(", ")}`,
    );
  const leaking = results.filter((result) => result.leaked?.length);
  if (leaking.length)
    failures.push(
      `${leaking.length} case(s) left processes running (pids ${leaking.flatMap((result) => result.leaked.map((entry) => entry.pid)).join(", ")}): ${leaking.map((result) => result.id).join(", ")}`,
    );
  return {
    breaks,
    doors,
    control,
    touched,
    separated: separation(results),
    interrupted: interrupted.map((result) => result.id),
    failures,
    passed: !failures.length,
  };
}

function format(ratio) {
  return ratio === undefined ? "n/a" : `${(ratio * PERCENT).toFixed(0)}%`;
}

function fraction({ caught, total, rate: value }) {
  return total ? `${caught}/${total} (${format(value)})` : "none ran";
}

export function totals(results) {
  const sum = (pick) =>
    results.reduce((total, result) => total + (pick(result) ?? 0), 0);
  return {
    cases: results.length,
    costUsd: sum((result) => result.costUsd),
    wallMs: sum((result) => result.wallMs),
    inputTokens: sum((result) => result.tokens?.input),
    outputTokens: sum((result) => result.tokens?.output),
    cacheReadTokens: sum((result) => result.tokens?.cacheRead),
    cacheWriteTokens: sum((result) => result.tokens?.cacheWrite),
  };
}

const minutes = (ms) => `${(ms / SECONDS / 60).toFixed(1)} min`;
const dollars = (value) =>
  value === undefined ? "n/a" : `$${value.toFixed(COST_DIGITS)}`;

/** The table, rates and cost of a run, as Markdown. */
export function formatSeeded({ repo, skill, model, results, summary }) {
  const sum = totals(results);
  const mean = (value) => (results.length ? value / results.length : 0);
  const outcome = (result) => {
    if (result.status === "interrupted") return "INTERRUPTED";
    if (result.status === "error") return "ERROR";
    if (!result.passed) return "MISSED";
    return OK_LABELS[result.kind];
  };
  const rows = results.map(
    (result) =>
      `| ${result.id} | ${outcome(result)} | ${result.verdict?.result ?? "none"} | ${minutes(result.wallMs)} | ${dollars(result.costUsd)} | ${result.turns ?? "n/a"} |${result.why ? ` ${result.why}` : ""}`,
  );
  return [
    `Repo: ${repo} (${skill}). Model: ${model}.`,
    "",
    "| Case | Outcome | Verdict | Wall | Cost | Turns | Note |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    `Catch rate (seeded breaks): ${fraction(summary.breaks)}`,
    `Door catch rate (seeded doors): ${fraction(summary.doors)}`,
    `Unpatched head (no false alarm): ${fraction(summary.control)}`,
    `Unpatched head with a feature touched (no false alarm): ${fraction(summary.touched)}`,
    `Catch rate where the head with the feature touched does not FAIL (the break is what fails): ${fraction(summary.separated)}${summary.separated.indistinct.length ? `; the touched head FAILs too, so the catch cannot be told from known findings: ${summary.separated.indistinct.join(", ")}` : ""}`,
    `Cost per case: ${dollars(mean(sum.costUsd))}, ${minutes(mean(sum.wallMs))}, ${Math.round(mean(sum.inputTokens + sum.cacheReadTokens + sum.cacheWriteTokens))} input tokens (cache included), ${Math.round(mean(sum.outputTokens))} output tokens. Total ${dollars(sum.costUsd)} over ${sum.cases} cases.`,
    ...summary.failures.map((failure) => `FAIL: ${failure}`),
  ].join("\n");
}
