/**
 * The eval dataset (`evals/cases.json`) and its schema check. Each case is a
 * user prompt and the skills an agent should load for it; optional fields feed
 * the answer-quality eval (API names to mention or avoid, expected behaviour).
 */

import { fileURLToPath } from "node:url";

import { readJsonFile } from "./json.mjs";
import { isRecord, isText } from "./values.mjs";

/** @typedef {"framework" | "dms" | "dms-ai" | "modules" | "install" | "verify"} EvalArea */
/** @typedef {"clean" | "casual"} EvalStyle */
/** @typedef {"asks-first"} EvalBehaviour */

/**
 * What a case checks. `skills` are the skills to load; `acceptable` ones cost
 * no precision; `avoid` ones must not be picked; `mustMention` and
 * `mustNotMention` are API names the answer needs or must not contain.
 * @typedef {object} EvalExpect
 * @property {string[]} skills
 * @property {string[]} [acceptable]
 * @property {string[]} [mustMention]
 * @property {string[]} [mustNotMention]
 * @property {EvalBehaviour} [behaviour]
 * @property {string[]} [avoid]
 */

/**
 * One case of the eval dataset: a user prompt and what an agent should do with it.
 * @typedef {object} EvalCase
 * @property {string} id
 * @property {EvalArea} area
 * @property {EvalStyle} style
 * @property {string} prompt
 * @property {"docs-assistant"} [origin]
 * @property {EvalExpect} expect
 */

/**
 * A dataset file.
 * @typedef {object} Dataset
 * @property {number} version
 * @property {EvalCase[]} cases
 */

/**
 * A field rule: its check, then what the field must be, for the error message.
 * @typedef {[(value: unknown) => boolean, string]} FieldRule
 */

export const DATASET_FILE = fileURLToPath(
  new URL("../../evals/cases.json", import.meta.url),
);
export const VERIFY_CASES_FILE = fileURLToPath(
  new URL("../../evals/verify-cases.json", import.meta.url),
);
/** The central datasets: the routing cases, then the verification skills' trigger cases. */
export const CENTRAL_FILES = [DATASET_FILE, VERIFY_CASES_FILE];
export const DATASET_VERSION = 1;
/** @type {EvalArea[]} */
export const AREAS = [
  "framework",
  "dms",
  "dms-ai",
  "modules",
  "install",
  "verify",
];
/** @type {EvalStyle[]} */
export const STYLES = ["clean", "casual"];
export const ORIGINS = ["docs-assistant"];
/**
 * `asks-first`: the answer asks the user a question before writing any code.
 * @type {EvalBehaviour[]}
 */
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

/**
 * @param {unknown} value
 * @returns {value is string}
 */
const isNonEmptyString = (value) => isText(value) && value.trim().length > 0;
/**
 * @param {unknown} value
 * @returns {value is string[]}
 */
const isStringList = (value) =>
  Array.isArray(value) && value.every(isNonEmptyString);
/**
 * @param {unknown} value
 * @returns {value is string[]}
 */
const isSkillList = (value) =>
  isStringList(value) && value.every((name) => SKILL_NAME_RE.test(name));
/**
 * @param {readonly unknown[]} allowed
 * @returns {(value: unknown) => boolean}
 */
const oneOf = (allowed) => (value) => allowed.includes(value);
/**
 * @param {(value: unknown) => boolean} check
 * @returns {(value: unknown) => boolean}
 */
const optional = (check) => (value) => value === undefined || check(value);

/** @type {Record<string, FieldRule>} */
const CASE_FIELDS = {
  id: [(value) => isText(value) && ID_RE.test(value), "a kebab-case string"],
  area: [oneOf(AREAS), `one of ${AREAS.join(", ")}`],
  style: [oneOf(STYLES), `one of ${STYLES.join(", ")}`],
  prompt: [isNonEmptyString, "a non-empty string"],
  origin: [optional(oneOf(ORIGINS)), `one of ${ORIGINS.join(", ")}`],
};

/** @type {Record<string, FieldRule>} */
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

/**
 * @param {Record<string, unknown>} value
 * @param {Record<string, FieldRule>} fields
 * @param {string} prefix
 * @returns {string[]}
 */
function checkFields(value, fields, prefix) {
  return Object.entries(fields)
    .filter(([key, [check]]) => !check(value[key]))
    .map(([key, [, expected]]) => `${prefix}${key} must be ${expected}`);
}

/**
 * @param {Record<string, unknown>} value
 * @param {string[]} allowed
 * @param {string} prefix
 * @returns {string[]}
 */
function unknownKeys(value, allowed, prefix) {
  return Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .map((key) => `${prefix}${key} is not a known field`);
}

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
function listOf(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * @param {unknown} expect
 * @returns {string[]}
 */
function expectErrors(expect) {
  if (!isRecord(expect)) return ["expect must be an object"];
  const skills = listOf(expect.skills);
  const allowed = [...skills, ...listOf(expect.acceptable)];
  const overlap = listOf(expect.acceptable).filter((name) =>
    skills.includes(name),
  );
  const contradiction = listOf(expect.avoid).filter((name) =>
    allowed.includes(name),
  );
  return [
    ...checkFields(expect, EXPECT_FIELDS, "expect."),
    ...unknownKeys(expect, EXPECT_KEYS, "expect."),
    ...overlap.map(
      (name) => `expect.acceptable repeats the expected skill ${String(name)}`,
    ),
    ...contradiction.map(
      (name) =>
        `expect.avoid lists ${String(name)}, which the case also allows`,
    ),
  ];
}

/**
 * @param {unknown} item
 * @param {number} index
 * @returns {string[]}
 */
function caseErrors(item, index) {
  if (!isRecord(item)) return [`case #${index} must be an object`];
  const label = `case ${isText(item.id) ? item.id : `#${index}`}`;
  const errors = [
    ...checkFields(item, CASE_FIELDS, ""),
    ...unknownKeys(item, CASE_KEYS, ""),
    ...expectErrors(item.expect),
  ];
  return errors.map((error) => `${label}: ${error}`);
}

/**
 * @param {unknown[]} cases
 * @returns {string[]}
 */
function duplicateIds(cases) {
  /** @type {Set<unknown>} */
  const seen = new Set();
  const duplicates = cases
    .map((item) => (isRecord(item) ? item.id : undefined))
    .filter((id) => seen.has(id) || !seen.add(id));
  return [...new Set(duplicates)].map(
    (id) => `duplicate case id ${String(id)}`,
  );
}

/**
 * Returns the list of schema problems; empty when the dataset is valid.
 * @param {unknown} dataset
 * @returns {string[]}
 */
export function validateDataset(dataset) {
  if (!isRecord(dataset) || dataset.version !== DATASET_VERSION)
    return [`version must be ${DATASET_VERSION}`];
  if (!Array.isArray(dataset.cases)) return ["cases must be an array"];
  return [...dataset.cases.flatMap(caseErrors), ...duplicateIds(dataset.cases)];
}

/**
 * Whether `value` passes every check of `validateDataset`.
 * @param {unknown} value
 * @returns {value is Dataset}
 */
function isDataset(value) {
  return validateDataset(value).length === 0;
}

/**
 * @param {string | URL} [file]
 * @returns {Dataset}
 */
export function loadDataset(file = DATASET_FILE) {
  const dataset = readJsonFile(file);
  if (isDataset(dataset)) return dataset;
  const errors = validateDataset(dataset);
  throw new Error(
    `invalid dataset (${errors.length} problems):\n  ${errors.join("\n  ")}`,
  );
}
