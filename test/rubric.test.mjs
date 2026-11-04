import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { rubricErrorsOf, suiteErrors } from "../scripts/lib/rubric.mjs";
import { makeTempDir, removeDir, writeFile, writeJson } from "./helpers.mjs";

/** @type {string} */
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

/**
 * @param {string} id
 * @param {Record<string, unknown>} [extra] Fields that replace the valid ones.
 * @returns {Record<string, unknown>}
 */
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

/**
 * @returns {string}
 */
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

const WRONG_SHA =
  "a repo fixture needs repo (owner/name) and a 40-character sha";
const LESSON = "https://github.com/Upd4ting/outer-loop/issues/1";

/** @type {[string, Record<string, unknown>, string][]} */
const WRONG_TYPES = [
  ["a numeric case id", { id: 5 }, "case ?: id must be kebab-case"],
  [
    "a repo given as a list",
    { fixture: { type: "repo", repo: ["a/b"], sha: "0".repeat(40) } },
    `case c: ${WRONG_SHA}`,
  ],
  [
    "a sha given as a list",
    { fixture: { type: "repo", repo: "a/b", sha: ["0".repeat(40)] } },
    `case c: ${WRONG_SHA}`,
  ],
  [
    "a numeric criterion id",
    { rubric: [...CRITERIA.slice(0, 2), { id: 7, text: CRITERIA[2].text }] },
    "case c: each criterion needs a kebab-case id and a text",
  ],
  [
    "a lesson given as a list",
    { lesson: [LESSON] },
    "case c: lesson must be an https URL",
  ],
  [
    "a numeric prompt",
    { prompt: 12345678901 },
    "case c: prompt must be a sentence",
  ],
];

for (const [name, extra, error] of WRONG_TYPES) {
  void test(`${name} is an error, not a coerced string`, () => {
    const dir = suiteDir();
    const cases = [rubricCase("a"), rubricCase("b"), rubricCase("c", extra)];

    assert.deepEqual(suiteErrors({ cases }, dir), [error]);
  });
}
