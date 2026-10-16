// Answer-quality eval: the model answers each case with the case's expected
// skills loaded, and `verify` counts the API names it invented.

import { answerRequest } from "./model.mjs";

const PERCENT = 100;
const FENCE_RE = /^\s*(```|~~~)/m;

function mentions(answer, name) {
  return answer.includes(name);
}

function asksFirst(answer) {
  const fence = answer.search(FENCE_RE);
  const prose = fence < 0 ? answer : answer.slice(0, fence);
  return prose.includes("?");
}

const BEHAVIOUR_CHECKS = { "asks-first": asksFirst };

export function checkAnswer(evalCase, answer) {
  const { mustMention = [], mustNotMention = [], behaviour } = evalCase.expect;
  return {
    missingMentions: mustMention.filter((name) => !mentions(answer, name)),
    forbiddenMentions: mustNotMention.filter((name) => mentions(answer, name)),
    behaviourOk: behaviour ? BEHAVIOUR_CHECKS[behaviour](answer) : true,
  };
}

async function answerCase(evalCase, { skills, backend, verify }) {
  const loaded = skills.filter((skill) => evalCase.expect.skills.includes(skill.name));
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

/** Runs the cases one after the other; `verify(answer)` returns a verify report. */
export async function runAnswerEval({ cases, skills, backend, verify }) {
  const results = [];
  for (const evalCase of cases) results.push(await answerCase(evalCase, { skills, backend, verify }));
  return results;
}

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
    missingMentions: answered.filter((result) => result.missingMentions.length).length,
    forbiddenMentions: answered.filter((result) => result.forbiddenMentions.length).length,
    behaviourFailures: answered.filter((result) => !result.behaviourOk).length,
    maxInvented,
    passed: inventedRate <= maxInvented,
  };
}

function resultRow(result) {
  if (result.skipped) return `${result.id}  skipped (no expected skill in the corpus)`;
  const notes = [
    result.unknown.length ? `unknown: ${result.unknown.join(", ")}` : "",
    result.missingMentions.length ? `missing: ${result.missingMentions.join(", ")}` : "",
    result.forbiddenMentions.length ? `forbidden: ${result.forbiddenMentions.join(", ")}` : "",
    result.behaviourOk ? "" : "did not ask first",
  ].filter(Boolean);
  return `${result.id}  ${result.invented}/${result.checked} invented  ${notes.join("; ")}`.trimEnd();
}

export function formatAnswers(results, summary) {
  const rate = Math.round(summary.inventedRate * PERCENT);
  const totals = [
    `invented API names: ${summary.invented}/${summary.checked} (${rate}%) over ${summary.answered} answers, ${summary.skipped} skipped`,
    `missing expected names: ${summary.missingMentions} answers; forbidden names: ${summary.forbiddenMentions}; did not ask first: ${summary.behaviourFailures}`,
  ];
  return [...results.map(resultRow), "", ...totals].join("\n");
}
