import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

function rubricErrors(rubric, lesson) {
  if (!Array.isArray(rubric)) return ["rubric must be a list"];
  const minimum = lesson ? 1 : MIN_CRITERIA;
  const ids = rubric.map((item) => item?.id);
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

function caseErrors(item, suiteDir) {
  const label = `case ${item?.id ?? "?"}`;
  return [
    ...(SLUG_RE.test(item?.id ?? "") ? [] : ["id must be kebab-case"]),
    ...(HARNESSES.includes(item?.harness)
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

/** Problems of one rubric suite (`evals/commands/<skill>/cases.json`). */
export function suiteErrors(suite, suiteDir) {
  if (!Array.isArray(suite?.cases)) return ["cases must be a list"];
  const ids = suite.cases.map((item) => item?.id);
  return [
    ...suite.cases.flatMap((item) => caseErrors(item, suiteDir)),
    ...(new Set(ids).size === ids.length ? [] : ["case ids repeat"]),
    ...(suite.cases.length >= MIN_RUBRIC_CASES
      ? []
      : [`needs at least ${MIN_RUBRIC_CASES} behaviour cases`]),
  ];
}

/**
 * Reads every rubric suite and returns the problems, prefixed by suite. A
 * suite directory must be named after a skill of the plugin.
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
      return suiteErrors(JSON.parse(readFileSync(file, "utf8")), suiteDir).map(
        (error) => `evals/commands/${entry.name}: ${error}`,
      );
    });
}
