import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { MATRIX } from "../scripts/lib/matrix.mjs";
import {
  listTasks,
  readAnswer,
  readManifest,
  readRequest,
  requestFile,
  writeAnswer,
  writeRun,
} from "../scripts/lib/requests.mjs";
import { caseOf, makeTempDir, removeDir, skillOf } from "./helpers.mjs";
import { exists } from "./helpers/read.mjs";

let dir;

beforeEach(() => {
  dir = join(makeTempDir(), "run");
});

afterEach(() => {
  removeDir(join(dir, ".."));
});

const SKILLS = [skillOf("dms-pages"), skillOf("dms-mailing")];
const CASES = [
  caseOf("pages", ["dms-pages"], { expect: { mustMention: ["Table"] } }),
  caseOf("mail", ["dms-mailing"], { expect: { behaviour: "asks-first" } }),
  caseOf("gone", ["dms-removed"], { expect: { mustMention: ["X"] } }),
  caseOf("plain", ["dms-pages"]),
];

function prepare(options) {
  return writeRun({
    dir,
    cases: CASES,
    skills: SKILLS,
    models: MATRIX.slice(0, 2),
    options,
  });
}

test("one trigger request and two answers requests per case and model, none for a case whose skills are absent", () => {
  const manifest = prepare();

  const tasks = listTasks(manifest);

  assert.equal(tasks.length, 2 * (3 + 2 * 2));
  assert.equal(
    tasks.some((task) => task.caseId === "gone"),
    false,
  );
  assert.deepEqual(
    tasks.filter((task) => task.caseId === "plain").map((task) => task.mode),
    ["trigger", "trigger"],
  );
  assert.ok(exists(requestFile(dir, tasks[0])));
});

test("the trigger request lists every skill and the answers request loads only the expected ones", () => {
  const manifest = prepare();
  const model = manifest.models[0].id;

  const trigger = readRequest(dir, {
    model,
    mode: "trigger",
    caseId: "pages",
    run: 1,
  });
  const answers = readRequest(dir, {
    model,
    mode: "answers",
    caseId: "pages",
    run: 1,
  });

  assert.match(trigger.system, /- dms-mailing: dms-mailing description/);
  assert.deepEqual(trigger.schema.properties.skills.items.enum, [
    "dms-pages",
    "dms-mailing",
  ]);
  assert.match(answers.system, /Body of dms-pages/);
  assert.doesNotMatch(answers.system, /Body of dms-mailing/);
});

test("the without-skills variant keeps the cases and loads nothing", () => {
  const manifest = prepare({ modes: ["answers"], withSkills: false });
  const task = {
    model: manifest.models[0].id,
    mode: "answers",
    caseId: "pages",
    run: 2,
  };

  assert.equal(listTasks(manifest).length, 2 * 2 * 2);
  assert.doesNotMatch(readRequest(dir, task).system, /<skill /);
});

test("answers round-trip and a missing answer reads as undefined", () => {
  const manifest = prepare();
  const task = listTasks(manifest)[0];

  assert.equal(readAnswer(dir, task), undefined);
  writeAnswer(dir, task, "text");
  assert.equal(readAnswer(dir, task), "text");
});

test("a directory without a manifest is refused", () => {
  assert.throws(() => readManifest(dir), /holds no manifest.json/);
});
