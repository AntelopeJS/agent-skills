import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readJsonFile } from "./json.mjs";
import { fieldOf } from "./safe-read.mjs";

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

const isText = (value) => String(value ?? "").length >= MIN_TEXT;

/**
 * @param {string} suiteDir
 * @returns {string[]}
 */
function fixtureErrors(fixture, suiteDir) {
  if (fixture?.type === "skeleton")
    return existsSync(join(suiteDir, String(fixture.dir)))
      ? []
      : [`fixture directory ${fixture.dir} does not exist`];
  if (fixture?.type === "repo")
    return REPO_RE.test(fixture.repo ?? "") && SHA_RE.test(fixture.sha ?? "")
      ? []
      : ["a repo fixture needs repo (owner/name) and a 40-character sha"];
  return ["fixture must be a skeleton (dir) or a repo (repo, sha)"];
}

/**
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
      (item) => SLUG_RE.test(item?.id ?? "") && isText(item?.text),
    )
      ? []
      : ["each criterion needs a kebab-case id and a text"]),
    ...(new Set(ids).size === ids.length ? [] : ["criterion ids repeat"]),
  ];
}

/**
 * @param {string} suiteDir
 * @returns {string[]}
 */
function caseErrors(item, suiteDir) {
  const label = `case ${item?.id ?? "?"}`;
  return [
    ...(SLUG_RE.test(item?.id ?? "") ? [] : ["id must be kebab-case"]),
    ...(HARNESSES.some((harness) => harness === fieldOf(item, "harness"))
      ? []
      : [`harness must be one of ${HARNESSES.join(", ")}`]),
    ...(isText(item?.prompt) ? [] : ["prompt must be a sentence"]),
    ...fixtureErrors(item?.fixture, suiteDir),
    ...rubricErrors(item?.rubric, item?.lesson),
    ...(item?.lesson === undefined || /^https:\/\/\S+$/.test(item.lesson)
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
