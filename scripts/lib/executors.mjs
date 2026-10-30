import { spawn, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import {
  answerFile,
  errorFile,
  listTasks,
  readManifest,
  readRequest,
  writeAnswer,
} from "./requests.mjs";
import { parseJson } from "./json.mjs";
import { isRecord, isText } from "./values.mjs";

/** @typedef {import("./matrix.mjs").MatrixEntry} MatrixEntry */
/** @typedef {import("./model.mjs").ModelRequest} ModelRequest */
/** @typedef {import("./requests.mjs").RunTask} RunTask */

/**
 * One command to run: what to execute, what to feed it, where and for how long.
 * @typedef {object} SpawnCall
 * @property {string} command
 * @property {string[]} args
 * @property {string} input Written to the command's stdin.
 * @property {NodeJS.ProcessEnv} env
 * @property {string} cwd
 * @property {number} timeoutMs
 * @property {boolean} [group] Whether the command leads its own process group.
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {object} SpawnResult
 * @property {string} stdout
 */

/**
 * Runs a command; `spawnRun` is the real one.
 * @typedef {(call: SpawnCall) => Promise<SpawnResult>} SpawnRunner
 */

/**
 * What a run that failed carries besides the error message.
 * @typedef {Error & { stdout: string, timedOut: boolean, interrupted: boolean }} SpawnFailure
 */

/**
 * A command line and the text it reads on stdin.
 * @typedef {object} Invocation
 * @property {string[]} args
 * @property {string} input
 */

/**
 * The files `codex exec` writes its reply to and reads its schema from.
 * @typedef {object} CodexFiles
 * @property {string} out
 * @property {string} schema
 */

/**
 * What an executor returned for a request: the reply and the models the CLI says served it.
 * @typedef {object} ExecutorReply
 * @property {string} text
 * @property {string[]} models
 */

/**
 * The binary to run per executor name.
 * @typedef {Record<string, string>} ExecutorBins
 */

/**
 * @typedef {object} ExecOptions
 * @property {number} [jobs]
 * @property {number} [timeoutMs]
 * @property {ExecutorBins} [bins]
 * @property {SpawnRunner} [run]
 */

/**
 * @typedef {object} ExecContext
 * @property {SpawnRunner} run
 * @property {ExecutorBins} bins
 * @property {number} timeoutMs
 * @property {string} codexHome
 */

/**
 * A task that failed after its retry and the message of its last error.
 * @typedef {object} ExecFailure
 * @property {RunTask} task
 * @property {string} error
 */

/**
 * @typedef {object} ExecResult
 * @property {number} executed
 * @property {ExecFailure[]} failed
 */

/**
 * `executor.json`: how a model's answers were produced.
 * @typedef {object} ExecutorRecord
 * @property {string} executor
 * @property {string | null} requestedModel
 * @property {string | null} effort
 * @property {string[]} observedModels
 * @property {string} cli
 * @property {string[]} sanitization
 * @property {string} at
 */

/**
 * The record of a model, or an empty one when no run wrote it yet.
 * @typedef {ExecutorRecord | Record<string, never>} StoredExecutorRecord
 */

export const DEFAULT_JOBS = 4;
const DEFAULT_TIMEOUT_MS = 300_000;
const ATTEMPTS = 2;
const SCRUBBED_ENV_RE = /^(?:CLAUDECODE|CLAUDE_(?!CONFIG_DIR$).*|AI_AGENT)$/;
const EXECUTOR_FILE = "executor.json";

/**
 * What each local executor does so that none loads the user's own setup.
 * @type {Record<string, string[]>}
 */
export const SANITIZATION = {
  claude: [
    "empty temporary working directory",
    "--setting-sources '' (no user, project or local settings, CLAUDE.md or plugins)",
    "--disable-slash-commands (no skills)",
    "--tools '' (no tools)",
    "--strict-mcp-config (no MCP servers)",
    "--system-prompt-file replaces the default system prompt",
    "--no-session-persistence",
    "CLAUDECODE and CLAUDE_* variables removed from the environment",
  ],
  codex: [
    "empty temporary working directory",
    "CODEX_HOME is a temporary directory holding only a link to auth.json and an empty config.toml (no AGENTS.md, skills, memories or plugins)",
    "--ignore-user-config and --ignore-rules",
    "--ephemeral and a read-only sandbox",
    "the CLI's own default GPT model and effort",
  ],
};

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
function scrubbedEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !SCRUBBED_ENV_RE.test(name)),
  );
}

/**
 * @param {import("node:child_process").ChildProcess} child
 * @param {boolean} group
 * @returns {void}
 */
function killTree(child, group) {
  try {
    if (group && child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/**
 * Runs a command with `input` on stdin; resolves with its stdout. With
 * `group`, the command leads its own process group and a timeout or a finished
 * run kills the whole group, so processes it started do not outlive it. When
 * `signal` aborts, the command (its whole group with `group`) is killed and the
 * run rejects with `interrupted` set. A rejection carries the `stdout` and
 * whether it `timedOut`.
 * @param {SpawnCall} call
 * @returns {Promise<SpawnResult>}
 */
export function spawnRun({
  command,
  args,
  input,
  env,
  cwd,
  timeoutMs,
  group = false,
  signal,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: group,
      stdio: ["pipe", "pipe", "pipe"],
    });
    /** @type {Buffer[]} */
    const out = [];
    /** @type {Buffer[]} */
    const err = [];
    let timedOut = false;
    let interrupted = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, group);
    }, timeoutMs);
    const onAbort = () => {
      interrupted = true;
      killTree(child, group);
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on(
      "data",
      /** @param {Buffer} chunk */ (chunk) => out.push(chunk),
    );
    child.stderr.on(
      "data",
      /** @param {Buffer} chunk */ (chunk) => err.push(chunk),
    );
    child.on("error", reject);
    child.on("close", (code, killedBy) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (group) killTree(child, group);
      const stdout = Buffer.concat(out).toString("utf8");
      if (code === 0) return resolve({ stdout });
      const tail = Buffer.concat(err).toString("utf8").trim().slice(-400);
      reject(
        Object.assign(
          new Error(`${command} exited with ${code ?? killedBy}: ${tail}`),
          { stdout, timedOut, interrupted },
        ),
      );
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}

/**
 * The `claude -p` call for one request, as a command line and its stdin.
 * @param {MatrixEntry} entry
 * @param {ModelRequest} request
 * @param {string} systemFile
 * @returns {Invocation}
 */
export function claudeInvocation(entry, request, systemFile) {
  return {
    args: [
      "-p",
      "--model",
      entry.model,
      ...(entry.effort ? ["--effort", entry.effort] : []),
      "--setting-sources",
      "",
      "--disable-slash-commands",
      "--tools",
      "",
      "--strict-mcp-config",
      "--no-session-persistence",
      "--system-prompt-file",
      systemFile,
      "--output-format",
      "json",
      ...(request.schema
        ? ["--json-schema", JSON.stringify(request.schema)]
        : []),
    ],
    input: request.user,
  };
}

/**
 * The prompt `codex exec` gets: Codex has no system prompt option.
 * @param {ModelRequest} request
 * @returns {string}
 */
export function codexPrompt(request) {
  return [
    `<instructions>\n${request.system.trim()}\n</instructions>`,
    `<request>\n${request.user}\n</request>`,
    "Reply with the final answer as plain text only. Do not run commands or read files.",
  ].join("\n\n");
}

/**
 * The `codex exec` call for one request, as a command line and its stdin.
 * @param {MatrixEntry} entry
 * @param {ModelRequest} request
 * @param {CodexFiles} files
 * @returns {Invocation}
 */
export function codexInvocation(entry, request, files) {
  return {
    args: [
      "exec",
      "--ignore-user-config",
      "--ignore-rules",
      "--ephemeral",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--output-last-message",
      files.out,
      ...(entry.model ? ["--model", entry.model] : []),
      ...(entry.effort
        ? ["--config", `model_reasoning_effort="${entry.effort}"`]
        : []),
      ...(request.schema ? ["--output-schema", files.schema] : []),
      "-",
    ],
    input: codexPrompt(request),
  };
}

/**
 * @param {string} stdout
 * @returns {ExecutorReply}
 */
function parseClaude(stdout) {
  const result = parseJson(stdout);
  if (!isRecord(result)) throw new Error("claude printed no JSON object");
  if (result.is_error)
    throw new Error("claude reported an error: " + result.result);
  if (!isText(result.result)) throw new Error("claude gave no result text");
  return {
    text: result.result,
    models: isRecord(result.modelUsage) ? Object.keys(result.modelUsage) : [],
  };
}

/**
 * @param {ExecContext} context
 * @param {MatrixEntry} entry
 * @param {ModelRequest} request
 * @param {string} scratch
 * @returns {Promise<ExecutorReply>}
 */
async function runClaude(context, entry, request, scratch) {
  const systemFile = join(scratch, "system.txt");
  writeFileSync(systemFile, request.system);
  const { args, input } = claudeInvocation(entry, request, systemFile);
  const { stdout } = await context.run({
    command: context.bins.claude,
    args,
    input,
    env: scrubbedEnv(process.env),
    cwd: scratch,
    timeoutMs: context.timeoutMs,
  });
  return parseClaude(stdout);
}

/**
 * @param {ExecContext} context
 * @param {MatrixEntry} entry
 * @param {ModelRequest} request
 * @param {string} scratch
 * @returns {Promise<ExecutorReply>}
 */
async function runCodex(context, entry, request, scratch) {
  const files = {
    out: join(scratch, "reply.txt"),
    schema: join(scratch, "schema.json"),
  };
  if (request.schema)
    writeFileSync(files.schema, JSON.stringify(request.schema));
  const { args, input } = codexInvocation(entry, request, files);
  await context.run({
    command: context.bins.codex,
    args,
    input,
    env: { ...process.env, CODEX_HOME: context.codexHome },
    cwd: scratch,
    timeoutMs: context.timeoutMs,
  });
  return { text: readFileSync(files.out, "utf8"), models: [] };
}

/**
 * @typedef {(context: ExecContext, entry: MatrixEntry, request: ModelRequest, scratch: string) => Promise<ExecutorReply>} Runner
 */

/** @type {Record<string, Runner>} */
const RUNNERS = { claude: runClaude, codex: runCodex };

/**
 * @param {ExecContext} context
 * @param {MatrixEntry} entry
 * @param {ModelRequest} request
 * @returns {Promise<ExecutorReply>}
 */
async function execute(context, entry, request) {
  const scratch = mkdtempSync(join(tmpdir(), "ajs-eval-job-"));
  try {
    return await RUNNERS[entry.executor](context, entry, request, scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * @param {ExecContext} context
 * @param {MatrixEntry} entry
 * @param {ModelRequest} request
 * @returns {Promise<ExecutorReply>}
 */
async function attempt(context, entry, request) {
  /** @type {unknown} */
  let last;
  for (let tries = 0; tries < ATTEMPTS; tries += 1) {
    try {
      return await execute(context, entry, request);
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

/**
 * @param {string} root
 * @returns {string}
 */
function prepareCodexHome(root) {
  const home = join(root, "codex-home");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "config.toml"), "");
  const source = join(
    process.env.CODEX_HOME ?? join(homedir(), ".codex"),
    "auth.json",
  );
  if (existsSync(source)) symlinkSync(source, join(home, "auth.json"));
  return home;
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<void>} worker
 * @returns {Promise<void>}
 */
export async function pool(items, limit, worker) {
  const queue = [...items];
  const workers = Array.from(
    { length: Math.min(limit, queue.length) },
    async () => {
      while (queue.length) await worker(queue.shift());
    },
  );
  await Promise.all(workers);
}

/**
 * @param {string} home
 * @returns {string[]}
 */
function codexDefaultModel(home) {
  const file = join(home, "models_cache.json");
  if (!existsSync(file)) return [];
  const listed = JSON.parse(readFileSync(file, "utf8")).models.filter(
    (model) => model.visibility === "list",
  );
  const [first] = listed.sort((left, right) => left.priority - right.priority);
  return first ? [first.slug] : [];
}

/**
 * @param {string} dir
 * @param {MatrixEntry} entry
 * @returns {StoredExecutorRecord}
 */
function readExecutorRecord(dir, entry) {
  const file = join(dir, entry.id, EXECUTOR_FILE);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

/**
 * @param {string} bin
 * @returns {string}
 */
function cliVersion(bin) {
  try {
    return execFileSync(bin, ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * @param {string} dir
 * @param {MatrixEntry} entry
 * @param {{ bins: ExecutorBins, observed: string[], at: string }} seen
 * @returns {void}
 */
function writeExecutorRecord(dir, entry, { bins, observed, at }) {
  const previous = readExecutorRecord(dir, entry);
  const record = {
    executor: entry.executor,
    requestedModel: entry.model,
    effort: entry.effort,
    observedModels: [
      ...new Set([...(previous.observedModels ?? []), ...observed]),
    ],
    cli: cliVersion(bins[entry.executor]),
    sanitization: SANITIZATION[entry.executor],
    at,
  };
  writeFileSync(
    join(dir, entry.id, EXECUTOR_FILE),
    `${JSON.stringify(record, null, 2)}\n`,
  );
}

/**
 * Answers every pending task of a prepared run through the local CLIs
 * (`claude -p`, `codex exec`), in sanitized directories. Tasks that already
 * have an answer file are skipped, so an interrupted run resumes. Returns the
 * tasks that failed after a retry; each leaves an `.error.txt` beside it.
 * @param {object} run
 * @param {string} run.dir
 * @param {string[]} [run.models] The matrix ids to answer; all of the run's by default.
 * @param {ExecOptions} [run.options]
 * @returns {Promise<ExecResult>}
 */
export async function execRun({ dir, models, options = {} }) {
  const {
    jobs = DEFAULT_JOBS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    bins = { claude: "claude", codex: "codex" },
    run = spawnRun,
  } = options;
  const manifest = readManifest(dir);
  const wanted = new Set(models ?? manifest.models.map((entry) => entry.id));
  const root = mkdtempSync(join(tmpdir(), "ajs-eval-exec-"));
  const context = { run, bins, timeoutMs, codexHome: prepareCodexHome(root) };
  /** @type {Map<string, string[]>} */
  const observed = new Map();
  /** @type {ExecFailure[]} */
  const failed = [];
  const pending = listTasks(manifest).filter(
    (task) => wanted.has(task.model) && !existsSync(answerFile(dir, task)),
  );
  try {
    await pool(pending, jobs, async (task) => {
      const entry = manifest.models.find((item) => item.id === task.model);
      try {
        const { text, models: seen } = await attempt(
          context,
          entry,
          readRequest(dir, task),
        );
        writeAnswer(dir, task, text);
        rmSync(errorFile(dir, task), { force: true });
        observed.set(entry.id, [...(observed.get(entry.id) ?? []), ...seen]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "" + error;
        writeFileSync(errorFile(dir, task), `${message}\n`);
        failed.push({ task, error: message });
      }
    });
  } finally {
    for (const entry of manifest.models.filter(
      (item) => item.executor === "codex" && !item.model,
    ))
      observed.set(entry.id, codexDefaultModel(context.codexHome));
    rmSync(root, { recursive: true, force: true });
  }
  const at = new Date().toISOString();
  for (const entry of manifest.models.filter((item) => wanted.has(item.id)))
    writeExecutorRecord(dir, entry, {
      bins,
      observed: observed.get(entry.id) ?? [],
      at,
    });
  return { executed: pending.length - failed.length, failed };
}

/**
 * @param {string} dir
 * @param {MatrixEntry[]} models
 * @returns {Record<string, StoredExecutorRecord>}
 */
export function readExecutorRecords(dir, models) {
  return Object.fromEntries(
    models.map((entry) => [entry.id, readExecutorRecord(dir, entry)]),
  );
}
