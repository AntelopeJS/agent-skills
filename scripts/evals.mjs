#!/usr/bin/env node
// Skill evals over the dataset in evals/cases.json.
//
//   evals [trigger] — which skills an agent would load for each prompt, scored
//                     for precision and recall. `--backend baseline` (default)
//                     needs no key; `--backend anthropic` asks a model, shown only
//                     the skills' names and descriptions like the real harness.
//   evals answers   — the model answers each prompt with its expected skills
//                     loaded; `verify` counts the API names it invented.
//
// Run `evals --help` for the options.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { loadCorpus } from "./lib/corpus.mjs";
import { loadDataset, DATASET_FILE } from "./lib/dataset.mjs";
import { createBaselinePicker } from "./lib/baseline.mjs";
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
  runAnswerEval,
  summarizeAnswers,
  formatAnswers,
} from "./lib/answers.mjs";
import { verifyText } from "./lib/verify.mjs";

const PUBLISHED_FILE = new URL("../evals/packages.json", import.meta.url);
const EXIT = { ok: 0, failed: 1, usage: 2 };
const BACKENDS = { baseline: "baseline", anthropic: "anthropic" };
const MODES = ["trigger", "answers"];
const DEFAULT_BACKENDS = {
  trigger: BACKENDS.baseline,
  answers: BACKENDS.anthropic,
};
const OPTIONS = {
  backend: { type: "string" },
  project: { type: "string" },
  skills: { type: "string", multiple: true },
  packages: { type: "string" },
  published: { type: "boolean" },
  cases: { type: "string" },
  only: { type: "string" },
  area: { type: "string" },
  "min-recall": { type: "string" },
  "min-precision": { type: "string" },
  "max-invented": { type: "string" },
  model: { type: "string" },
  out: { type: "string" },
  offline: { type: "boolean" },
  "dry-run": { type: "boolean" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};
const USAGE = `Usage: evals [trigger|answers] [options]

Corpus (default: the current directory as a project):
  --project <dir>        skills the sync finds in a project (workspace, node_modules, .antelope/cache)
  --skills <dir>         every SKILL.md under <dir> (repeatable; wins over the project's)
  --packages <a,b>       skills shipped by these npm packages (fetched, not installed)
  --published            the packages listed in evals/packages.json

Cases:
  --cases <file>         dataset (default: evals/cases.json)
  --only <id,id>         run these cases only
  --area <area>          run one area (framework, dms, dms-ai, modules, install)

Scoring:
  --backend <name>       baseline (trigger default), anthropic (answers default), or a module path
                         exporting complete({ system, user, schema, effort, maxTokens })
  --model <id>           model for the anthropic backend (default: $EVAL_MODEL or ${modelFromEnv({})})
  --min-recall <0-1>     trigger: fail under this mean recall
  --min-precision <0-1>  trigger: fail under this mean precision
  --max-invented <0-1>   answers: fail over this invented API rate
  --project <dir>        answers: also where verify resolves packages (default: cwd)
  --offline              answers: verify without fetching interface packages from npm
  --out <dir>            answers: write each answer to <dir>/<case>.md
  --dry-run              print the model requests instead of sending them
  --json                 machine-readable result

The anthropic backend reads ANTHROPIC_API_KEY; without it the eval is skipped (exit 0).
`;

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(EXIT.usage);
}

function parseRatio(value, name) {
  if (value === undefined) return undefined;
  const ratio = Number(value);
  if (!(ratio >= 0 && ratio <= 1))
    fail(`--${name} expects a number between 0 and 1`);
  return ratio;
}

function listOption(value) {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function corpusOptions(values) {
  const published = values.published
    ? JSON.parse(readFileSync(PUBLISHED_FILE, "utf8")).packages
    : [];
  const packages = [...listOption(values.packages), ...published];
  const dirs = values.skills ?? [];
  const project =
    values.project ??
    (dirs.length || packages.length ? undefined : process.cwd());
  return { project, dirs, packages };
}

function selectCases(values) {
  const only = new Set(listOption(values.only));
  const { cases } = loadDataset(
    values.cases ? resolve(values.cases) : DATASET_FILE,
  );
  const selected = cases.filter(
    (item) =>
      (!only.size || only.has(item.id)) &&
      (!values.area || item.area === values.area),
  );
  if (!selected.length) fail("no case matches --only/--area");
  return selected;
}

async function loadBackend(name, model) {
  if (name === BACKENDS.anthropic) return createAnthropicBackend({ model });
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
  if (
    values["dry-run"] ||
    backendName !== BACKENDS.anthropic ||
    hasCredentials()
  )
    return false;
  process.stdout.write(
    "ANTHROPIC_API_KEY is not set; skipping the model-backed eval.\n",
  );
  return true;
}

async function triggerPicker(values, skills) {
  const backendName = values.backend;
  if (backendName === BACKENDS.baseline)
    return { name: "baseline", pick: createBaselinePicker(skills) };
  const backend = await loadBackend(
    backendName,
    values.model ?? modelFromEnv(),
  );
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
  const backend = await loadBackend(
    values.backend,
    values.model ?? modelFromEnv(),
  );
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

async function main() {
  const { values, positionals } = parseArgs({
    options: OPTIONS,
    allowPositionals: true,
  });
  if (values.help) {
    process.stdout.write(USAGE);
    return EXIT.ok;
  }
  const mode = positionals[0] ?? MODES[0];
  if (!MODES.includes(mode))
    fail(`unknown mode '${mode}' (one of ${MODES.join(", ")})`);
  values.backend ??= DEFAULT_BACKENDS[mode];
  if (skipWithoutKey(values, values.backend)) return EXIT.ok;
  const cases = selectCases(values);
  const { skills, duplicates } = loadCorpus(corpusOptions(values));
  if (!skills.length)
    fail(
      "the corpus is empty: no SKILL.md found (see --project, --skills, --packages)",
    );
  if (duplicates.length)
    process.stderr.write(
      `note: kept the first of each duplicate skill (${duplicates.map((d) => d.name).join(", ")})\n`,
    );
  const runners = { trigger: runTrigger, answers: runAnswers };
  return (await runners[mode](values, cases, skills)) ?? EXIT.ok;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`error: ${error.message}\n`);
    process.exit(EXIT.failed);
  },
);
