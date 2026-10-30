import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import {
  claudeInvocation,
  codexInvocation,
  codexPrompt,
  execRun,
} from "../scripts/lib/executors.mjs";
import { MATRIX } from "../scripts/lib/matrix.mjs";
import { listTasks, readAnswer, writeRun } from "../scripts/lib/requests.mjs";
import {
  caseOf,
  makeTempDir,
  removeDir,
  skillOf,
  writeFile,
} from "./helpers.mjs";
import { exists, readJson } from "./helpers/read.mjs";

const [OPUS, SONNET, CODEX] = MATRIX;
const REQUEST = {
  system: "System text",
  user: "User text",
  schema: { type: "object" },
};

void test("claude runs with no settings, skills, tools or MCP and reads the user prompt from stdin", () => {
  const { args, input } = claudeInvocation(OPUS, REQUEST, "/tmp/system.txt");

  assert.equal(input, "User text");
  assert.deepEqual(args.slice(0, 5), [
    "-p",
    "--model",
    "claude-opus-5-5",
    "--effort",
    "low",
  ]);
  for (const flag of [
    ["--setting-sources", ""],
    ["--tools", ""],
    ["--system-prompt-file", "/tmp/system.txt"],
  ])
    assert.equal(args[args.indexOf(flag[0]) + 1], flag[1]);
  for (const flag of [
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--no-session-persistence",
  ])
    assert.ok(args.includes(flag));
  assert.equal(args[args.indexOf("--json-schema") + 1], '{"type":"object"}');
});

void test("codex ignores the user config and rules, keeps the CLI's default model and gets the system text inline", () => {
  const files = { out: "/tmp/o.txt", schema: "/tmp/s.json" };

  const { args, input } = codexInvocation(CODEX, REQUEST, files);
  const pinned = codexInvocation(
    { ...CODEX, model: "gpt-6.1-sol", effort: "high" },
    { system: "s", user: "u" },
    files,
  );

  for (const flag of ["--ignore-user-config", "--ignore-rules", "--ephemeral"])
    assert.ok(args.includes(flag));
  assert.equal(args.includes("--model"), false);
  assert.equal(args[args.indexOf("--output-schema") + 1], "/tmp/s.json");
  assert.equal(input, codexPrompt(REQUEST));
  assert.match(input, /<instructions>\nSystem text\n<\/instructions>/);
  assert.equal(pinned.args[pinned.args.indexOf("--model") + 1], "gpt-6.1-sol");
  assert.equal(pinned.args.includes("--output-schema"), false);
});

let dir;

beforeEach(() => {
  dir = join(makeTempDir(), "run");
});

afterEach(() => {
  removeDir(join(dir, ".."));
});

function prepared() {
  return writeRun({
    dir,
    cases: [caseOf("pages", ["dms-pages"])],
    skills: [skillOf("dms-pages")],
    models: [OPUS, SONNET, CODEX],
    options: { modes: ["trigger"] },
  });
}

function fakeRun(log, behaviour = () => '{"skills":["dms-pages"]}') {
  return async (call) => {
    log.push(call);
    if (call.command === "claude")
      return {
        stdout: JSON.stringify({
          result: behaviour(call),
          modelUsage: { "claude-opus-5-5": {} },
        }),
      };
    return { stdout: "" };
  };
}

void test("every pending task is answered by its model's executor and the observed model is recorded", async () => {
  const manifest = prepared();
  const calls = [];

  const { failed } = await execRun({
    dir,
    models: ["claude-opus-5-5-low"],
    options: { run: fakeRun(calls) },
  });

  assert.deepEqual(failed, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd.startsWith(dir), false);
  assert.equal(calls[0].env.CLAUDE_CODE_SESSION_ID, undefined);
  const task = listTasks(manifest).find((item) => item.model === OPUS.id);
  assert.equal(readAnswer(dir, task), '{"skills":["dms-pages"]}');
  assert.deepEqual(
    readJson(join(dir, OPUS.id, "executor.json")).observedModels,
    ["claude-opus-5-5"],
  );
});

void test("a task that already has an answer is not run again", async () => {
  prepared();
  const calls = [];
  const options = { run: fakeRun(calls) };

  await execRun({ dir, models: [OPUS.id], options });
  await execRun({ dir, models: [OPUS.id], options });

  assert.equal(calls.length, 1);
});

void test("a failing call is retried once, then reported with an error file and no answer", async () => {
  const manifest = prepared();
  const calls = [];
  const run = async (call) => {
    calls.push(call);
    throw new Error("boom");
  };

  const { failed } = await execRun({
    dir,
    models: [SONNET.id],
    options: { run },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(
    failed.map((item) => item.error),
    ["boom"],
  );
  const task = listTasks(manifest).find((item) => item.model === SONNET.id);
  assert.equal(readAnswer(dir, task), undefined);
  assert.ok(exists(join(dir, SONNET.id, "trigger", "pages.1.error.txt")));
});

void test("claude's error result is a failure, not an answer", async () => {
  prepared();
  const run = async () => ({
    stdout: JSON.stringify({ is_error: true, result: "rate limited" }),
  });

  const { failed } = await execRun({
    dir,
    models: [OPUS.id],
    options: { run },
  });

  assert.match(failed[0].error, /rate limited/);
});

void test("the codex call gets a home with only the auth link and reads the reply file back", async () => {
  prepared();
  const homes = [];
  const run = async (call) => {
    homes.push(call.env.CODEX_HOME);
    const out = call.args[call.args.indexOf("--output-last-message") + 1];
    writeFile(out, '{"skills":[]}');
    return { stdout: "" };
  };

  const { failed } = await execRun({
    dir,
    models: [CODEX.id],
    options: { run },
  });

  assert.deepEqual(failed, []);
  assert.equal(homes[0].includes("codex-home"), true);
  assert.equal(exists(homes[0]), false);
});
