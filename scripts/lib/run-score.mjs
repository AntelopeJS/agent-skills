import { checkAnswer } from "./answers.mjs";
import { scoreCase } from "./scoring.mjs";
import { listTasks, readAnswer } from "./requests.mjs";

const FENCE_RE = /^```(?:json)?\s*([\s\S]*?)```$/;

/** Reads a model's trigger reply: `{ "skills": [...] }`, bare or fenced. */
export function parsePicks(text) {
  const body = text.trim();
  const unfenced = FENCE_RE.exec(body)?.[1] ?? body;
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  const parsed = JSON.parse(unfenced.slice(start, end + 1));
  if (!Array.isArray(parsed.skills))
    throw new Error("the reply has no skills array");
  return parsed.skills.map(String);
}

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
      error: error.message,
      pass: false,
    };
  }
}

async function answerRun(evalCase, text, verify) {
  if (text === undefined) return { missing: true, pass: false };
  const report = await verify(text);
  const checks = checkAnswer(evalCase, text);
  return {
    missing: false,
    answer: text,
    checked: report.checked,
    invented: report.findings.length,
    unknown: report.findings.map((finding) => finding.name),
    ...checks,
    pass:
      report.findings.length === 0 &&
      !checks.missingMentions.length &&
      !checks.forbiddenMentions.length &&
      checks.behaviourOk,
  };
}

function groupBy(tasks, key) {
  const groups = new Map();
  for (const task of tasks) {
    const id = key(task);
    groups.set(id, [...(groups.get(id) ?? []), task]);
  }
  return groups;
}

async function modelResult(dir, manifest, model, verify) {
  const names = new Set(manifest.corpus.map((skill) => skill.name));
  const tasks = listTasks(manifest).filter((task) => task.model === model.id);
  const byCase = (mode) =>
    groupBy(
      tasks.filter((task) => task.mode === mode),
      (task) => task.caseId,
    );
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
 * Scores every answer file of a prepared run. `verify(answer)` returns a
 * verify report. A task with no answer file fails its case. An answers case
 * passes only when every one of its runs passes (decision 23).
 */
export async function scoreRun(dir, manifest, verify) {
  const models = [];
  for (const model of manifest.models)
    models.push(await modelResult(dir, manifest, model, verify));
  return { manifest, models };
}
