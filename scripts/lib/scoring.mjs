/**
 * Precision and recall of the skills an agent (or the baseline) picks for each
 * case, the overall summary against thresholds, and the printed table.
 */

const PERCENT = 100;
const NOT_APPLICABLE = "-";

function ratio(part, whole, empty) {
  return whole === 0 ? empty : part / whole;
}

/**
 * Scores one case. Expected skills missing from the corpus are reported as
 * `absent` and left out of recall; when none is left the case is `skipped`.
 */
export function scoreCase(evalCase, predicted, corpusNames) {
  const picked = [...new Set(predicted)];
  const expected = evalCase.expect.skills.filter((name) =>
    corpusNames.has(name),
  );
  const absent = evalCase.expect.skills.filter(
    (name) => !corpusNames.has(name),
  );
  const allowed = new Set([
    ...evalCase.expect.skills,
    ...(evalCase.expect.acceptable ?? []),
  ]);
  const avoided = (evalCase.expect.avoid ?? []).filter((name) =>
    picked.includes(name),
  );
  const hits = expected.filter((name) => picked.includes(name));
  const extra = picked.filter((name) => !allowed.has(name));
  return {
    id: evalCase.id,
    style: evalCase.style,
    area: evalCase.area,
    predicted: picked,
    expected,
    absent,
    missed: expected.filter((name) => !picked.includes(name)),
    extra,
    avoided,
    skipped: expected.length === 0,
    recall: ratio(hits.length, expected.length, 0),
    precision: ratio(picked.length - extra.length, picked.length, 1),
  };
}

function mean(values) {
  return ratio(
    values.reduce((sum, value) => sum + value, 0),
    values.length,
    0,
  );
}

function averages(scores) {
  return {
    cases: scores.length,
    recall: mean(scores.map((score) => score.recall)),
    precision: mean(scores.map((score) => score.precision)),
  };
}

/** Macro averages over the scored cases, overall and per question style. */
export function summarize(scores, { minRecall = 0, minPrecision = 0 } = {}) {
  const scored = scores.filter((score) => !score.skipped);
  const overall = averages(scored);
  const styles = [...new Set(scored.map((score) => score.style))];
  return {
    scored: scored.length,
    skipped: scores.length - scored.length,
    recall: overall.recall,
    precision: overall.precision,
    byStyle: Object.fromEntries(
      styles.map((style) => [
        style,
        averages(scored.filter((s) => s.style === style)),
      ]),
    ),
    thresholds: { minRecall, minPrecision },
    passed:
      scored.length > 0 &&
      overall.recall >= minRecall &&
      overall.precision >= minPrecision,
  };
}

function percent(value) {
  return `${Math.round(value * PERCENT)}%`;
}

function caseRow(score) {
  if (score.skipped)
    return [
      score.id,
      NOT_APPLICABLE,
      NOT_APPLICABLE,
      "skipped",
      `absent: ${score.absent.join(", ")}`,
    ];
  const notes = [
    score.missed.length ? `missed: ${score.missed.join(", ")}` : "",
    score.extra.length ? `extra: ${score.extra.join(", ")}` : "",
    score.avoided.length
      ? `avoided but picked: ${score.avoided.join(", ")}`
      : "",
  ].filter(Boolean);
  return [
    score.id,
    percent(score.recall),
    percent(score.precision),
    score.predicted.join(", ") || "(none)",
    notes.join("; "),
  ];
}

function render(rows) {
  const widths = rows[0].map((_, column) =>
    Math.max(...rows.map((row) => row[column].length)),
  );
  return rows
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column]))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

export function formatTable(scores, summary) {
  const header = ["CASE", "RECALL", "PRECISION", "PICKED", "NOTES"];
  const styleRows = Object.entries(summary.byStyle).map(([style, value]) => [
    `${style} (${value.cases})`,
    percent(value.recall),
    percent(value.precision),
    "",
    "",
  ]);
  const overall = [
    `overall (${summary.scored} scored, ${summary.skipped} skipped)`,
    percent(summary.recall),
    percent(summary.precision),
    "",
    "",
  ];
  return `${render([header, ...scores.map(caseRow)])}\n\n${render([["STYLE", "RECALL", "PRECISION", "", ""], ...styleRows, overall])}`;
}
