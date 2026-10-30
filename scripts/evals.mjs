#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { format, parseArgs } from "node:util";
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
import { fieldOf } from "./lib/safe-read.mjs";
import { seeded } from "./lib/seeded-command.mjs";

/** @typedef {import("./lib/corpus.mjs").Skill} Skill */
/** @typedef {import("./lib/dataset.mjs").EvalCase} EvalCase */
/** @typedef {import("./lib/eval-options.mjs").EvalValues} EvalValues */
/** @typedef {import("./lib/model.mjs").ModelBackend} ModelBackend */
/** @typedef {import("./lib/model.mjs").ModelRequest} ModelRequest */
/** @typedef {import("./lib/answers.mjs").AnswerResult} AnswerResult */

/**
 * A model call to print instead of sending, with the case it stands for.
 * @typedef {object} DryRunRequest
 * @property {string} id
 * @property {ModelRequest} request
 * @property {string} [note]
 */

/**
 * Runs a command of the CLI and returns its exit code.
 * @typedef {(values: EvalValues, positionals: string[]) => number | Promise<number>} CommandHandler
 */

/**
 * Runs a direct mode over the selected cases; a dry run returns no exit code.
 * @typedef {(values: EvalValues, cases: EvalCase[], skills: Skill[]) => Promise<number | void>} DirectRunner
 */

/** @type {Record<string, CommandHandler>} */
const COMMAND_HANDLERS = { prepare, exec, score, check, lift, seeded };
/** @type {Record<string, string>} */
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

/**
 * @param {string} name
 * @param {string | undefined} model
 * @returns {Promise<ModelBackend>}
 */
async function loadBackend(name, model) {
  if (name === BACKENDS.anthropic)
    return createAnthropicBackend({ model: model ?? modelFromEnv() });
  if (name === BACKENDS.openai)
    return createOpenAIBackend({ model: model ?? openaiModelFromEnv() });
  /** @type {unknown} */
  const module = await import(pathToFileURL(resolve(name)).href);
  const complete =
    fieldOf(module, "complete") ??
    fieldOf(fieldOf(module, "default"), "complete");
  if (typeof complete !== "function")
    fail(`${name} exports no complete() function`);
  return { name, complete };
}

/**
 * @param {DryRunRequest[]} requests
 * @returns {void}
 */
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

/**
 * @param {EvalValues} values
 * @param {string} backendName
 * @returns {boolean}
 */
function skipWithoutKey(values, backendName) {
  const credentials = CREDENTIALS[backendName];
  if (values["dry-run"] || !credentials || credentials.present()) return false;
  process.stdout.write(
    `${credentials.variable} is not set; skipping the model-backed eval.\n`,
  );
  return true;
}

/**
 * @param {EvalValues} values
 * @param {Skill[]} skills
 * @returns {Promise<{ name: string, pick: (prompt: string) => string[] | Promise<string[]> }>}
 */
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

/** @type {DirectRunner} */
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

/**
 * @param {string} dir
 * @param {AnswerResult[]} results
 * @returns {void}
 */
function writeAnswers(dir, results) {
  mkdirSync(dir, { recursive: true });
  for (const result of results.filter((item) => !item.skipped))
    writeFileSync(join(dir, `${result.id}.md`), result.answer);
}

/** @type {DirectRunner} */
async function runAnswers(values, cases, skills) {
  /** @param {EvalCase} item */
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

/**
 * @param {string} mode
 * @param {EvalValues} values
 * @returns {Promise<number>}
 */
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
  /** @type {Record<string, DirectRunner>} */
  const runners = { trigger: runTrigger, answers: runAnswers };
  return (await runners[mode](values, selected, skills)) ?? EXIT.ok;
}

/**
 * @returns {Promise<number>}
 */
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
  /** @param {unknown} error */
  (error) => {
    process.stderr.write(format("error: %s\n", fieldOf(error, "message")));
    process.exitCode = EXIT.failed;
  },
);
