import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readJsonFile } from "./json.mjs";
import { fieldOf } from "./safe-read.mjs";
import { isText } from "./values.mjs";

export const RUBRIC_ROOT = fileURLToPath(
  new URL("../../evals/commands", import.meta.url),
);
export const MIN_RUBRIC_CASES = 3;
export const HARNESSES = ["claude", "codex", "amp"];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const MIN_TEXT = 10;
const MAX_CRITERIA = 6;
const MIN_CRITERIA = 3;

const LESSON_RE = /^https:\/\/\S+$/;

/**
 * @param {RegExp} pattern
 * @param {unknown} value
 * @returns {boolean}
 */
const matches = (pattern, value) => isText(value) && pattern.test(value);

/**
 * @param {unknown} value
 * @returns {boolean}
 */
const isSentence = (value) => isText(value) && value.length >= MIN_TEXT;

/**
 * @param {unknown} fixture
 * @param {string} suiteDir
 * @returns {string[]}
 */
function fixtureErrors(fixture, suiteDir) {
  const type = fieldOf(fixture, "type");
  if (type === "skeleton") {
    const dir = fieldOf(fixture, "dir");
    return existsSync(join(suiteDir, String(dir)))
      ? []
      : [`fixture directory ${String(dir)} does not exist`];
  }
  if (type === "repo")
    return matches(REPO_RE, fieldOf(fixture, "repo")) &&
      matches(SHA_RE, fieldOf(fixture, "sha"))
      ? []
      : ["a repo fixture needs repo (owner/name) and a 40-character sha"];
  return ["fixture must be a skeleton (dir) or a repo (repo, sha)"];
}

/**
 * @param {unknown} rubric
 * @param {unknown} lesson
 * @returns {string[]}
 */
function rubricErrors(rubric, lesson) {
  if (!Array.isArray(rubric)) return ["rubric must be a list"];
  const minimum = lesson ? 1 : MIN_CRITERIA;
  const ids = rubric.map((item) => fieldOf(item, "id"));
  return [
    ...(rubric.length < minimum || rubric.length > MAX_CRITERIA
      ? [`rubric needs ${minimum} to ${MAX_CRITERIA} criteria`]
      : []),
    ...(rubric.every(
      (item) =>
        matches(SLUG_RE, fieldOf(item, "id")) &&
        isSentence(fieldOf(item, "text")),
    )
      ? []
      : ["each criterion needs a kebab-case id and a text"]),
    ...(new Set(ids).size === ids.length ? [] : ["criterion ids repeat"]),
  ];
}

/**
 * @param {unknown} item
 * @param {string} suiteDir
 * @returns {string[]}
 */
function caseErrors(item, suiteDir) {
  const id = fieldOf(item, "id");
  const lesson = fieldOf(item, "lesson");
  const label = `case ${isText(id) ? id : "?"}`;
  return [
    ...(matches(SLUG_RE, id) ? [] : ["id must be kebab-case"]),
    ...(HARNESSES.some((harness) => harness === fieldOf(item, "harness"))
      ? []
      : [`harness must be one of ${HARNESSES.join(", ")}`]),
    ...(isSentence(fieldOf(item, "prompt"))
      ? []
      : ["prompt must be a sentence"]),
    ...fixtureErrors(fieldOf(item, "fixture"), suiteDir),
    ...rubricErrors(fieldOf(item, "rubric"), lesson),
    ...(lesson === undefined || matches(LESSON_RE, lesson)
      ? []
      : ["lesson must be an https URL"]),
  ].map((error) => `${label}: ${error}`);
}

/**
 * Problems of one rubric suite (`evals/commands/<skill>/cases.json`).
 * @param {unknown} suite
 * @param {string} suiteDir
 * @returns {string[]}
 */
export function suiteErrors(suite, suiteDir) {
  const cases = fieldOf(suite, "cases");
  if (!Array.isArray(cases)) return ["cases must be a list"];
  const ids = cases.map((item) => fieldOf(item, "id"));
  return [
    ...cases.flatMap((item) => caseErrors(item, suiteDir)),
    ...(new Set(ids).size === ids.length ? [] : ["case ids repeat"]),
    ...(cases.length >= MIN_RUBRIC_CASES
      ? []
      : [`needs at least ${MIN_RUBRIC_CASES} behaviour cases`]),
  ];
}

/**
 * Reads every rubric suite and returns the problems, prefixed by suite. A
 * suite directory must be named after a skill of the plugin.
 * @param {string[]} pluginSkills
 * @param {string} [root]
 * @returns {string[]}
 */
export function rubricErrorsOf(pluginSkills, root = RUBRIC_ROOT) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const suiteDir = join(root, entry.name);
      const file = join(suiteDir, "cases.json");
      if (!pluginSkills.includes(entry.name))
        return [`evals/commands/${entry.name}: not a skill of the plugin`];
      if (!existsSync(file))
        return [`evals/commands/${entry.name}: cases.json is missing`];
      return suiteErrors(readJsonFile(file), suiteDir).map(
        (error) => `evals/commands/${entry.name}: ${error}`,
      );
    });
}
