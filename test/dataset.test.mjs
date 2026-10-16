import { test } from "node:test";
import assert from "node:assert/strict";

import { loadDataset, validateDataset, DATASET_FILE } from "../scripts/lib/dataset.mjs";

const VALID_CASE = {
  id: "orders-table",
  area: "dms",
  style: "clean",
  prompt: "Add an orders page with a table.",
  expect: { skills: ["dms-pages"] },
};

function errorsOf(cases) {
  return validateDataset({ version: 1, cases });
}

test("the committed dataset is valid", () => {
  const { cases } = loadDataset(DATASET_FILE);

  assert.ok(cases.length >= 50);
});

test("the committed dataset ports every docs-assistant question in both styles", () => {
  const ported = loadDataset(DATASET_FILE).cases.filter((c) => c.origin === "docs-assistant");

  assert.equal(ported.length, 24);
  assert.equal(ported.filter((c) => c.style === "casual").length, 12);
});

test("a well-formed case passes", () => {
  assert.deepEqual(errorsOf([VALID_CASE]), []);
});

test("rejects missing fields, unknown keys and bad enum values", () => {
  const errors = errorsOf([{ ...VALID_CASE, style: "shouty", extra: true, prompt: "" }]);

  assert.ok(errors.some((e) => e.includes("orders-table") && e.includes("style")));
  assert.ok(errors.some((e) => e.includes("extra")));
  assert.ok(errors.some((e) => e.includes("prompt")));
});

test("rejects duplicate ids and an empty expected skill list", () => {
  const errors = errorsOf([VALID_CASE, { ...VALID_CASE, expect: { skills: [] } }]);

  assert.ok(errors.some((e) => e.includes("duplicate")));
  assert.ok(errors.some((e) => e.includes("expect.skills")));
});

test("rejects a skill both expected and merely acceptable, and unknown behaviours", () => {
  const errors = errorsOf([
    { ...VALID_CASE, expect: { skills: ["dms-pages"], acceptable: ["dms-pages"], behaviour: "dances" } },
  ]);

  assert.ok(errors.some((e) => e.includes("acceptable")));
  assert.ok(errors.some((e) => e.includes("behaviour")));
});

test("loadDataset throws with every problem listed", () => {
  assert.throws(() => loadDataset(new URL("./fixtures/invalid-cases.json", import.meta.url)), /2 problems/);
});
