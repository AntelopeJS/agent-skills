import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  discoverCases,
  pickSkill,
  selectSeeded,
  verifySkillsOf,
} from "../scripts/lib/seeded-cases.mjs";
import { removeDir } from "./helpers.mjs";
import { makeSeededRepo } from "./helpers/seeded-repo.mjs";

/** @type {string | undefined} */
let repo;

afterEach(() => {
  if (repo) removeDir(repo);
  repo = undefined;
});

void test("a repo yields a case per seeded break, per seeded door, the unpatched head and each break's touched twin", () => {
  repo = makeSeededRepo();

  const cases = discoverCases(repo, "verify-demo");

  assert.deepEqual(
    cases.map(({ id, kind, subject }) => [id, kind, subject]),
    [
      ["break-alpha", "break", "alpha"],
      ["door-data", "door", "data"],
      ["control", "control", "head"],
      ["touched-alpha", "touched", "alpha"],
    ],
  );
  assert.ok(cases[0].patch?.endsWith("seeded-breaks/alpha.patch"));
  assert.equal(cases[2].patch, undefined);
});

void test("modes and ids narrow the cases, and an id of another mode never leaks in", () => {
  repo = makeSeededRepo();
  const cases = discoverCases(repo, "verify-demo");

  assert.deepEqual(
    selectSeeded(cases, { modes: [], only: [] }).map((item) => item.id),
    ["break-alpha", "door-data", "control"],
  );
  assert.deepEqual(
    selectSeeded(cases, { modes: ["doors"], only: [] }).map((item) => item.id),
    ["door-data"],
  );
  assert.deepEqual(
    selectSeeded(cases, { modes: [], only: ["control", "break-alpha"] }).map(
      (item) => item.id,
    ),
    ["break-alpha", "control"],
  );
  assert.deepEqual(
    selectSeeded(cases, { modes: ["breaks"], only: ["door-data"] }),
    [],
  );
});

void test("the verification skill is the only verify-* directory, or the one --skill names", () => {
  const checkout = makeSeededRepo();
  repo = checkout;

  assert.deepEqual(verifySkillsOf(checkout), ["verify-demo"]);
  assert.equal(pickSkill(checkout, undefined), "verify-demo");
  assert.throws(() => pickSkill(checkout, "verify-other"), /verify-other/);
});
