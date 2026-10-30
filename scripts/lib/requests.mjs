import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { isAnswersCase } from "./cases.mjs";
import { answerRequest, triggerRequest } from "./model.mjs";

/** @typedef {import("./dataset.mjs").EvalCase} EvalCase */
/** @typedef {import("./matrix.mjs").MatrixEntry} MatrixEntry */
/** @typedef {import("./model.mjs").ModelRequest} ModelRequest */
/** @typedef {import("./model.mjs").RequestSkill} RequestSkill */

/** @typedef {"trigger" | "answers"} Mode */

/**
 * A skill of the corpus a run was prepared against, with where it came from.
 * @typedef {RequestSkill & { source: string }} RunSkill
 */

/**
 * One job of a run: a model answers a case in a mode, for the n-th time.
 * @typedef {object} RunTask
 * @property {string} model The matrix id of the model.
 * @property {Mode} mode
 * @property {string} caseId
 * @property {number} run
 */

/**
 * The request file of a task: the task and the model call it stands for.
 * @typedef {RunTask & ModelRequest} TaskRequest
 */

/**
 * `manifest.json`: everything a prepared run holds besides its request files.
 * @typedef {object} Manifest
 * @property {number} version
 * @property {string} createdAt
 * @property {boolean} withSkills
 * @property {Mode[]} modes
 * @property {Record<Mode, number>} runs How many times each mode runs a case.
 * @property {MatrixEntry[]} models
 * @property {{ name: string, source: string }[]} corpus
 * @property {EvalCase[]} cases
 */

/**
 * @typedef {object} RunOptions
 * @property {Mode[]} [modes]
 * @property {Record<Mode, number>} [runs]
 * @property {boolean} [withSkills]
 * @property {string} [at]
 */

export const MANIFEST_FILE = "manifest.json";
export const MANIFEST_VERSION = 1;
/** @type {Mode[]} */
export const MODES = ["trigger", "answers"];
/** @type {Record<Mode, number>} */
export const DEFAULT_RUNS = { trigger: 1, answers: 2 };

/**
 * @param {Manifest} manifest
 * @param {EvalCase} evalCase
 * @param {RunSkill[]} skills
 * @returns {RunSkill[]}
 */
function skillsFor(manifest, evalCase, skills) {
  return manifest.withSkills
    ? skills.filter((skill) => evalCase.expect.skills.includes(skill.name))
    : [];
}

/**
 * The jobs of a run in a stable order: one per model, mode, case and run.
 * A case whose expected skills are all missing from the corpus has none, and
 * only answers cases (see `isAnswersCase`) have answers jobs.
 * @param {Manifest} manifest
 * @returns {RunTask[]}
 */
export function listTasks(manifest) {
  const names = new Set(manifest.corpus.map((skill) => skill.name));
  const cases = manifest.cases.filter((item) =>
    item.expect.skills.some((name) => names.has(name)),
  );
  return manifest.models.flatMap((model) =>
    manifest.modes.flatMap((mode) =>
      cases
        .filter((evalCase) => mode === "trigger" || isAnswersCase(evalCase))
        .flatMap((evalCase) =>
          Array.from({ length: manifest.runs[mode] }, (_, index) => ({
            model: model.id,
            mode,
            caseId: evalCase.id,
            run: index + 1,
          })),
        ),
    ),
  );
}

/**
 * @param {string} dir
 * @param {RunTask} task
 * @param {string} suffix
 * @returns {string}
 */
function taskFile(dir, task, suffix) {
  return join(
    dir,
    task.model,
    task.mode,
    `${task.caseId}.${task.run}.${suffix}`,
  );
}

/**
 * @param {string} dir
 * @param {RunTask} task
 * @returns {string}
 */
export const requestFile = (dir, task) => taskFile(dir, task, "request.json");
/**
 * @param {string} dir
 * @param {RunTask} task
 * @returns {string}
 */
export const answerFile = (dir, task) => taskFile(dir, task, "answer.txt");
/**
 * @param {string} dir
 * @param {RunTask} task
 * @returns {string}
 */
export const errorFile = (dir, task) => taskFile(dir, task, "error.txt");

/**
 * @param {Manifest} manifest
 * @param {RunSkill[]} skills
 * @param {RunTask} task
 * @returns {TaskRequest}
 */
function buildRequest(manifest, skills, task) {
  const evalCase = manifest.cases.find((item) => item.id === task.caseId);
  const request =
    task.mode === "trigger"
      ? triggerRequest(skills, evalCase.prompt)
      : answerRequest(skillsFor(manifest, evalCase, skills), evalCase.prompt);
  return { ...task, ...request };
}

/**
 * Writes `manifest.json` and one request file per task under `dir`, and
 * returns the manifest. `withSkills: false` is the baseline of decision 5: the
 * same answers cases with no skill loaded.
 * @param {object} run
 * @param {string} run.dir
 * @param {EvalCase[]} run.cases
 * @param {RunSkill[]} run.skills
 * @param {MatrixEntry[]} run.models
 * @param {RunOptions} [run.options]
 * @returns {Manifest}
 */
export function writeRun({ dir, cases, skills, models, options = {} }) {
  const {
    modes = MODES,
    runs = DEFAULT_RUNS,
    withSkills = true,
    at = new Date().toISOString(),
  } = options;
  const manifest = {
    version: MANIFEST_VERSION,
    createdAt: at,
    withSkills,
    modes,
    runs,
    models,
    corpus: skills.map(({ name, source }) => ({ name, source })),
    cases,
  };
  rmSync(dir, { recursive: true, force: true });
  for (const task of listTasks(manifest)) {
    const file = requestFile(dir, task);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify(buildRequest(manifest, skills, task), null, 2)}\n`,
    );
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

/**
 * @param {string} dir
 * @returns {Manifest}
 */
export function readManifest(dir) {
  const file = join(dir, MANIFEST_FILE);
  if (!existsSync(file)) throw new Error(`${dir} holds no ${MANIFEST_FILE}`);
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  if (manifest.version !== MANIFEST_VERSION)
    throw new Error(`${file}: unsupported version ${manifest.version}`);
  return manifest;
}

/**
 * @param {string} dir
 * @param {RunTask} task
 * @returns {TaskRequest}
 */
export function readRequest(dir, task) {
  return JSON.parse(readFileSync(requestFile(dir, task), "utf8"));
}

/**
 * The answer text of a task, or `undefined` when no executor wrote it yet.
 * @param {string} dir
 * @param {RunTask} task
 * @returns {string | undefined}
 */
export function readAnswer(dir, task) {
  const file = answerFile(dir, task);
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

/**
 * @param {string} dir
 * @param {RunTask} task
 * @param {string} text
 * @returns {void}
 */
export function writeAnswer(dir, task, text) {
  const file = answerFile(dir, task);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
