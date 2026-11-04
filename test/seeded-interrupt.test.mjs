import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";

import { readJsonFile } from "../scripts/lib/json.mjs";
import { fieldOf } from "../scripts/lib/safe-read.mjs";
import { makeTempDir, removeDir } from "./helpers.mjs";
import { exists, listDir, readText } from "./helpers/read.mjs";
import { makeSeededRepo } from "./helpers/seeded-repo.mjs";
import {
  makeSleepingAgent,
  readAgentRecord,
  recordsOf,
} from "./helpers/sleeping-agent.mjs";

/**
 * How an eval run ended: its exit code or signal, and what it printed.
 * @typedef {object} EvalExit
 * @property {number | null} code
 * @property {NodeJS.Signals | null} signal
 * @property {string} stdout
 */

/** @typedef {import("node:child_process").ChildProcess} ChildProcess */

const SCRIPT = join(import.meta.dirname, "..", "scripts", "evals.mjs");
const POLL_MS = 25;
const WAIT_MS = 15_000;
let repo = "";
let work = "";
/** @type {ChildProcess[]} */
const evals = [];

afterEach(() => {
  for (const child of evals.splice(0)) child.kill("SIGKILL");
  if (work && exists(join(work, "agents")))
    for (const name of listDir(join(work, "agents")))
      for (const pid of pidsOf(join(work, "agents", name))) killQuietly(pid);
  if (work && exists(join(work, "td.sleep")))
    killQuietly(Number(readText(join(work, "td.sleep"))));
  if (repo) removeDir(repo);
  if (work) removeDir(work);
  repo = work = "";
});

/**
 * @param {number} pid
 * @returns {void}
 */
function killQuietly(pid) {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return;
  }
}

/**
 * @param {string} file
 * @returns {number[]}
 */
function pidsOf(file) {
  try {
    const record = readAgentRecord(file);
    return [record.agent, record.child, record.harness];
  } catch {
    return [];
  }
}

/**
 * @param {number} pid
 * @returns {boolean}
 */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {() => boolean} condition
 * @returns {Promise<void>}
 */
async function until(condition) {
  const deadline = Date.now() + WAIT_MS;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

function agentRecords() {
  return recordsOf(work);
}

/**
 * @param {(dir: string) => string} teardownOf
 * @returns {{ child: ChildProcess, closed: Promise<EvalExit> }}
 */
function startEval(teardownOf) {
  repo = makeSeededRepo();
  work = makeTempDir();
  const child = spawn(
    process.execPath,
    [
      SCRIPT,
      "seeded",
      "--repo",
      repo,
      "--jobs",
      "2",
      "--setup",
      "true",
      "--scratch",
      work,
      "--out",
      join(work, "out"),
      "--claude-bin",
      makeSleepingAgent(work),
      "--teardown",
      teardownOf(work),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  evals.push(child);
  /** @type {Buffer[]} */
  const stdout = [];
  child.stdout.on("data", (/** @type {Buffer} */ chunk) => stdout.push(chunk));
  /** @type {Promise<EvalExit>} */
  const closed = new Promise((resolve) =>
    child.on("close", (code, signal) =>
      resolve({ code, signal, stdout: Buffer.concat(stdout).toString() }),
    ),
  );
  return { child, closed };
}

void test("an interrupted eval kills each agent and its children, stops the runs, removes the folders and marks the cases interrupted", async () => {
  const { child, closed } = startEval(
    (dir) =>
      `kill "$(cat "$SEEDED_RUNS/harness.pid")"; sleep 0.3; echo down >> "${join(dir, "teardown.log")}"`,
  );
  await until(() => agentRecords().length === 2);
  const live = agentRecords();
  assert.equal(
    live.every((record) => alive(record.agent) && alive(record.child)),
    true,
  );

  child.kill("SIGINT");
  const { code, stdout } = await closed;

  assert.equal(code, 130);
  assert.equal(
    live.some((record) => alive(record.agent) || alive(record.child)),
    false,
  );
  assert.equal(
    live.some((record) => alive(record.harness)),
    false,
  );
  assert.equal(readText(join(work, "teardown.log")), "down\ndown\n");
  assert.equal(
    live.some((record) => exists(record.tmp)),
    false,
  );
  assert.deepEqual(
    listDir(work).filter((name) => name.startsWith("seeded-")),
    [],
  );
  const written = readJsonFile(join(work, "out", "summary.json"));
  const results = fieldOf(written, "results");
  const interrupted = fieldOf(fieldOf(written, "summary"), "interrupted");
  assert.ok(Array.isArray(results));
  assert.ok(Array.isArray(interrupted));
  assert.deepEqual(
    results.map((result) => fieldOf(result, "status")),
    ["interrupted", "interrupted", "interrupted"],
  );
  assert.deepEqual(
    results.flatMap((result) => fieldOf(result, "leaked") ?? []),
    [],
  );
  assert.equal(interrupted.length, 3);
  assert.match(stdout, /INTERRUPTED/);
});

void test("a second signal kills the stop command and exits at once", async () => {
  const { child, closed } = startEval(
    (dir) => `sleep 60 & echo $! > "${join(dir, "td.sleep")}"; wait`,
  );
  await until(() => agentRecords().length === 2);
  child.kill("SIGINT");
  await until(() => exists(join(work, "td.sleep")));
  const stopper = Number(readText(join(work, "td.sleep")));

  child.kill("SIGTERM");
  const { code } = await closed;

  assert.equal(code, 143);
  await until(() => !alive(stopper));
});
