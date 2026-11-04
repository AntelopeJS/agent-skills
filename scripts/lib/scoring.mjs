/** @typedef {import("./dataset.mjs").EvalCase} EvalCase */
/** @typedef {import("./dataset.mjs").EvalStyle} EvalStyle */
/** @typedef {import("./dataset.mjs").EvalArea} EvalArea */

/**
 * How one case scored: the skills picked against the ones expected, as recall
 * and precision. `absent` are expected skills missing from the corpus; a case
 * left with no expected skill is `skipped`.
 * @typedef {object} CaseScore
 * @property {string} id
 * @property {EvalStyle} style
 * @property {EvalArea} area
 * @property {string[]} predicted
 * @property {string[]} expected
 * @property {string[]} absent
 * @property {string[]} missed
 * @property {string[]} extra
 * @property {string[]} avoided
 * @property {boolean} skipped
 * @property {number} recall
 * @property {number} precision
 */

/**
 * Mean recall and precision over some scored cases.
 * @typedef {object} ScoreAverages
 * @property {number} cases
 * @property {number} recall
 * @property {number} precision
 */

/**
 * The floors a summary has to reach.
 * @typedef {object} Thresholds
 * @property {number} minRecall
 * @property {number} minPrecision
 */

/**
 * @typedef {object} ScoreSummary
 * @property {number} scored
 * @property {number} skipped
 * @property {number} recall
 * @property {number} precision
 * @property {Record<string, ScoreAverages>} byStyle
 * @property {Thresholds} thresholds
 * @property {boolean} passed
 */

const PERCENT = 100;
const NOT_APPLICABLE = "-";

/**
 * @param {number} part
 * @param {number} whole
 * @param {number} empty
 * @returns {number}
 */
function ratio(part, whole, empty) {
  return whole === 0 ? empty : part / whole;
}

/**
 * Precision and recall of the skills an agent (or the baseline) picks for each
 * case, the overall summary against thresholds, and the printed table.
 *
 * Scores one case. Expected skills missing from the corpus are reported as
 * `absent` and left out of recall; when none is left the case is `skipped`.
 * @param {EvalCase} evalCase
 * @param {string[]} predicted
 * @param {Set<string>} corpusNames
 * @returns {CaseScore}
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

/**
 * @param {number[]} values
 * @returns {number}
 */
function mean(values) {
  return ratio(
    values.reduce((sum, value) => sum + value, 0),
    values.length,
    0,
  );
}

/**
 * @param {CaseScore[]} scores
 * @returns {ScoreAverages}
 */
function averages(scores) {
  return {
    cases: scores.length,
    recall: mean(scores.map((score) => score.recall)),
    precision: mean(scores.map((score) => score.precision)),
  };
}

/**
 * Macro averages over the scored cases, overall and per question style.
 * @param {CaseScore[]} scores
 * @param {{ minRecall?: number, minPrecision?: number }} [thresholds]
 * @returns {ScoreSummary}
 */
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

/**
 * @param {number} value
 * @returns {string}
 */
function percent(value) {
  return `${Math.round(value * PERCENT)}%`;
}

/**
 * @param {CaseScore} score
 * @returns {string[]}
 */
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

/**
 * @param {string[][]} rows
 * @returns {string}
 */
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

/**
 * @param {CaseScore[]} scores
 * @param {ScoreSummary} summary
 * @returns {string}
 */
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
