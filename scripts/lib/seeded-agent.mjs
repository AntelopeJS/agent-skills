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

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const DEFAULT_EFFORT = "medium";
export const DEFAULT_TIMEOUT_SECONDS = 1800;
export const DEFAULT_MAX_BUDGET_USD = 5;
export const RESULTS = ["PASS", "PASS+NOTES", "FAIL"];
export const TOOLS = ["Bash", "Read", "Grep", "Glob"];
const MILLISECONDS = 1000;
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
  required: ["result", "failedFeatures", "notRun", "doors", "summary"],
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
    doors: {
      type: "array",
      items: { type: "string" },
      description:
        "The kind of each row of the verdict's One-way doors section; empty when the section says None. Doors judged false positives are not rows.",
    },
    summary: { type: "string" },
  },
};

/** The prompt every case gets: the change is never described, only the skill. */
export function buildPrompt({ skill, baseSha }) {
  return [
    `You are the fresh verifier of a change. This checkout holds one commit on top of base commit ${baseSha}, which \`origin/main\` points at. You did not write the change and do not know what it does.`,
    `Follow the verification skill at .agents/skills/${skill}/SKILL.md exactly, from its setup to its verdict rules: run what it tells you to run for this diff, read the evidence and judge it as the skill says. Install dependencies only if they are missing. Do not guess the feature from the diff alone when the skill gives a command that maps the diff.`,
    "Limits. Work only inside the current directory and the run folders the skill's commands create. You have no GitHub credentials and no push access, and you must not try to get them. Never run the skill's publish step or any other command that posts, comments, pushes or sets a status. When a command needs a pull request number only to render the verdict locally, pass 1.",
    "Finish with your Verdict as the structured result: `result` (PASS, PASS+NOTES or FAIL by the skill's rules), `failedFeatures` (the Feature map names that made it FAIL), `notRun` (the required journeys that did not run or finish, as feature/journey), `doors` (the kind of each row of the One-way doors section, from the skill's door scan), and a short `summary`.",
  ].join("\n\n");
}

/** Builds the isolated config home of one agent: a temporary HOME, a Claude config directory holding only a link to the login, and a private TMPDIR where the harness keeps the runs the case starts. */
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

export function removeAgentHome(agentHome) {
  rmSync(agentHome.dir, { recursive: true, force: true });
  rmSync(agentHome.tmp, { recursive: true, force: true });
}

/** `env` without credentials: GitHub and SSH access, tokens, keys, agent-session variables. */
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

/** The `claude -p` call for one case, as a command line and its stdin. */
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

function cleanVerdict(value) {
  const list = (items) =>
    Array.isArray(items) ? items.map(String) : undefined;
  if (!RESULTS.includes(value?.result)) return undefined;
  const failedFeatures = list(value.failedFeatures);
  const notRun = list(value.notRun);
  const doors = list(value.doors);
  if (!failedFeatures || !notRun || !doors) return undefined;
  return {
    result: value.result,
    failedFeatures,
    notRun,
    doors,
    summary: String(value.summary ?? ""),
  };
}

/** Reads `claude -p --output-format json`: the verdict, the cost and the models that ran. */
export function parseAgentOutput(stdout) {
  let reply;
  try {
    reply = JSON.parse(stdout);
  } catch {
    return { error: "claude printed no JSON" };
  }
  const usage = reply.usage ?? {};
  return {
    verdict: reply.is_error ? undefined : cleanVerdict(reply.structured_output),
    error: reply.is_error
      ? String(reply.result ?? reply.subtype)
      : reply.structured_output
        ? undefined
        : `no structured verdict (${reply.subtype ?? "unknown"})`,
    costUsd: reply.total_cost_usd,
    durationMs: reply.duration_ms,
    turns: reply.num_turns,
    tokens: {
      input: usage.input_tokens,
      output: usage.output_tokens,
      cacheRead: usage.cache_read_input_tokens,
      cacheWrite: usage.cache_creation_input_tokens,
    },
    models: Object.keys(reply.modelUsage ?? {}),
  };
}

/**
 * Runs the headless verifier on a scratch checkout. Resolves with the parsed
 * output, or `{ error, timedOut }` when the run died, hit its wall-time cap or
 * its budget; it never rejects on the agent's own failure.
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
    });
    return {
      prompt,
      wallMs: Date.now() - started,
      ...parseAgentOutput(stdout),
    };
  } catch (error) {
    const partial = error.stdout ? parseAgentOutput(error.stdout) : {};
    return {
      prompt,
      wallMs: Date.now() - started,
      ...partial,
      verdict: undefined,
      timedOut: Boolean(error.timedOut),
      error: error.timedOut
        ? `timed out after ${timeoutSeconds} s`
        : (partial.error ?? error.message),
    };
  }
}
