import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { spawnRun } from "./executors.mjs";
import { parseJson } from "./json.mjs";
import { fieldOf } from "./safe-read.mjs";
import { isRecord, isText } from "./values.mjs";

/** @typedef {import("./executors.mjs").SpawnRunner} SpawnRunner */

/**
 * The verdict the headless verifier ends with. `passed` is absent from the
 * verdicts that were recorded before the field existed.
 * @typedef {object} SeededVerdict
 * @property {string} result One of {@link RESULTS}.
 * @property {string[]} failedFeatures
 * @property {string[]} notRun
 * @property {string[]} [passed]
 * @property {string[]} doors
 * @property {string} summary
 */

/**
 * The token counts `claude -p` reports.
 * @typedef {object} AgentTokens
 * @property {number | undefined} input
 * @property {number | undefined} output
 * @property {number | undefined} cacheRead
 * @property {number | undefined} cacheWrite
 */

/**
 * What `claude -p --output-format json` printed, read.
 * @typedef {object} AgentOutput
 * @property {SeededVerdict} [verdict]
 * @property {string} [error]
 * @property {number} [costUsd]
 * @property {number} [durationMs]
 * @property {number} [turns]
 * @property {AgentTokens} [tokens]
 * @property {string[]} [models]
 */

/**
 * What a run of the agent came to: its prompt, wall time and parsed output,
 * and whether it timed out or was interrupted.
 * @typedef {AgentOutput & { prompt: string, wallMs: number, timedOut?: boolean, interrupted?: boolean }} AgentOutcome
 */

/**
 * The folders of one agent's isolated config home.
 * @typedef {object} AgentDirs
 * @property {string} home
 * @property {string} config
 * @property {string} tmp
 */

/**
 * @typedef {AgentDirs & { dir: string }} AgentHome
 */

/**
 * The scratch checkout the agent runs in.
 * @typedef {object} AgentScratch
 * @property {string} dir
 * @property {string} baseSha
 */

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const DEFAULT_EFFORT = "medium";
export const DEFAULT_TIMEOUT_SECONDS = 1800;
export const DEFAULT_MAX_BUDGET_USD = 5;
/** @type {string[]} */
export const RESULTS = ["PASS", "PASS+NOTES", "FAIL"];
/** @type {string[]} */
export const TOOLS = ["Bash", "Read", "Grep", "Glob"];
const MILLISECONDS = 1000;
/** @type {string[]} */
const KEPT_ENV = [
  "PATH",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "SHELL",
  "USER",
  "LOGNAME",
  "COREPACK_HOME",
  "DOCKER_HOST",
];
const SECRET_NAME_RE =
  /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PAT|KEY|AUTH|CREDENTIALS?)(?:_|$)|^(?:GH|GITHUB|SSH|GIT_ASKPASS|CLAUDE|AI_AGENT)/i;

/** The schema of the verdict the headless verifier must end with. */
export const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "result",
    "failedFeatures",
    "notRun",
    "passed",
    "doors",
    "summary",
  ],
  properties: {
    result: { type: "string", enum: RESULTS },
    failedFeatures: {
      type: "array",
      items: { type: "string" },
      description:
        "Names of the Feature map entries whose journeys or rules failed the verdict; empty unless the result is FAIL.",
    },
    notRun: {
      type: "array",
      items: { type: "string" },
      description:
        "The journeys the plan required, as feature/journey, that did not run or did not finish, for any reason such as a run that could not start; empty when every required journey ran.",
    },
    passed: {
      type: "array",
      items: { type: "string" },
      description:
        "The journeys that ran and passed, as feature/journey; a journey reported not verified is not listed.",
    },
    doors: {
      type: "array",
      items: { type: "string" },
      description:
        "The kind of each row of the verdict's One-way doors section; empty when the section says None. Doors judged false positives are not rows.",
    },
    summary: { type: "string" },
  },
};

/**
 * The prompt every case gets: the change is never described, only the skill.
 * @param {{ skill: string, baseSha: string }} request
 * @returns {string}
 */
export function buildPrompt({ skill, baseSha }) {
  return [
    `You are the fresh verifier of a change. This checkout holds one commit on top of base commit ${baseSha}, which \`origin/main\` points at. You did not write the change and do not know what it does.`,
    `Follow the verification skill at .agents/skills/${skill}/SKILL.md exactly, from its setup to its verdict rules: run what it tells you to run for this diff, read the evidence and judge it as the skill says. Install dependencies only if they are missing. Do not guess the feature from the diff alone when the skill gives a command that maps the diff.`,
    "Limits. Work only inside the current directory and the run folders the skill's commands create. You have no GitHub credentials and no push access, and you must not try to get them. Never run the skill's publish step or any other command that posts, comments, pushes or sets a status. When a command needs a pull request number only to render the verdict locally, pass 1.",
    "Finish with your Verdict as the structured result: `result` (PASS, PASS+NOTES or FAIL by the skill's rules), `failedFeatures` (the Feature map names that made it FAIL), `notRun` (the required journeys that did not run or finish, as feature/journey), `passed` (the journeys that ran and passed, as feature/journey), `doors` (the kind of each row of the One-way doors section, from the skill's door scan), and a short `summary`.",
  ].join("\n\n");
}

/**
 * Builds the isolated config home of one agent: a temporary HOME, a Claude config directory holding only a link to the login, and a private TMPDIR where the harness keeps the runs the case starts.
 * @param {{ root?: string, configDir?: string }} [where]
 * @returns {AgentHome}
 */
export function createAgentHome({
  root = tmpdir(),
  configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
} = {}) {
  const dir = mkdtempSync(join(root, "seeded-agent-"));
  const home = join(dir, "home");
  const config = join(dir, "claude");
  const tmp = mkdtempSync(join(tmpdir(), "seeded-tmp-"));
  mkdirSync(home);
  mkdirSync(config);
  const credentials = join(configDir, ".credentials.json");
  if (existsSync(credentials))
    symlinkSync(credentials, join(config, ".credentials.json"));
  return { dir, home, config, tmp };
}

/**
 * @param {AgentHome} agentHome
 * @returns {void}
 */
export function removeAgentHome(agentHome) {
  rmSync(agentHome.dir, { recursive: true, force: true });
  rmSync(agentHome.tmp, { recursive: true, force: true });
}

/**
 * `env` without credentials: GitHub and SSH access, tokens, keys, agent-session variables.
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
export function withoutCredentials(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !SECRET_NAME_RE.test(name)),
  );
}

/**
 * The environment of a headless verifier. Only an allowlist of the caller's
 * variables passes (plus any in `passEnv`); HOME and the Claude config are
 * the temporary ones, and the XDG cache is `cacheHome` (default: the caller's)
 * so a warm pnpm store and base builds are reused. No GitHub token, `gh` login or SSH agent
 * reaches the agent.
 * @param {{ agentHome: AgentDirs, env?: NodeJS.ProcessEnv, passEnv?: string[], cacheHome?: string }} request
 * @returns {NodeJS.ProcessEnv}
 */
export function agentEnv({
  agentHome,
  env = process.env,
  passEnv = [],
  cacheHome = env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
}) {
  const kept = Object.fromEntries(
    [...KEPT_ENV, ...passEnv]
      .filter((name) => env[name] !== undefined)
      .map((name) => [name, env[name]]),
  );
  return {
    ...kept,
    HOME: agentHome.home,
    TMPDIR: agentHome.tmp,
    DMS_CONTROL_RUNS: join(agentHome.tmp, "dms-control"),
    CLAUDE_CONFIG_DIR: agentHome.config,
    XDG_CACHE_HOME: cacheHome,
    COREPACK_HOME:
      env.COREPACK_HOME ?? join(homedir(), ".cache", "node", "corepack"),
    CI: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "seeded-eval",
    GIT_AUTHOR_EMAIL: "eval@invalid",
    GIT_COMMITTER_NAME: "seeded-eval",
    GIT_COMMITTER_EMAIL: "eval@invalid",
    DISABLE_AUTOUPDATER: "1",
  };
}

/**
 * The `claude -p` call for one case, as a command line and its stdin.
 * @param {{ prompt: string, model: string, effort?: string, maxBudget: number }} request
 * @returns {{ args: string[], input: string }}
 */
export function agentInvocation({ prompt, model, effort, maxBudget }) {
  return {
    args: [
      "-p",
      "--model",
      model,
      ...(effort ? ["--effort", effort] : []),
      "--setting-sources",
      "",
      "--disable-slash-commands",
      "--strict-mcp-config",
      "--no-session-persistence",
      "--tools",
      TOOLS.join(","),
      "--allowedTools",
      TOOLS.join(","),
      "--max-budget-usd",
      String(maxBudget),
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(VERDICT_SCHEMA),
    ],
    input: prompt,
  };
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isNumber(value) {
  return typeof value === "number";
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function numberOf(value) {
  return isNumber(value) ? value : undefined;
}

/**
 * @param {unknown} value
 * @returns {SeededVerdict | undefined}
 */
function cleanVerdict(value) {
  /**
   * @param {unknown} items
   * @returns {string[] | undefined}
   */
  const list = (items) =>
    Array.isArray(items) ? items.map(String) : undefined;
  const result = fieldOf(value, "result");
  if (!isText(result) || !RESULTS.includes(result)) return undefined;
  const failedFeatures = list(fieldOf(value, "failedFeatures"));
  const notRun = list(fieldOf(value, "notRun"));
  const doors = list(fieldOf(value, "doors"));
  if (!failedFeatures || !notRun || !doors) return undefined;
  const summary = fieldOf(value, "summary");
  return {
    result,
    failedFeatures,
    notRun,
    passed: list(fieldOf(value, "passed")) ?? [],
    doors,
    summary: isText(summary) ? summary : "",
  };
}

/**
 * Reads `claude -p --output-format json`: the verdict, the cost and the models that ran.
 * @param {string} stdout
 * @returns {AgentOutput}
 */
export function parseAgentOutput(stdout) {
  let reply;
  try {
    reply = parseJson(stdout);
  } catch {
    return { error: "claude printed no JSON" };
  }
  const usage = fieldOf(reply, "usage");
  const modelUsage = fieldOf(reply, "modelUsage");
  const structured = fieldOf(reply, "structured_output");
  const subtype = fieldOf(reply, "subtype");
  return {
    verdict: fieldOf(reply, "is_error") ? undefined : cleanVerdict(structured),
    error: fieldOf(reply, "is_error")
      ? String(fieldOf(reply, "result") ?? subtype)
      : structured
        ? undefined
        : `no structured verdict (${isText(subtype) ? subtype : "unknown"})`,
    costUsd: numberOf(fieldOf(reply, "total_cost_usd")),
    durationMs: numberOf(fieldOf(reply, "duration_ms")),
    turns: numberOf(fieldOf(reply, "num_turns")),
    tokens: {
      input: numberOf(fieldOf(usage, "input_tokens")),
      output: numberOf(fieldOf(usage, "output_tokens")),
      cacheRead: numberOf(fieldOf(usage, "cache_read_input_tokens")),
      cacheWrite: numberOf(fieldOf(usage, "cache_creation_input_tokens")),
    },
    models: isRecord(modelUsage) ? Object.keys(modelUsage) : [],
  };
}

/**
 * @param {unknown} error
 * @param {AgentOutput} partial
 * @param {number} timeoutSeconds
 * @returns {string | undefined}
 */
function agentError(error, partial, timeoutSeconds) {
  if (fieldOf(error, "interrupted")) return "interrupted";
  if (fieldOf(error, "timedOut")) return `timed out after ${timeoutSeconds} s`;
  const message = fieldOf(error, "message");
  return partial.error ?? (isText(message) ? message : undefined);
}

/**
 * Runs the headless verifier on a scratch checkout. Resolves with the parsed
 * output, or `{ error, timedOut, interrupted }` when the run died, hit its
 * wall-time cap or its budget, or `signal` aborted and killed its process
 * group; it never rejects on the agent's own failure.
 * @param {object} request
 * @param {AgentScratch} request.scratch
 * @param {string} request.skill
 * @param {AgentDirs} request.agentHome
 * @param {string} [request.model]
 * @param {string} [request.effort]
 * @param {number} [request.maxBudget]
 * @param {number} [request.timeoutSeconds]
 * @param {string} [request.claudeBin]
 * @param {string[]} [request.passEnv]
 * @param {string} [request.cacheHome]
 * @param {SpawnRunner} [request.run]
 * @param {AbortSignal} [request.signal]
 * @returns {Promise<AgentOutcome>}
 */
export async function runAgent({
  scratch,
  skill,
  agentHome,
  model = DEFAULT_MODEL,
  effort = DEFAULT_EFFORT,
  maxBudget = DEFAULT_MAX_BUDGET_USD,
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
  claudeBin = "claude",
  passEnv = [],
  cacheHome,
  run = spawnRun,
  signal,
}) {
  const prompt = buildPrompt({ skill, baseSha: scratch.baseSha });
  const { args, input } = agentInvocation({ prompt, model, effort, maxBudget });
  const started = Date.now();
  try {
    const { stdout } = await run({
      command: claudeBin,
      args,
      input,
      env: agentEnv({ agentHome, passEnv, cacheHome }),
      cwd: scratch.dir,
      timeoutMs: timeoutSeconds * MILLISECONDS,
      group: true,
      signal,
    });
    return {
      prompt,
      wallMs: Date.now() - started,
      ...parseAgentOutput(stdout),
    };
  } catch (error) {
    const stdout = fieldOf(error, "stdout");
    const partial = isText(stdout) && stdout ? parseAgentOutput(stdout) : {};
    return {
      prompt,
      wallMs: Date.now() - started,
      ...partial,
      verdict: undefined,
      timedOut: Boolean(fieldOf(error, "timedOut")),
      interrupted: Boolean(fieldOf(error, "interrupted")),
      error: agentError(error, partial, timeoutSeconds),
    };
  }
}
