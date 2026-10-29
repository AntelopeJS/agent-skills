import { existsSync } from "node:fs";
import { join } from "node:path";

import { loadDataset, CENTRAL_FILES } from "./dataset.mjs";

export const SKILL_CASES_FILE = "cases.json";
export const CENTRAL_SOURCE = "central";

function withSource(cases, source) {
  return cases.map((item) => ({ ...item, source }));
}

/**
 * Collects the cases of a run: the central dataset, then each corpus skill's
 * own `cases.json`. A case id found twice keeps the skill-side case, so a
 * package can take over a central case without a second copy running.
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
 */
export function isAnswersCase(evalCase) {
  const { mustMention, mustNotMention, behaviour } = evalCase.expect;
  return Boolean(mustMention?.length || mustNotMention?.length || behaviour);
}

function gapsOf(skill, cases) {
  const triggers = cases.filter((item) => item.expect.skills.includes(skill));
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
 */
export function minimumGaps(cases, skills) {
  return skills
    .map((skill) => ({ skill: skill.name, missing: gapsOf(skill.name, cases) }))
    .filter((gap) => gap.missing.length);
}
