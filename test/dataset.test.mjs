import { test } from "node:test";
import assert from "node:assert/strict";

import {
  loadDataset,
  validateDataset,
  CENTRAL_FILES,
} from "../scripts/lib/dataset.mjs";

const VALID_CASE = {
  id: "orders-table",
  area: "dms",
  style: "clean",
  prompt: "Add an orders page with a table.",
  expect: { skills: ["dms-pages"] },
};

/**
 * @param {unknown} cases
 * @returns {string[]}
 */
function errorsOf(cases) {
  return validateDataset({ version: 1, cases });
}

void test("the committed central datasets load", () => {
  for (const file of CENTRAL_FILES)
    assert.doesNotThrow(() => loadDataset(file), file);
});

void test("a well-formed case passes", () => {
  assert.deepEqual(errorsOf([VALID_CASE]), []);
});

void test("rejects missing fields, unknown keys and bad enum values", () => {
  const errors = errorsOf([
    { ...VALID_CASE, style: "shouty", extra: true, prompt: "" },
  ]);

  assert.ok(
    errors.some((e) => e.includes("orders-table") && e.includes("style")),
  );
  assert.ok(errors.some((e) => e.includes("extra")));
  assert.ok(errors.some((e) => e.includes("prompt")));
});

void test("rejects duplicate ids and an empty expected skill list", () => {
  const errors = errorsOf([
    VALID_CASE,
    { ...VALID_CASE, expect: { skills: [] } },
  ]);

  assert.ok(errors.some((e) => e.includes("duplicate")));
  assert.ok(errors.some((e) => e.includes("expect.skills")));
});

void test("rejects a skill both expected and merely acceptable, and unknown behaviours", () => {
  const errors = errorsOf([
    {
      ...VALID_CASE,
      expect: {
        skills: ["dms-pages"],
        acceptable: ["dms-pages"],
        behaviour: "dances",
      },
    },
  ]);

  assert.ok(errors.some((e) => e.includes("acceptable")));
  assert.ok(errors.some((e) => e.includes("behaviour")));
});

void test("loadDataset throws with every problem listed", () => {
  assert.throws(
    () =>
      loadDataset(new URL("./fixtures/invalid-cases.json", import.meta.url)),
    /2 problems/,
  );
});
