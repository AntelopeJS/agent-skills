import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";

import { makeTempDir, removeDir } from "./helpers.mjs";
import { exists, listDir, readJson, readText } from "./helpers/read.mjs";
import { makeSeededRepo } from "./helpers/seeded-repo.mjs";
import { makeSleepingAgent, recordsOf } from "./helpers/sleeping-agent.mjs";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "evals.mjs");
const POLL_MS = 25;
const WAIT_MS = 15_000;
let repo;
let work;
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
  repo = work = undefined;
});

function killQuietly(pid) {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return;
  }
}

function pidsOf(file) {
  try {
    const record = readJson(file);
    return [record.agent, record.child, record.harness];
  } catch {
    return [];
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

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
  const stdout = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
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
  const { results, summary } = readJson(join(work, "out", "summary.json"));
  assert.deepEqual(
    results.map((result) => result.status),
    ["interrupted", "interrupted", "interrupted"],
  );
  assert.deepEqual(
    results.flatMap((result) => result.leaked ?? []),
    [],
  );
  assert.equal(summary.interrupted.length, 3);
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
