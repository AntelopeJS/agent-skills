import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  EXIT,
  fail,
  listOption,
  parseCount,
  parseRatio,
} from "./eval-options.mjs";
import {
  DEFAULT_EFFORT,
  DEFAULT_MAX_BUDGET_USD,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_SECONDS,
  withoutCredentials,
} from "./seeded-agent.mjs";
import {
  KINDS,
  discoverCases,
  pickSkill,
  selectSeeded,
} from "./seeded-cases.mjs";
import { trapInterrupt } from "./seeded-interrupt.mjs";
import { runSeeded } from "./seeded-run.mjs";
import {
  excuseControlGaps,
  formatSeeded,
  summarizeSeeded,
  totals,
} from "./seeded-score.mjs";
import { DEFAULT_SETUP } from "./seeded-scratch.mjs";
import { TEARDOWNS } from "./seeded-teardown.mjs";

/**
 * The options `evals seeded` reads, as `parseArgs` returns them for OPTIONS in
 * eval-options.mjs: the text options are strings, the flags booleans, and each
 * is absent when not given.
 * @typedef {{
 *   repo?: string,
 *   skill?: string,
 *   ref?: string,
 *   modes?: string,
 *   only?: string,
 *   "min-catch"?: string,
 *   "min-door-catch"?: string,
 *   "min-clean"?: string,
 *   model?: string,
 *   effort?: string,
 *   "max-budget"?: string,
 *   timeout?: string,
 *   jobs?: string,
 *   setup?: string,
 *   teardown?: string,
 *   "pass-env"?: string,
 *   "cache-home"?: string,
 *   out?: string,
 *   scratch?: string,
 *   "keep-scratch"?: boolean,
 *   resume?: boolean,
 *   "claude-bin"?: string,
 *   json?: boolean,
 * }} SeededValues
 */

/** @typedef {import("./seeded-run.mjs").SeededOptions} SeededOptions */
/** @typedef {import("./seeded-score.mjs").CaseResult} CaseResult */

export const DEFAULT_JOBS = 3;

/**
 * @param {string | undefined} value
 * @returns {string[]}
 */
function modesOf(value) {
  const modes = listOption(value);
  const unknown = modes.filter((mode) => !KINDS.includes(mode));
  if (unknown.length) fail(`--modes takes ${KINDS.join(", ")}`);
  return modes;
}

/**
 * @param {SeededValues} values
 * @returns {SeededOptions}
 */
function optionsOf(values) {
  return {
    jobs: parseCount(values.jobs, "jobs", DEFAULT_JOBS),
    model: values.model ?? DEFAULT_MODEL,
    effort: values.effort ?? DEFAULT_EFFORT,
    maxBudget: Number(values["max-budget"] ?? DEFAULT_MAX_BUDGET_USD),
    timeoutSeconds: parseCount(
      values.timeout,
      "timeout",
      DEFAULT_TIMEOUT_SECONDS,
    ),
    claudeBin: values["claude-bin"] ?? "claude",
    setup: values.setup ?? DEFAULT_SETUP,
    setupEnv: withoutCredentials(process.env),
    scratchRoot: values.scratch ? resolve(values.scratch) : tmpdir(),
    keepScratch: Boolean(values["keep-scratch"]),
    resume: Boolean(values.resume),
    passEnv: listOption(values["pass-env"]),
    cacheHome: values["cache-home"] ? resolve(values["cache-home"]) : undefined,
    ref: values.ref ?? "HEAD",
  };
}

/**
 * `evals seeded --repo <checkout>`: for each seeded break, applies the patch to
 * a scratch checkout and has a headless verifier follow the repo's verification
 * skill, which must return FAIL naming the feature; for each seeded door, the
 * One-way doors section must name its kind; the unpatched head must not FAIL.
 * Exits 1 under `--min-catch` or `--min-door-catch`, or on a false alarm. On
 * SIGINT or SIGTERM it stops every live case (agent, harness run, scratch
 * folders), writes the partial summary with the interrupted cases marked and
 * exits 128 plus the signal number; a second signal kills the stop commands
 * and exits at once.
 * @param {SeededValues} values
 * @returns {Promise<number>} The process exit code.
 */
export async function seeded(values) {
  if (!values.repo) fail("seeded needs --repo <checkout>");
  const checkout = resolve(values.repo);
  let skill;
  try {
    skill = pickSkill(checkout, values.skill);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  const cases = selectSeeded(discoverCases(checkout, skill), {
    modes: modesOf(values.modes),
    only: listOption(values.only),
  });
  if (!cases.length) fail("no seeded case matches --modes/--only");
  const options = {
    ...optionsOf(values),
    teardown: values.teardown ?? TEARDOWNS[skill],
  };
  const out = values.out
    ? resolve(values.out)
    : mkdtempSync(join(tmpdir(), "seeded-eval-out-"));
  mkdirSync(out, { recursive: true });
  const trap = trapInterrupt();
  let results;
  try {
    results = await runSeeded({
      checkout,
      skill,
      cases,
      out,
      options: {
        ...options,
        signal: trap.signal,
        forceSignal: trap.forceSignal,
      },
    });
  } finally {
    trap.release();
  }
  results = excuseControlGaps(results);
  const summary = summarizeSeeded(results, {
    minCatch: parseRatio(values["min-catch"], "min-catch"),
    minDoorCatch: parseRatio(values["min-door-catch"], "min-door-catch"),
    minClean: parseRatio(values["min-clean"], "min-clean"),
  });
  const report = formatSeeded({
    repo: skill.replace(/^verify-/, ""),
    skill,
    model: `${options.model} (effort ${options.effort})`,
    results,
    summary,
  });
  writeFileSync(
    join(out, "summary.json"),
    `${JSON.stringify({ skill, summary, totals: totals(results), results }, null, 2)}\n`,
  );
  writeFileSync(join(out, "report.md"), `${report}\n`);
  process.stdout.write(
    values.json
      ? `${JSON.stringify({ mode: "seeded", skill, summary, totals: totals(results), results }, null, 2)}\n`
      : `${report}\n\nResults: ${out}\n`,
  );
  return trap.exitCode ?? (summary.passed ? EXIT.ok : EXIT.failed);
}
