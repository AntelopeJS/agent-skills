import { existsSync } from "node:fs";
import { join } from "node:path";

import { loadDataset, CENTRAL_FILES } from "./dataset.mjs";

/** @typedef {import("./dataset.mjs").EvalCase} EvalCase */

/**
 * A case with the place it came from: `central`, or the name of the skill
 * whose `cases.json` holds it.
 * @typedef {EvalCase & { source: string }} SourcedCase
 */

/**
 * The cases of a run, and the central ones a skill's own case replaced.
 * @typedef {object} LoadedCases
 * @property {SourcedCase[]} cases
 * @property {SourcedCase[]} shadowed
 */

/**
 * A skill below the case minimum and what it lacks.
 * @typedef {object} CaseGap
 * @property {string} skill
 * @property {string[]} missing
 */

export const SKILL_CASES_FILE = "cases.json";
export const CENTRAL_SOURCE = "central";

/**
 * @param {EvalCase[]} cases
 * @param {string} source
 * @returns {SourcedCase[]}
 */
function withSource(cases, source) {
  return cases.map((item) => ({ ...item, source }));
}

/**
 * Collects the cases of a run: the central dataset, then each corpus skill's
 * own `cases.json`. A case id found twice keeps the skill-side case, so a
 * package can take over a central case without a second copy running.
 * @param {object} options
 * @param {{ name: string, dir: string }[]} options.skills
 * @param {string} [options.centralFile]
 * @returns {LoadedCases}
 */
export function loadCases({ skills, centralFile }) {
  const central = withSource(
    (centralFile ? [centralFile] : CENTRAL_FILES).flatMap(
      (file) => loadDataset(file).cases,
    ),
    CENTRAL_SOURCE,
  );
  const own = skills
    .filter((skill) => existsSync(join(skill.dir, SKILL_CASES_FILE)))
    .flatMap((skill) =>
      withSource(
        loadDataset(join(skill.dir, SKILL_CASES_FILE)).cases,
        skill.name,
      ),
    );
  const ownIds = new Set(own.map((item) => item.id));
  const seen = new Set();
  const cases = [
    ...own,
    ...central.filter((item) => !ownIds.has(item.id)),
  ].filter((item) => !seen.has(item.id) && seen.add(item.id));
  return { cases, shadowed: central.filter((item) => ownIds.has(item.id)) };
}

/**
 * An answers case checks the answer's content: names it must mention or avoid,
 * or a behaviour. Other cases are trigger cases only.
 * @param {EvalCase} evalCase
 * @returns {boolean}
 */
export function isAnswersCase(evalCase) {
  const { mustMention, mustNotMention, behaviour } = evalCase.expect;
  return Boolean(mustMention?.length || mustNotMention?.length || behaviour);
}

/**
 * @param {string} skill
 * @param {EvalCase[]} cases
 * @returns {string[]}
 */
function gapsOf(skill, cases) {
  const triggers = cases.filter((item) => item.expect.skills.includes(skill));
  /** @type {string[]} */
  const missing = [];
  if (!triggers.some((item) => item.style === "clean"))
    missing.push("a clean should-trigger case");
  if (!triggers.some((item) => item.style === "casual"))
    missing.push("a casual should-trigger case");
  if (!cases.some((item) => item.expect.avoid?.includes(skill)))
    missing.push("a should-not-trigger case aimed at its nearest neighbour");
  if (!triggers.some(isAnswersCase))
    missing.push("an answers case with mustMention or behaviour");
  return missing;
}

/**
 * The case minimum of decision 17: per skill, one clean and one casual
 * should-trigger case, one should-not-trigger case aimed at its nearest
 * neighbour and one answers case. Returns the skills below it.
 * @param {EvalCase[]} cases
 * @param {{ name: string }[]} skills
 * @returns {CaseGap[]}
 */
export function minimumGaps(cases, skills) {
  return skills
    .map((skill) => ({ skill: skill.name, missing: gapsOf(skill.name, cases) }))
    .filter((gap) => gap.missing.length);
}
