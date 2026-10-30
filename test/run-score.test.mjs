import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { MATRIX } from "../scripts/lib/matrix.mjs";
import { listTasks, writeAnswer, writeRun } from "../scripts/lib/requests.mjs";
import { parsePicks, scoreRun } from "../scripts/lib/run-score.mjs";
import { caseOf, makeTempDir, removeDir, skillOf } from "./helpers.mjs";

const [OPUS] = MATRIX;
let dir;

beforeEach(() => {
  dir = join(makeTempDir(), "run");
});

afterEach(() => {
  removeDir(join(dir, ".."));
});

const verifyNone = async () => ({ checked: 2, findings: [] });

function prepared(cases) {
  return writeRun({
    dir,
    cases,
    skills: [skillOf("dms-pages"), skillOf("dms-mailing")],
    models: [OPUS],
  });
}

void test("trigger replies are read bare, fenced or wrapped in prose, and a reply without a list is refused", () => {
  assert.deepEqual(parsePicks('{"skills":["a"]}'), ["a"]);
  assert.deepEqual(parsePicks('```json\n{"skills":["a","b"]}\n```'), [
    "a",
    "b",
  ]);
  assert.deepEqual(parsePicks('Sure: {"skills":["a"]} done'), ["a"]);
  assert.throws(() => parsePicks('{"picks":[]}'), /no skills array/);
});

void test("an unreadable trigger reply fails its case with the reason instead of throwing", async () => {
  const manifest = prepared([caseOf("pages", ["dms-pages"])]);
  for (const task of listTasks(manifest))
    writeAnswer(dir, task, task.mode === "trigger" ? "not json" : "ok");

  const [result] = (await scoreRun(dir, manifest, verifyNone)).models;

  assert.equal(result.trigger[0].pass, false);
  assert.match(result.trigger[0].error, /JSON|Unexpected/);
});

void test("an answers case passes only when both runs pass", async () => {
  const manifest = prepared([
    caseOf("pages", ["dms-pages"], { expect: { mustMention: ["Table"] } }),
  ]);
  for (const task of listTasks(manifest)) {
    const text =
      task.mode === "trigger"
        ? '{"skills":["dms-pages"]}'
        : task.run === 1
          ? "Use Table"
          : "Use nothing";
    writeAnswer(dir, task, text);
  }

  const [result] = (await scoreRun(dir, manifest, verifyNone)).models;

  assert.deepEqual(
    result.answers[0].runs.map((run) => run.pass),
    [true, false],
  );
  assert.equal(result.answers[0].pass, false);
  assert.equal(result.trigger[0].pass, true);
  assert.deepEqual(result.answers[0].runs[1].missingMentions, ["Table"]);
});

void test("invented names found by verify fail the run that holds them", async () => {
  const manifest = prepared([
    caseOf("pages", ["dms-pages"], { expect: { mustMention: ["X"] } }),
  ]);
  for (const task of listTasks(manifest))
    writeAnswer(dir, task, '{"skills":[]} Use X');
  const verify = async () => ({ checked: 3, findings: [{ name: "X" }] });

  const [result] = (await scoreRun(dir, manifest, verify)).models;

  assert.deepEqual(result.answers[0].runs[0].unknown, ["X"]);
  assert.equal(result.answers[0].pass, false);
});

void test("a missing answer file is marked missing", async () => {
  const manifest = prepared([
    caseOf("pages", ["dms-pages"], { expect: { mustMention: ["X"] } }),
  ]);

  const [result] = (await scoreRun(dir, manifest, verifyNone)).models;

  assert.equal(result.trigger[0].error, "no answer file");
  assert.equal(result.answers[0].runs[0].missing, true);
});

void test("an extra pick leaves a trigger case passing, but picking an avoided skill fails it", async () => {
  const manifest = prepared([
    caseOf("mail", ["dms-mailing"], {
      expect: { avoid: ["dms-pages"], acceptable: [] },
    }),
  ]);
  const [task] = listTasks(manifest).filter((item) => item.mode === "trigger");

  const score = async (reply) => {
    writeAnswer(dir, task, reply);
    return (await scoreRun(dir, manifest, verifyNone)).models[0].trigger[0];
  };

  const extra = await score('{"skills":["dms-mailing","dms-pages"]}');
  const clean = await score('{"skills":["dms-mailing"]}');

  assert.deepEqual(extra.avoided, ["dms-pages"]);
  assert.equal(extra.pass, false);
  assert.equal(clean.pass, true);
});

void test("an extra pick that the case does not avoid costs precision, not the case", async () => {
  const manifest = prepared([caseOf("mail", ["dms-mailing"])]);
  const [task] = listTasks(manifest).filter((item) => item.mode === "trigger");
  writeAnswer(dir, task, '{"skills":["dms-mailing","dms-pages"]}');

  const [result] = (await scoreRun(dir, manifest, verifyNone)).models;

  assert.equal(result.trigger[0].pass, true);
  assert.equal(result.trigger[0].precision, 0.5);
});

void test("an API-shaped name used without an import is unverified and does not fail the run", async () => {
  const manifest = prepared([
    caseOf("pages", ["dms-pages"], { expect: { mustMention: ["Table"] } }),
  ]);
  for (const task of listTasks(manifest))
    writeAnswer(dir, task, '{"skills":[]} Table');
  const verify = async () => ({
    checked: 3,
    findings: [
      { name: "Warn", kind: "reference" },
      { name: "Ghost", kind: "import" },
    ],
  });

  const [result] = (await scoreRun(dir, manifest, verify)).models;

  assert.deepEqual(result.answers[0].runs[0].unknown, ["Ghost"]);
  assert.deepEqual(result.answers[0].runs[0].unverified, ["Warn"]);
  assert.equal(result.answers[0].runs[0].invented, 1);
});
