import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { rubricErrorsOf, suiteErrors } from "../scripts/lib/rubric.mjs";
import { makeTempDir, removeDir, writeFile, writeJson } from "./helpers.mjs";

let root;

beforeEach(() => {
  root = makeTempDir();
});

afterEach(() => {
  removeDir(root);
});

const CRITERIA = ["first-rule", "second-rule", "third-rule"].map((id) => ({
  id,
  text: `The answer satisfies ${id} fully.`,
}));

function rubricCase(id, extra = {}) {
  return {
    id,
    harness: "claude",
    fixture: { type: "skeleton", dir: "fixtures/empty" },
    prompt: "Create a module called billing in this project.",
    rubric: CRITERIA,
    ...extra,
  };
}

function suiteDir() {
  const dir = join(root, "new-module");
  writeFile(join(dir, "fixtures", "empty", "package.json"), "{}\n");
  return dir;
}

void test("a suite needs three behaviour cases, each with 3 to 6 criteria and a fixture that exists", () => {
  const dir = suiteDir();
  const good = { cases: ["a", "b", "c"].map((id) => rubricCase(id)) };

  assert.deepEqual(suiteErrors(good, dir), []);
  assert.deepEqual(suiteErrors({ cases: good.cases.slice(0, 2) }, dir), [
    "needs at least 3 behaviour cases",
  ]);
  assert.deepEqual(
    suiteErrors(
      {
        cases: [
          ...good.cases.slice(0, 2),
          rubricCase("c", { rubric: CRITERIA.slice(0, 2) }),
        ],
      },
      dir,
    ),
    ["case c: rubric needs 3 to 6 criteria"],
  );
  assert.deepEqual(
    suiteErrors(
      {
        cases: [
          ...good.cases.slice(0, 2),
          rubricCase("c", {
            fixture: { type: "skeleton", dir: "fixtures/none" },
          }),
        ],
      },
      dir,
    ),
    ["case c: fixture directory fixtures/none does not exist"],
  );
});

void test("a case from a Lesson may carry fewer criteria", () => {
  const dir = suiteDir();
  const lesson = rubricCase("c", {
    rubric: CRITERIA.slice(0, 1),
    lesson: "https://github.com/Upd4ting/outer-loop/issues/1",
  });

  assert.deepEqual(
    suiteErrors({ cases: [rubricCase("a"), rubricCase("b"), lesson] }, dir),
    [],
  );
});

void test("a suite directory must belong to a plugin skill and hold a cases file", () => {
  writeJson(join(root, "unknown", "cases.json"), { cases: [] });
  writeFile(join(root, "new-module", "fixtures", "x"), "");

  assert.deepEqual(rubricErrorsOf(["new-module"], root), [
    "evals/commands/new-module: cases.json is missing",
    "evals/commands/unknown: not a skill of the plugin",
  ]);
});
