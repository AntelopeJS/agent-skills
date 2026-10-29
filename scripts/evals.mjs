#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { createBaselinePicker } from "./lib/baseline.mjs";
import {
  BACKENDS,
  DIRECT_MODES,
  EXIT,
  OPTIONS,
  USAGE,
  fail,
  loadSkills,
  parseRatio,
  selectCases,
} from "./lib/eval-options.mjs";
import { prepare, exec, score, check, lift } from "./lib/eval-commands.mjs";
import { scoreCase, summarize, formatTable } from "./lib/scoring.mjs";
import {
  createAnthropicBackend,
  createModelPicker,
  hasCredentials,
  modelFromEnv,
  triggerRequest,
  answerRequest,
} from "./lib/model.mjs";
import {
  createOpenAIBackend,
  hasOpenAICredentials,
  openaiModelFromEnv,
} from "./lib/openai.mjs";
import {
  runAnswerEval,
  summarizeAnswers,
  formatAnswers,
} from "./lib/answers.mjs";
import { verifyText } from "./lib/verify.mjs";
import { seeded } from "./lib/seeded-command.mjs";

const COMMAND_HANDLERS = { prepare, exec, score, check, lift, seeded };
const DEFAULT_BACKENDS = {
  trigger: BACKENDS.baseline,
  answers: BACKENDS.anthropic,
};
const CREDENTIALS = {
  [BACKENDS.anthropic]: {
    present: hasCredentials,
    variable: "ANTHROPIC_API_KEY",
  },
  [BACKENDS.openai]: {
    present: hasOpenAICredentials,
    variable: "OPENAI_API_KEY",
  },
};

async function loadBackend(name, model) {
  if (name === BACKENDS.anthropic)
    return createAnthropicBackend({ model: model ?? modelFromEnv() });
  if (name === BACKENDS.openai)
    return createOpenAIBackend({ model: model ?? openaiModelFromEnv() });
  const module = await import(pathToFileURL(resolve(name)).href);
  const complete = module.complete ?? module.default?.complete;
  if (typeof complete !== "function")
    fail(`${name} exports no complete() function`);
  return { name, complete };
}

function printDryRun(requests) {
  const [first] = requests;
  process.stdout.write(
    `--- system prompt of ${first.id} ---\n${first.request.system}\n`,
  );
  for (const { id, request, note } of requests)
    process.stdout.write(
      `--- ${id}${note ? ` (${note})` : ""} ---\n${request.user}\n`,
    );
}

function skipWithoutKey(values, backendName) {
  const credentials = CREDENTIALS[backendName];
  if (values["dry-run"] || !credentials || credentials.present()) return false;
  process.stdout.write(
    `${credentials.variable} is not set; skipping the model-backed eval.\n`,
  );
  return true;
}

async function triggerPicker(values, skills) {
  const backendName = values.backend;
  if (backendName === BACKENDS.baseline)
    return { name: "baseline", pick: createBaselinePicker(skills) };
  const backend = await loadBackend(backendName, values.model);
  return {
    name: backend.name ?? backendName,
    pick: createModelPicker(backend, skills),
  };
}

async function runTrigger(values, cases, skills) {
  if (values["dry-run"])
    return printDryRun(
      cases.map((item) => ({
        id: item.id,
        request: triggerRequest(skills, item.prompt),
      })),
    );
  const { name, pick } = await triggerPicker(values, skills);
  const names = new Set(skills.map((skill) => skill.name));
  const scores = [];
  for (const item of cases)
    scores.push(scoreCase(item, await pick(item.prompt), names));
  const thresholds = {
    minRecall: parseRatio(values["min-recall"], "min-recall"),
    minPrecision: parseRatio(values["min-precision"], "min-precision"),
  };
  const summary = summarize(scores, thresholds);
  const output = values.json
    ? JSON.stringify(
        {
          mode: "trigger",
          backend: name,
          corpus: [...names],
          summary,
          cases: scores,
        },
        null,
        2,
      )
    : `Backend: ${name}. Corpus: ${names.size} skills.\n\n${formatTable(scores, summary)}\n${summary.passed ? "" : "\nBelow threshold.\n"}`;
  process.stdout.write(`${output}\n`);
  return summary.passed ? EXIT.ok : EXIT.failed;
}

function writeAnswers(dir, results) {
  mkdirSync(dir, { recursive: true });
  for (const result of results.filter((item) => !item.skipped))
    writeFileSync(join(dir, `${result.id}.md`), result.answer);
}

async function runAnswers(values, cases, skills) {
  const loadedFor = (item) =>
    skills.filter((skill) => item.expect.skills.includes(skill.name));
  if (values["dry-run"]) {
    const requests = cases.map((item) => ({
      id: item.id,
      request: answerRequest(loadedFor(item), item.prompt),
      note: `loads ${
        loadedFor(item)
          .map((skill) => skill.name)
          .join(", ") || "nothing"
      }`,
    }));
    return printDryRun(requests);
  }
  const backend = await loadBackend(values.backend, values.model);
  const verifyOptions = {
    project: resolve(values.project ?? process.cwd()),
    offline: Boolean(values.offline),
  };
  const results = await runAnswerEval({
    cases,
    skills,
    backend,
    verify: (answer) => verifyText(answer, verifyOptions),
  });
  if (values.out) writeAnswers(resolve(values.out), results);
  const summary = summarizeAnswers(results, {
    maxInvented: parseRatio(values["max-invented"], "max-invented"),
  });
  const output = values.json
    ? JSON.stringify({ mode: "answers", summary, cases: results }, null, 2)
    : formatAnswers(results, summary);
  process.stdout.write(`${output}\n`);
  return summary.passed ? EXIT.ok : EXIT.failed;
}

async function runDirect(mode, values) {
  values.backend ??= DEFAULT_BACKENDS[mode];
  if (skipWithoutKey(values, values.backend)) return EXIT.ok;
  const skills = loadSkills(values);
  const { selected, shadowed } = selectCases(values, skills);
  if (!selected.length) fail("no case matches --only/--area");
  if (shadowed.length)
    process.stderr.write(
      `note: ${shadowed.length} central case(s) replaced by the skills' own (${shadowed.map((item) => item.id).join(", ")})\n`,
    );
  const runners = { trigger: runTrigger, answers: runAnswers };
  return (await runners[mode](values, selected, skills)) ?? EXIT.ok;
}

async function main() {
  const { values, positionals } = parseArgs({
    options: OPTIONS,
    allowPositionals: true,
  });
  if (values.help) {
    process.stdout.write(USAGE);
    return EXIT.ok;
  }
  const [first = DIRECT_MODES[0]] = positionals;
  if (Object.hasOwn(COMMAND_HANDLERS, first))
    return COMMAND_HANDLERS[first](values, positionals);
  if (!DIRECT_MODES.includes(first))
    fail(
      `unknown mode '${first}' (one of ${[...DIRECT_MODES, ...Object.keys(COMMAND_HANDLERS)].join(", ")})`,
    );
  return runDirect(first, values);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = EXIT.failed;
  },
);
