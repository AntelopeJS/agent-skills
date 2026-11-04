/** @typedef {import("./dataset.mjs").EvalCase} EvalCase */
/** @typedef {import("./matrix.mjs").MatrixEntry} MatrixEntry */
/** @typedef {import("./run-score.mjs").ScoredRun} ScoredRun */

/**
 * One model's answers: which of its cases passed, by case id.
 * @typedef {object} Answered
 * @property {MatrixEntry} model
 * @property {Map<string, EvalCase>} byCase
 * @property {Map<string, boolean>} results
 */

/**
 * How many of a skill's cases pass with the skills loaded, without, and the case count.
 * @typedef {object} Tally
 * @property {number} now
 * @property {number} base
 * @property {number} total
 */

/**
 * A skill's lift on one model.
 * @typedef {object} ModelLift
 * @property {string} model
 * @property {number} withScore
 * @property {number} withoutScore
 * @property {number} lift
 * @property {number} cases
 */

/**
 * A skill's lift over the models.
 * @typedef {object} SkillLift
 * @property {string} skill
 * @property {ModelLift[]} models
 * @property {number} meanLift
 * @property {boolean} noLift
 */

const PERCENT = 100;

/**
 * @param {ScoredRun} scored
 * @returns {Answered[]}
 */
function answered(scored) {
  const byCase = new Map(scored.manifest.cases.map((item) => [item.id, item]));
  return scored.models.map(({ model, answers }) => ({
    model,
    byCase,
    results: new Map(
      answers
        .filter((answer) => !answer.runs.some((run) => run.missing))
        .map((answer) => [answer.id, answer.pass]),
    ),
  }));
}

/**
 * @param {Map<string, boolean>} withResults
 * @param {Map<string, boolean>} withoutResults
 * @param {Map<string, EvalCase>} byCase
 * @returns {Map<string, Tally>}
 */
function tally(withResults, withoutResults, byCase) {
  /** @type {Map<string, Tally>} */
  const bySkill = new Map();
  for (const [id, passed] of withResults) {
    if (!withoutResults.has(id)) continue;
    for (const skill of byCase.get(id).expect.skills) {
      const entry = bySkill.get(skill) ?? { now: 0, base: 0, total: 0 };
      bySkill.set(skill, {
        now: entry.now + (passed ? 1 : 0),
        base: entry.base + (withoutResults.get(id) ? 1 : 0),
        total: entry.total + 1,
      });
    }
  }
  return bySkill;
}

/**
 * The baseline lift of decision 5: per skill and model, the share of its
 * answers cases that pass with the skills loaded against with none loaded.
 * Cases missing an answer in either run are left out, and a skill left with
 * no case on a model has no entry for it. A skill has no lift when its mean
 * lift over the models that ran is not above zero.
 * @param {ScoredRun} withSkills
 * @param {ScoredRun} withoutSkills
 * @returns {SkillLift[]}
 */
export function computeLift(withSkills, withoutSkills) {
  const before = answered(withoutSkills);
  /** @type {Map<string, ModelLift[]>} */
  const rows = new Map();
  answered(withSkills).forEach(({ model, byCase, results }, index) => {
    const bySkill = tally(results, before[index].results, byCase);
    for (const [skill, count] of bySkill) {
      rows.set(skill, [
        ...(rows.get(skill) ?? []),
        {
          model: model.id,
          withScore: count.now / count.total,
          withoutScore: count.base / count.total,
          lift: (count.now - count.base) / count.total,
          cases: count.total,
        },
      ]);
    }
  });
  return [...rows]
    .map(([skill, models]) => {
      const meanLift =
        models.reduce((sum, item) => sum + item.lift, 0) / models.length;
      return { skill, models, meanLift, noLift: meanLift <= 0 };
    })
    .sort((left, right) => left.skill.localeCompare(right.skill));
}

/**
 * @param {number} value
 * @returns {string}
 */
const pct = (value) => `${Math.round(value * PERCENT)}%`;
/**
 * @param {number} value
 * @returns {string}
 */
const signed = (value) =>
  `${value > 0 ? "+" : ""}${Math.round(value * PERCENT)}`;

/**
 * One Markdown table: skill, per-model cases / with / without / lift, mean
 * lift. A model with no case run for a skill reads "not run".
 * @param {SkillLift[]} rows
 * @param {string[]} [modelIds]
 * @returns {string}
 */
export function formatLift(rows, modelIds) {
  const ids = modelIds ?? [
    ...new Set(rows.flatMap((row) => row.models.map((item) => item.model))),
  ];
  const header = [
    "Skill",
    ...ids.map((id) => `${id} (cases: with / without / lift)`),
    "Mean lift",
  ];
  /** @param {string[]} cells */
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [
    line(header),
    line(header.map(() => "---")),
    ...rows.map((row) =>
      line([
        row.skill,
        ...ids.map((id) => {
          const item = row.models.find((entry) => entry.model === id);
          return item
            ? `${item.cases}: ${pct(item.withScore)} / ${pct(item.withoutScore)} / ${signed(item.lift)}`
            : "not run";
        }),
        `${signed(row.meanLift)}${row.noLift ? " (no lift)" : ""}`,
      ]),
    ),
  ].join("\n");
}
