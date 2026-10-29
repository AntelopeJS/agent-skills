import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { discoverCases } from "../scripts/lib/seeded-cases.mjs";
import { runSeeded } from "../scripts/lib/seeded-run.mjs";
import { makeTempDir, removeDir } from "./helpers.mjs";
import { exists, readJson, readText } from "./helpers/read.mjs";
import { makeFakeClaude, makeSeededRepo } from "./helpers/seeded-repo.mjs";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "evals.mjs");
let repo;
let work;

afterEach(() => {
  if (repo) removeDir(repo);
  if (work) removeDir(work);
  repo = work = undefined;
});

function verdictOf(result, failedFeatures = [], doors = []) {
  return JSON.stringify({
    structured_output: {
      result,
      failedFeatures,
      notRun: [],
      doors,
      summary: "s",
    },
    total_cost_usd: 0.1,
    num_turns: 3,
  });
}

function optionsOf(run, extra = {}) {
  return {
    jobs: 2,
    model: "claude-sonnet-5-5",
    effort: "medium",
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

function setUp() {
  repo = makeSeededRepo();
  work = makeTempDir();
  return discoverCases(repo, "verify-demo");
}

test("each case runs in its own scratch checkout that holds its change, and no scratch survives", async () => {
  const cases = setUp();
  const seen = [];
  const run = async ({ cwd }) => {
    seen.push(
      execFileSync("git", ["diff", "--name-only", "origin/main...HEAD"], {
        cwd,
        encoding: "utf8",
      }).trim(),
    );
    return { stdout: verdictOf("PASS") };
  };

  const results = await runSeeded({
    checkout: repo,
    skill: "verify-demo",
    cases: cases.filter((item) => item.kind !== "touched"),
    out: join(work, "out"),
    options: optionsOf(run),
  });

  assert.deepEqual(
    seen.toSorted((left, right) => left.localeCompare(right)),
    ["", "src/alpha.txt", "src/data.txt"],
  );
  assert.deepEqual(
    results.map((item) => [item.id, item.passed]),
    [
      ["break-alpha", false],
      ["control", true],
      ["door-data", false],
    ],
  );
  assert.equal(
    readJson(join(work, "out", "control", "result.json")).costUsd,
    0.1,
  );
  assert.equal(exists(join(work, "seeded-eval-")), false);
});

test("no more cases run at once than jobs allows", async () => {
  const cases = setUp();
  let active = 0;
  let peak = 0;
  const run = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 30));
    active -= 1;
    return { stdout: verdictOf("PASS") };
  };

  await runSeeded({
    checkout: repo,
    skill: "verify-demo",
    cases,
    out: join(work, "out"),
    options: optionsOf(run, { jobs: 2 }),
  });

  assert.equal(peak, 2);
});

test("resume skips a case with a finished result and reruns one that errored", async () => {
  const cases = setUp().slice(0, 2);
  const ran = [];
  const run = async ({ cwd }) => {
    ran.push(cwd);
    if (ran.length === 1)
      throw Object.assign(new Error("boom"), { stdout: "" });
    return { stdout: verdictOf("FAIL", ["alpha"]) };
  };
  const base = {
    checkout: repo,
    skill: "verify-demo",
    cases,
    out: join(work, "out"),
  };

  const first = await runSeeded({
    ...base,
    options: optionsOf(run, { jobs: 1 }),
  });
  assert.deepEqual(
    first
      .map((item) => item.status)
      .toSorted((left, right) => left.localeCompare(right)),
    ["error", "wrong"],
  );
  ran.length = 0;
  await runSeeded({
    ...base,
    options: optionsOf(run, { jobs: 1, resume: true }),
  });

  assert.equal(ran.length, 1);
});

test("a setup that fails is recorded as an error and does not stop the other cases", async () => {
  const cases = setUp().slice(0, 2);
  const run = async () => ({ stdout: verdictOf("PASS") });

  const results = await runSeeded({
    checkout: repo,
    skill: "verify-demo",
    cases,
    out: join(work, "out"),
    options: optionsOf(run, { setup: "exit 3" }),
  });

  assert.deepEqual(
    results.map((item) => item.status),
    ["error", "error"],
  );
  assert.match(results[0].error, /setup failed/);
});

test("evals seeded drives the claude CLI, keeps credentials out of it and gates on the catch rate", () => {
  repo = makeSeededRepo();
  work = makeTempDir();
  const claude = makeFakeClaude(
    work,
    JSON.parse(verdictOf("FAIL", ["alpha"], ["data"])),
  );
  const args = [
    SCRIPT,
    "seeded",
    "--repo",
    repo,
    "--modes",
    "breaks,doors",
    "--setup",
    "true",
    "--scratch",
    work,
    "--out",
    join(work, "out"),
    "--claude-bin",
    claude,
    "--min-catch",
    "1",
    "--min-door-catch",
    "1",
    "--json",
  ];
  const env = { ...process.env, GH_TOKEN: "secret" };

  const output = JSON.parse(
    execFileSync(process.execPath, args, { env, encoding: "utf8" }).trim(),
  );

  assert.equal(output.summary.breaks.rate, 1);
  assert.equal(output.summary.doors.rate, 1);
  const calls = readText(join(work, "calls.log"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(calls.length, 2);
  assert.deepEqual([...new Set(calls.map((call) => call.token))], [null]);
  assert.equal(
    calls.every((call) => call.home.startsWith(work)),
    true,
  );
  assert.ok(exists(join(work, "out", "report.md")));
});

test("evals seeded exits 1 when a break is missed under --min-catch", () => {
  repo = makeSeededRepo();
  work = makeTempDir();
  const claude = makeFakeClaude(work, JSON.parse(verdictOf("PASS")));

  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          SCRIPT,
          "seeded",
          "--repo",
          repo,
          "--modes",
          "breaks",
          "--setup",
          "true",
          "--scratch",
          work,
          "--out",
          join(work, "out"),
          "--claude-bin",
          claude,
          "--min-catch",
          "1",
        ],
        { encoding: "utf8", stdio: "pipe" },
      ),
    (error) =>
      error.status === 1 &&
      /Catch rate \(seeded breaks\): 0\/1/.test(error.stdout),
  );
});
