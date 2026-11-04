/**
 * Answer-quality eval: the model answers each case with the case's expected
 * skills loaded, and `verify` counts the API names it invented.
 */

import { answerRequest } from "./model.mjs";

/** @typedef {import("./dataset.mjs").EvalCase} EvalCase */
/** @typedef {import("./model.mjs").ModelBackend} ModelBackend */
/** @typedef {import("./model.mjs").RequestSkill} RequestSkill */

/**
 * What the content checks of a case found in an answer.
 * @typedef {object} AnswerChecks
 * @property {string[]} missingMentions Names the answer had to mention and did not.
 * @property {string[]} forbiddenMentions Names the answer had to avoid and used.
 * @property {boolean} behaviourOk Whether the answer showed the expected behaviour.
 */

/**
 * What `verify` says of an answer: how many API names it checked and which are unknown.
 * @typedef {object} AnswerReport
 * @property {number} checked
 * @property {{ name: string }[]} findings
 */

/**
 * Checks an answer's API names against the installed packages.
 * @typedef {(answer: string) => Promise<AnswerReport>} AnswerVerifier
 */

/**
 * A case with no expected skill in the corpus, left unanswered.
 * @typedef {object} SkippedAnswer
 * @property {string} id
 * @property {true} skipped
 */

/**
 * A case the model answered: the answer, its API names and the content checks.
 * @typedef {object} AnsweredCase
 * @property {string} id
 * @property {false} skipped
 * @property {string} answer
 * @property {number} checked
 * @property {number} invented
 * @property {string[]} unknown
 * @property {string[]} missingMentions
 * @property {string[]} forbiddenMentions
 * @property {boolean} behaviourOk
 */

/** @typedef {SkippedAnswer | AnsweredCase} AnswerResult */

/**
 * @typedef {object} AnswerSummary
 * @property {number} answered
 * @property {number} skipped
 * @property {number} checked
 * @property {number} invented
 * @property {number} inventedRate
 * @property {number} missingMentions
 * @property {number} forbiddenMentions
 * @property {number} behaviourFailures
 * @property {number} maxInvented
 * @property {boolean} passed
 */

const PERCENT = 100;
const FENCE_RE = /^\s*(```|~~~)/m;

/**
 * @param {string} answer
 * @param {string} name
 * @returns {boolean}
 */
function mentions(answer, name) {
  return answer.includes(name);
}

/**
 * @param {string} answer
 * @returns {boolean}
 */
function asksFirst(answer) {
  const fence = answer.search(FENCE_RE);
  const prose = fence < 0 ? answer : answer.slice(0, fence);
  return prose.includes("?");
}

/** @type {Record<import("./dataset.mjs").EvalBehaviour, (answer: string) => boolean>} */
const BEHAVIOUR_CHECKS = { "asks-first": asksFirst };

/**
 * @param {EvalCase} evalCase
 * @param {string} answer
 * @returns {AnswerChecks}
 */
export function checkAnswer(evalCase, answer) {
  const { mustMention = [], mustNotMention = [], behaviour } = evalCase.expect;
  return {
    missingMentions: mustMention.filter((name) => !mentions(answer, name)),
    forbiddenMentions: mustNotMention.filter((name) => mentions(answer, name)),
    behaviourOk: behaviour ? BEHAVIOUR_CHECKS[behaviour](answer) : true,
  };
}

/**
 * @param {EvalCase} evalCase
 * @param {{ skills: RequestSkill[], backend: ModelBackend, verify: AnswerVerifier }} run
 * @returns {Promise<AnswerResult>}
 */
async function answerCase(evalCase, { skills, backend, verify }) {
  const loaded = skills.filter((skill) =>
    evalCase.expect.skills.includes(skill.name),
  );
  if (!loaded.length) return { id: evalCase.id, skipped: true };
  const answer = await backend.complete(answerRequest(loaded, evalCase.prompt));
  const report = await verify(answer);
  return {
    id: evalCase.id,
    skipped: false,
    answer,
    checked: report.checked,
    invented: report.findings.length,
    unknown: report.findings.map((finding) => finding.name),
    ...checkAnswer(evalCase, answer),
  };
}

/**
 * Runs the cases one after the other; `verify(answer)` returns a verify report.
 * @param {object} run
 * @param {EvalCase[]} run.cases
 * @param {RequestSkill[]} run.skills
 * @param {ModelBackend} run.backend
 * @param {AnswerVerifier} run.verify
 * @returns {Promise<AnswerResult[]>}
 */
export async function runAnswerEval({ cases, skills, backend, verify }) {
  /** @type {AnswerResult[]} */
  const results = [];
  for (const evalCase of cases)
    results.push(await answerCase(evalCase, { skills, backend, verify }));
  return results;
}

/**
 * @param {AnswerResult[]} results
 * @param {{ maxInvented?: number }} [options]
 * @returns {AnswerSummary}
 */
export function summarizeAnswers(results, { maxInvented = 1 } = {}) {
  const answered = results.filter((result) => !result.skipped);
  const checked = answered.reduce((sum, result) => sum + result.checked, 0);
  const invented = answered.reduce((sum, result) => sum + result.invented, 0);
  const inventedRate = checked ? invented / checked : 0;
  return {
    answered: answered.length,
    skipped: results.length - answered.length,
    checked,
    invented,
    inventedRate,
    missingMentions: answered.filter((result) => result.missingMentions.length)
      .length,
    forbiddenMentions: answered.filter(
      (result) => result.forbiddenMentions.length,
    ).length,
    behaviourFailures: answered.filter((result) => !result.behaviourOk).length,
    maxInvented,
    passed: inventedRate <= maxInvented,
  };
}

/**
 * @param {AnswerResult} result
 * @returns {string}
 */
function resultRow(result) {
  if (result.skipped)
    return `${result.id}  skipped (no expected skill in the corpus)`;
  const notes = [
    result.unknown.length ? `unknown: ${result.unknown.join(", ")}` : "",
    result.missingMentions.length
      ? `missing: ${result.missingMentions.join(", ")}`
      : "",
    result.forbiddenMentions.length
      ? `forbidden: ${result.forbiddenMentions.join(", ")}`
      : "",
    result.behaviourOk ? "" : "did not ask first",
  ].filter(Boolean);
  return `${result.id}  ${result.invented}/${result.checked} invented  ${notes.join("; ")}`.trimEnd();
}

/**
 * @param {AnswerResult[]} results
 * @param {AnswerSummary} summary
 * @returns {string}
 */
export function formatAnswers(results, summary) {
  const rate = Math.round(summary.inventedRate * PERCENT);
  const totals = [
    `invented API names: ${summary.invented}/${summary.checked} (${rate}%) over ${summary.answered} answers, ${summary.skipped} skipped`,
    `missing expected names: ${summary.missingMentions} answers; forbidden names: ${summary.forbiddenMentions}; did not ask first: ${summary.behaviourFailures}`,
  ];
  return [...results.map(resultRow), "", ...totals].join("\n");
}
