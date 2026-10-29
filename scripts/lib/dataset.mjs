// The eval dataset (`evals/cases.json`) and its schema check. Each case is a
// user prompt and the skills an agent should load for it; optional fields feed
// the answer-quality eval (API names to mention or avoid, expected behaviour).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DATASET_FILE = fileURLToPath(
  new URL("../../evals/cases.json", import.meta.url),
);
export const VERIFY_CASES_FILE = fileURLToPath(
  new URL("../../evals/verify-cases.json", import.meta.url),
);
/** The central datasets: the routing cases, then the verification skills' trigger cases. */
export const CENTRAL_FILES = [DATASET_FILE, VERIFY_CASES_FILE];
export const DATASET_VERSION = 1;
export const AREAS = [
  "framework",
  "dms",
  "dms-ai",
  "modules",
  "install",
  "verify",
];
export const STYLES = ["clean", "casual"];
export const ORIGINS = ["docs-assistant"];
/** `asks-first`: the answer asks the user a question before writing any code. */
export const BEHAVIOURS = ["asks-first"];

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_NAME_RE = /^[a-z0-9]+(?:[-:][a-z0-9]+)*$/;
const CASE_KEYS = ["id", "area", "style", "prompt", "origin", "expect"];
const EXPECT_KEYS = [
  "skills",
  "acceptable",
  "mustMention",
  "mustNotMention",
  "behaviour",
  "avoid",
];

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;
const isStringList = (value) =>
  Array.isArray(value) && value.every(isNonEmptyString);
const isSkillList = (value) =>
  isStringList(value) && value.every((name) => SKILL_NAME_RE.test(name));
const oneOf = (allowed) => (value) => allowed.includes(value);
const optional = (check) => (value) => value === undefined || check(value);

const CASE_FIELDS = {
  id: [
    (value) => typeof value === "string" && ID_RE.test(value),
    "a kebab-case string",
  ],
  area: [oneOf(AREAS), `one of ${AREAS.join(", ")}`],
  style: [oneOf(STYLES), `one of ${STYLES.join(", ")}`],
  prompt: [isNonEmptyString, "a non-empty string"],
  origin: [optional(oneOf(ORIGINS)), `one of ${ORIGINS.join(", ")}`],
};

const EXPECT_FIELDS = {
  skills: [
    (value) => isSkillList(value) && value.length > 0,
    "a non-empty list of skill names",
  ],
  acceptable: [optional(isSkillList), "a list of skill names"],
  mustMention: [optional(isStringList), "a list of strings"],
  mustNotMention: [optional(isStringList), "a list of strings"],
  avoid: [optional(isSkillList), "a list of skill names"],
  behaviour: [optional(oneOf(BEHAVIOURS)), `one of ${BEHAVIOURS.join(", ")}`],
};

function checkFields(value, fields, prefix) {
  return Object.entries(fields)
    .filter(([key, [check]]) => !check(value[key]))
    .map(([key, [, expected]]) => `${prefix}${key} must be ${expected}`);
}

function unknownKeys(value, allowed, prefix) {
  return Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .map((key) => `${prefix}${key} is not a known field`);
}

function expectErrors(expect) {
  if (!expect || typeof expect !== "object")
    return ["expect must be an object"];
  const allowed = [...(expect.skills ?? []), ...(expect.acceptable ?? [])];
  const overlap = (expect.acceptable ?? []).filter((name) =>
    expect.skills?.includes(name),
  );
  const contradiction = (expect.avoid ?? []).filter((name) =>
    allowed.includes(name),
  );
  return [
    ...checkFields(expect, EXPECT_FIELDS, "expect."),
    ...unknownKeys(expect, EXPECT_KEYS, "expect."),
    ...overlap.map(
      (name) => `expect.acceptable repeats the expected skill ${name}`,
    ),
    ...contradiction.map(
      (name) => `expect.avoid lists ${name}, which the case also allows`,
    ),
  ];
}

function caseErrors(item, index) {
  if (!item || typeof item !== "object")
    return [`case #${index} must be an object`];
  const label = `case ${typeof item.id === "string" ? item.id : `#${index}`}`;
  const errors = [
    ...checkFields(item, CASE_FIELDS, ""),
    ...unknownKeys(item, CASE_KEYS, ""),
    ...expectErrors(item.expect),
  ];
  return errors.map((error) => `${label}: ${error}`);
}

function duplicateIds(cases) {
  const seen = new Set();
  const duplicates = cases
    .map((item) => item?.id)
    .filter((id) => seen.has(id) || !seen.add(id));
  return [...new Set(duplicates)].map((id) => `duplicate case id ${id}`);
}

/** Returns the list of schema problems; empty when the dataset is valid. */
export function validateDataset(dataset) {
  if (dataset?.version !== DATASET_VERSION)
    return [`version must be ${DATASET_VERSION}`];
  if (!Array.isArray(dataset.cases)) return ["cases must be an array"];
  return [...dataset.cases.flatMap(caseErrors), ...duplicateIds(dataset.cases)];
}

export function loadDataset(file = DATASET_FILE) {
  const dataset = JSON.parse(readFileSync(file, "utf8"));
  const errors = validateDataset(dataset);
  if (errors.length)
    throw new Error(
      `invalid dataset (${errors.length} problems):\n  ${errors.join("\n  ")}`,
    );
  return dataset;
}
