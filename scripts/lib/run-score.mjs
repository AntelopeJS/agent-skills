import { checkAnswer } from "./answers.mjs";
import { scoreCase } from "./scoring.mjs";
import { listTasks, readAnswer } from "./requests.mjs";
import { parseJson } from "./json.mjs";
import { fieldOf } from "./safe-read.mjs";

/** @typedef {import("./dataset.mjs").EvalCase} EvalCase */
/** @typedef {import("./matrix.mjs").MatrixEntry} MatrixEntry */
/** @typedef {import("./requests.mjs").Manifest} Manifest */
/** @typedef {import("./requests.mjs").RunTask} RunTask */
/** @typedef {import("./scoring.mjs").CaseScore} CaseScore */

/**
 * A trigger case once scored: its score, whether it passed and, when the reply
 * was missing or unreadable, why not.
 * @typedef {CaseScore & { pass: boolean, error?: string }} TriggerResult
 */

/**
 * One run of an answers case. A run with no answer file is `missing` and
 * carries nothing else; the others carry the answer, its checked and invented
 * API names and the content checks.
 * @typedef {object} AnswerRun
 * @property {number} run
 * @property {boolean} missing
 * @property {boolean} pass
 * @property {string} [answer]
 * @property {number} [checked]
 * @property {number} [invented]
 * @property {string[]} [unknown]
 * @property {string[]} [unverified]
 * @property {string[]} [missingMentions]
 * @property {string[]} [forbiddenMentions]
 * @property {boolean} [behaviourOk]
 */

/**
 * An answers case once scored: it passes only when every run does.
 * @typedef {object} AnswerCaseResult
 * @property {string} id
 * @property {AnswerRun[]} runs
 * @property {boolean} pass
 */

/**
 * What a model scored over a prepared run.
 * @typedef {object} ModelResult
 * @property {MatrixEntry} model
 * @property {TriggerResult[]} trigger
 * @property {AnswerCaseResult[]} answers
 */

/**
 * A prepared run once scored.
 * @typedef {object} ScoredRun
 * @property {Manifest} manifest
 * @property {ModelResult[]} models
 */

/**
 * What `verify` says of an answer: how many API names it checked and the
 * findings, a finding of kind `reference` being unverified rather than invented.
 * @typedef {object} RunReport
 * @property {number} checked
 * @property {{ name: string, kind?: string }[]} findings
 */

/**
 * Checks an answer's API names against the installed packages.
 * @typedef {(answer: string) => Promise<RunReport>} RunVerifier
 */

const FENCE_RE = /^```(?:json)?\s*([\s\S]*?)```$/;

/**
 * Reads a model's trigger reply: `{ "skills": [...] }`, bare or fenced.
 * @param {string} text
 * @returns {string[]}
 */
export function parsePicks(text) {
  const body = text.trim();
  const unfenced = FENCE_RE.exec(body)?.[1] ?? body;
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  const skills = fieldOf(parseJson(unfenced.slice(start, end + 1)), "skills");
  if (!Array.isArray(skills)) throw new Error("the reply has no skills array");
  return skills.map(String);
}

/**
 * @param {EvalCase} evalCase
 * @param {string | undefined} text
 * @param {Set<string>} names
 * @returns {TriggerResult}
 */
function triggerResult(evalCase, text, names) {
  if (text === undefined)
    return {
      ...scoreCase(evalCase, [], names),
      error: "no answer file",
      pass: false,
    };
  try {
    const score = scoreCase(evalCase, parsePicks(text), names);
    return {
      ...score,
      pass: !score.skipped && !score.missed.length && !score.avoided.length,
    };
  } catch (error) {
    return {
      ...scoreCase(evalCase, [], names),
      error: error instanceof Error ? error.message : String(error),
      pass: false,
    };
  }
}

/**
 * @param {EvalCase} evalCase
 * @param {string | undefined} text
 * @param {RunVerifier} verify
 * @returns {Promise<Omit<AnswerRun, "run">>}
 */
async function answerRun(evalCase, text, verify) {
  if (text === undefined) return { missing: true, pass: false };
  const report = await verify(text);
  const checks = checkAnswer(evalCase, text);
  const invented = report.findings.filter(
    (finding) => finding.kind !== "reference",
  );
  const unverified = report.findings.filter(
    (finding) => finding.kind === "reference",
  );
  return {
    missing: false,
    answer: text,
    checked: report.checked,
    invented: invented.length,
    unknown: invented.map((finding) => finding.name),
    unverified: unverified.map((finding) => finding.name),
    ...checks,
    pass:
      invented.length === 0 &&
      !checks.missingMentions.length &&
      !checks.forbiddenMentions.length &&
      checks.behaviourOk,
  };
}

/**
 * @template T
 * @param {T[]} tasks
 * @param {(task: T) => string} key
 * @returns {Map<string, T[]>}
 */
function groupBy(tasks, key) {
  /** @type {Map<string, T[]>} */
  const groups = new Map();
  for (const task of tasks) {
    const id = key(task);
    groups.set(id, [...(groups.get(id) ?? []), task]);
  }
  return groups;
}

/**
 * @param {string} dir
 * @param {Manifest} manifest
 * @param {MatrixEntry} model
 * @param {RunVerifier} verify
 * @returns {Promise<ModelResult>}
 */
async function modelResult(dir, manifest, model, verify) {
  const names = new Set(manifest.corpus.map((skill) => skill.name));
  const tasks = listTasks(manifest).filter((task) => task.model === model.id);
  /** @param {import("./requests.mjs").Mode} mode */
  const byCase = (mode) =>
    groupBy(
      tasks.filter((task) => task.mode === mode),
      (task) => task.caseId,
    );
  /** @param {string} id */
  const caseOf = (id) => manifest.cases.find((item) => item.id === id);
  const trigger = [...byCase("trigger")].map(([id, [task]]) =>
    triggerResult(caseOf(id), readAnswer(dir, task), names),
  );
  const answers = [];
  for (const [id, caseTasks] of byCase("answers")) {
    const runs = [];
    for (const task of caseTasks)
      runs.push({
        run: task.run,
        ...(await answerRun(caseOf(id), readAnswer(dir, task), verify)),
      });
    answers.push({ id, runs, pass: runs.every((run) => run.pass) });
  }
  return { model, trigger, answers };
}

/**
 * Scores every answer file of a prepared run. An invented name is an import
 * `verify` resolves and does not find: a missing package, subpath or export.
 * The API-shaped names an answer uses without importing them (`reference`
 * findings) also flag the user's own identifiers and tool names, so they are
 * reported as unverified and never fail a run.
 `verify(answer)` returns a
 * verify report. A task with no answer file fails its case. An answers case
 * passes only when every one of its runs passes (decision 23).
 * @param {string} dir
 * @param {Manifest} manifest
 * @param {RunVerifier} verify
 * @returns {Promise<ScoredRun>}
 */
export async function scoreRun(dir, manifest, verify) {
  const models = [];
  for (const model of manifest.models)
    models.push(await modelResult(dir, manifest, model, verify));
  return { manifest, models };
}
