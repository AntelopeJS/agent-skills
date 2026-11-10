import { resolve } from "node:path";

import { DEFAULT_JOBS } from "./executors.mjs";
import { MATRIX } from "./matrix.mjs";
import { loadCases } from "./cases.mjs";
import { loadCorpus } from "./corpus.mjs";
import { readJsonFile } from "../../plugin/scripts/lib/json.mjs";
import { modelFromEnv } from "./model.mjs";
import { openaiModelFromEnv } from "./openai.mjs";
import { fieldOf } from "../../plugin/scripts/lib/safe-read.mjs";
import { isText } from "../../plugin/scripts/lib/values.mjs";

/** @typedef {import("./cases.mjs").SourcedCase} SourcedCase */
/** @typedef {import("./corpus.mjs").Skill} Skill */

const PUBLISHED_FILE = new URL("../../evals/packages.json", import.meta.url);
export const EXIT = { ok: 0, failed: 1, usage: 2 };
export const BACKENDS = {
  baseline: "baseline",
  anthropic: "anthropic",
  openai: "openai",
};
export const DIRECT_MODES = ["trigger", "answers"];

/** @type {{ type: "string" }} */
const TEXT = { type: "string" };
/** @type {{ type: "string", multiple: true }} */
const TEXTS = { type: "string", multiple: true };
/** @type {{ type: "boolean" }} */
const FLAG = { type: "boolean" };
/** @type {{ type: "boolean", short: "h" }} */
const HELP = { type: "boolean", short: "h" };

export const OPTIONS = {
  backend: TEXT,
  project: TEXT,
  skills: TEXTS,
  packages: TEXT,
  published: FLAG,
  cases: TEXT,
  only: TEXT,
  area: TEXT,
  "min-recall": TEXT,
  "min-precision": TEXT,
  "max-invented": TEXT,
  model: TEXT,
  models: TEXT,
  out: TEXT,
  offline: FLAG,
  "dry-run": FLAG,
  json: FLAG,
  "no-skills": FLAG,
  modes: TEXT,
  runs: TEXT,
  jobs: TEXT,
  timeout: TEXT,
  "claude-bin": TEXT,
  "codex-bin": TEXT,
  against: TEXT,
  touched: TEXT,
  "new-cases": TEXT,
  report: FLAG,
  help: HELP,
};

/**
 * The options a command line gives, as `parseArgs` reads them with `OPTIONS`.
 * @typedef {ReturnType<typeof import("node:util").parseArgs<{ options: typeof OPTIONS }>>["values"]} EvalValues
 */

/**
 * Where the skills of a run come from.
 * @typedef {object} CorpusSelection
 * @property {string | undefined} project
 * @property {string[]} dirs
 * @property {string[]} packages
 */

export const USAGE = `Usage: evals [trigger|answers] [options]
       evals prepare --out <dir> [options]
       evals exec <dir> [options]
       evals score <dir> [options]
       evals lift <dir-with-skills> <dir-without-skills>
       evals check [options]

Corpus (default: the current directory as a project):
  --project <dir>        skills the sync finds in a project (workspace, node_modules, .antelope/cache)
  --skills <dir>         every SKILL.md under <dir> (repeatable; wins over the project's)
  --packages <a,b>       skills shipped by these npm packages (fetched, not installed)
  --published            the packages listed in evals/packages.json

Cases: evals/cases.json plus the skills/<name>/cases.json of every corpus skill
  --cases <file>         central dataset (default: evals/cases.json)
  --only <id,id>         run these cases only
  --area <a,b>           run these areas only (framework, dms, dms-ai, modules, install, verify)

Direct run (trigger, answers):
  --backend <name>       baseline (trigger default), anthropic (answers default), openai, or a module path
                         exporting complete({ system, user, schema, effort, maxTokens })
  --model <id>           model for the anthropic backend (default: $EVAL_MODEL or ${modelFromEnv({})}),
                         or the openai backend ($EVAL_OPENAI_MODEL or ${openaiModelFromEnv({})})
  --min-recall <0-1>     trigger: fail under this mean recall
  --min-precision <0-1>  trigger: fail under this mean precision
  --max-invented <0-1>   answers: fail over this invented API rate
  --project <dir>        answers: also where verify resolves packages (default: cwd)
  --offline              answers: verify without fetching interface packages from npm
  --out <dir>            answers: write each answer to <dir>/<case>.md
  --dry-run              print the model requests instead of sending them
  --json                 machine-readable result

Without a key the model-backed backends print a notice and exit 0.

prepare: one request file (system, user, schema) per case and model under --out
  --models <ids>         comma-separated: ${MATRIX.map((entry) => entry.id).join(", ")} (default: all),
                         or claude:<model>[:<effort>] / codex[:<model>] specs
  --modes <a,b>          trigger, answers (default: both)
  --runs <n>             answers runs per case (default: 2)
  --no-skills            answers requests load no skill (the baseline of the lift)

exec: answers the pending requests through the local claude and codex CLIs, in sanitized directories
  --models <ids>         only these models of the run
  --jobs <n>             parallel CLI calls (default: ${DEFAULT_JOBS})
  --timeout <seconds>    per call (default: 300)
  --claude-bin <path>    the claude CLI (default: claude)
  --codex-bin <path>     the codex CLI (default: codex)

score: reads the answer files, checks them and applies the pass bar
  --against <dir>        the run of main's skills, for the regression and corpus-drop checks
  --touched <a,b>        skills the floors apply to (default: every skill with cases)
  --new-cases <id,id>    cases that must pass on every model
  --only <id,id>         score these cases of the run only
  --project <dir>        where verify resolves packages (default: cwd)
  --offline              verify without fetching interface packages from npm
  --report               print the Markdown Eval report
  --json                 machine-readable result

check: validates every case file and, for the skills of the selected corpus, the case minimum
`;

/**
 * @param {string} message
 * @returns {never}
 */
export function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(EXIT.usage);
}

/**
 * @param {string | undefined} value
 * @param {string} name
 * @returns {number | undefined}
 */
export function parseRatio(value, name) {
  if (value === undefined) return undefined;
  const ratio = Number(value);
  if (!(ratio >= 0 && ratio <= 1))
    fail(`--${name} expects a number between 0 and 1`);
  return ratio;
}

/**
 * @template {number | undefined} Fallback
 * @param {string | undefined} value
 * @param {string} name
 * @param {Fallback} fallback
 * @returns {number | Fallback}
 */
export function parseCount(value, name, fallback) {
  if (value === undefined) return fallback;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1)
    fail(`--${name} expects a positive integer`);
  return count;
}

/**
 * @param {string | undefined} value
 * @returns {string[]}
 */
export function listOption(value) {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

/**
 * @param {EvalValues} values
 * @returns {boolean}
 */
export function hasCorpusOption(values) {
  return Boolean(
    values.project ||
    values.skills?.length ||
    values.packages ||
    values.published,
  );
}

/**
 * @param {EvalValues} values
 * @param {{ defaultProject?: boolean }} [options]
 * @returns {CorpusSelection}
 */
export function corpusOptions(values, { defaultProject = true } = {}) {
  const published = values.published
    ? fieldOf(readJsonFile(PUBLISHED_FILE), "packages")
    : [];
  if (!Array.isArray(published) || !published.every(isText))
    throw new TypeError(
      "evals/packages.json must hold a list of package names",
    );
  const packages = [...listOption(values.packages), ...published];
  const dirs = values.skills ?? [];
  const project =
    values.project ??
    (defaultProject && !dirs.length && !packages.length
      ? process.cwd()
      : undefined);
  return { project, dirs, packages };
}

/**
 * @param {EvalValues} values
 * @param {{ name: string, dir: string }[]} skills
 * @returns {{ selected: SourcedCase[], shadowed: SourcedCase[] }}
 */
export function selectCases(values, skills) {
  const only = new Set(listOption(values.only));
  const areas = new Set(listOption(values.area));
  const { cases, shadowed } = loadCases({
    skills,
    centralFile: values.cases ? resolve(values.cases) : undefined,
  });
  const selected = cases.filter(
    (item) =>
      (!only.size || only.has(item.id)) &&
      (!areas.size || areas.has(item.area)),
  );
  return { selected, shadowed };
}

/**
 * @param {EvalValues} values
 * @param {{ defaultProject?: boolean }} [options]
 * @returns {Promise<Skill[]>}
 */
export async function loadSkills(values, options) {
  const { skills, duplicates } = await loadCorpus(
    corpusOptions(values, options),
  );
  if (!skills.length)
    fail(
      "the corpus is empty: no SKILL.md found (see --project, --skills, --packages)",
    );
  if (duplicates.length)
    process.stderr.write(
      `note: kept the first of each duplicate skill (${duplicates.map((d) => d.name).join(", ")})\n`,
    );
  return skills;
}
