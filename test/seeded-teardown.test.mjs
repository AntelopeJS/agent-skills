import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";

import { writeFileSync } from "node:fs";
import { discoverCases } from "../scripts/lib/seeded-cases.mjs";
import { runSeeded } from "../scripts/lib/seeded-run.mjs";
import {
  TEARDOWNS,
  leakedProcesses,
  runTeardown,
} from "../scripts/lib/seeded-teardown.mjs";
import { makeTempDir, removeDir } from "./helpers.mjs";
import { exists, readText } from "./helpers/read.mjs";
import { makeSeededRepo } from "./helpers/seeded-repo.mjs";

let repo;
let work;
const children = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  if (repo) removeDir(repo);
  if (work) removeDir(work);
  repo = work = undefined;
});

function sleeper(marker) {
  const child = spawn(
    process.execPath,
    ["-e", "setTimeout(() => undefined, 60000)", marker],
    { stdio: "ignore" },
  );
  children.push(child);
  return child;
}

function optionsOf(run, extra = {}) {
  return {
    jobs: 1,
    model: "m",
    effort: "low",
    maxBudget: 1,
    timeoutSeconds: 5,
    claudeBin: "claude",
    setup: null,
    setupEnv: {},
    scratchRoot: work,
    passEnv: [],
    run,
    ...extra,
  };
}

void test("the stop command runs in the scratch checkout with the case's runs folder", async () => {
  work = makeTempDir();

  const outcome = await runTeardown({
    command: `echo "$SEEDED_RUNS $PWD" > ${join(work, "seen.txt")}`,
    cwd: work,
    env: { PATH: process.env.PATH },
    runs: "/runs/here",
  });

  assert.deepEqual(outcome, { ran: true });
  assert.equal(readText(join(work, "seen.txt")), `/runs/here ${work}\n`);
});

void test("a stop command that fails is reported and does not throw", async () => {
  const outcome = await runTeardown({
    command: "echo broken >&2; exit 4",
    cwd: process.cwd(),
    env: { PATH: process.env.PATH },
    runs: "/runs",
  });

  assert.equal(outcome.ran, true);
  assert.match(outcome.error, /broken/);
  assert.deepEqual(await runTeardown({ cwd: ".", env: {}, runs: "/r" }), {
    ran: false,
  });
});

void test("a process of the case that is still alive is listed, one that ended is not", async () => {
  const marker = `/tmp/seeded-leak-${process.pid}`;
  const child = sleeper(marker);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const alive = leakedProcesses([marker]);
  child.kill("SIGKILL");
  await new Promise((resolve) => child.on("close", resolve));

  assert.ok(alive.some((entry) => entry.pid === child.pid));
  assert.deepEqual(leakedProcesses([marker]), []);
  assert.deepEqual(leakedProcesses(["/nowhere/at/all"]), []);
});

void test("the known harnesses stop their runs through their own command", () => {
  assert.match(TEARDOWNS["verify-dms"], /dms-control\.mjs down/);
  assert.match(TEARDOWNS["verify-antelopejs"], /verify-ajs\.mts clean/);
});

void test("every case stops its runs after the agent, even when the agent died, and a leftover process fails the case record", async () => {
  repo = makeSeededRepo();
  work = makeTempDir();
  const log = join(work, "teardown.log");
  const cases = discoverCases(repo, "verify-demo").filter(
    (item) => item.kind === "break",
  );
  const run = async ({ env }) => {
    sleeper(env.TMPDIR);
    throw Object.assign(new Error("killed"), { stdout: "", timedOut: true });
  };

  const [result] = await runSeeded({
    checkout: repo,
    skill: "verify-demo",
    cases,
    out: join(work, "out"),
    options: optionsOf(run, {
      teardown: `echo "$SEEDED_RUNS" >> ${log}`,
    }),
  });

  assert.equal(result.status, "error");
  assert.equal(result.timedOut, true);
  assert.ok(
    readText(log).startsWith(
      work.startsWith("/tmp") ? "/tmp/seeded-tmp-" : "/",
    ),
  );
  assert.equal(result.teardown.ran, true);
  assert.equal(result.leaked.length, 1);
  assert.equal(exists(join(work, "out", "break-alpha", "result.json")), true);
});

void test("a stop command that really stops the process leaves no leak and the folders are removed", async () => {
  repo = makeSeededRepo();
  work = makeTempDir();
  const cases = discoverCases(repo, "verify-demo").filter(
    (item) => item.kind === "break",
  );
  let started;
  const run = async ({ env }) => {
    started = sleeper(env.TMPDIR);
    writeFileSync(join(env.TMPDIR, "pid"), String(started.pid));
    return { stdout: "{}" };
  };

  const [result] = await runSeeded({
    checkout: repo,
    skill: "verify-demo",
    cases,
    out: join(work, "out"),
    options: optionsOf(run, {
      teardown: `kill "$(cat "$SEEDED_RUNS/pid")"; sleep 0.5`,
    }),
  });

  assert.ok(started.pid);
  assert.deepEqual(result.leaked, []);
  assert.equal(exists(join(work, "seeded-eval-")), false);
});
