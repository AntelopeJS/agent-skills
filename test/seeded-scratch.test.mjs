import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { discoverCases } from "../scripts/lib/seeded-cases.mjs";
import {
  createScratch,
  removeScratch,
} from "../scripts/lib/seeded-scratch.mjs";
import { makeTempDir, removeDir } from "./helpers.mjs";
import { exists, listDir, readText } from "./helpers/read.mjs";
import { gitIn, makeSeededRepo } from "./helpers/seeded-repo.mjs";

/** @typedef {import("../scripts/lib/seeded-scratch.mjs").Scratch} Scratch */

/** @type {string | undefined} */
let repo;
/** @type {Scratch | undefined} */
let scratch;
/** @type {string | undefined} */
let root;

afterEach(() => {
  if (scratch) removeScratch(scratch);
  if (repo) removeDir(repo);
  if (root) removeDir(root);
  repo = scratch = root = undefined;
});

/**
 * @param {string} id
 * @param {{ setup?: string | null }} [extra]
 * @returns {Scratch}
 */
function scratchFor(id, extra = {}) {
  const checkout = makeSeededRepo();
  const rootDir = makeTempDir();
  repo = checkout;
  root = rootDir;
  const item = discoverCases(checkout, "verify-demo").find((c) => c.id === id);
  assert.ok(item);
  const created = createScratch({
    checkout,
    skill: "verify-demo",
    patch: item.patch,
    touch: item.touch,
    root: rootDir,
    setup: null,
    ...extra,
  });
  scratch = created;
  return created;
}

void test("the patch is the only change over origin/main, and the checkout it came from is untouched", () => {
  const { dir, baseSha, headSha } = scratchFor("break-alpha");

  assert.notEqual(baseSha, headSha);
  assert.equal(gitIn(dir, ["rev-parse", "origin/main"]), baseSha);
  assert.equal(
    gitIn(dir, ["diff", "--name-only", "origin/main...HEAD"]),
    "src/alpha.txt",
  );
  assert.equal(readText(join(dir, "src", "alpha.txt")), "broken\n");
  assert.ok(repo);
  assert.equal(readText(join(repo, "src", "alpha.txt")), "alpha\n");
  assert.equal(gitIn(repo, ["status", "--porcelain"]), "");
});

void test("the verifier finds no seeded patch in the tree or in the history", () => {
  const { dir } = scratchFor("door-data");

  const skill = join(dir, ".agents/skills/verify-demo");
  assert.ok(exists(join(skill, "SKILL.md")));
  assert.equal(exists(join(skill, "seeded-breaks")), false);
  assert.equal(exists(join(skill, "seeded-doors")), false);
  assert.equal(gitIn(dir, ["rev-list", "--count", "HEAD"]), "2");
  assert.equal(
    gitIn(dir, ["log", "--all", "--format=%s", "--", "*.patch"]),
    "",
  );
});

void test("origin keeps the GitHub URL for rendering but cannot be pushed to", () => {
  const { dir } = scratchFor("break-alpha");

  assert.equal(
    gitIn(dir, ["remote", "get-url", "origin"]),
    "https://github.com/Acme/demo.git",
  );
  assert.match(
    gitIn(dir, ["remote", "get-url", "--push", "origin"]),
    /disabled/,
  );
});

void test("the unpatched head has no commit over its base", () => {
  const { dir, baseSha, headSha } = scratchFor("control");

  assert.equal(headSha, baseSha);
  assert.equal(gitIn(dir, ["diff", "--name-only", "origin/main...HEAD"]), "");
});

void test("a touched head changes the files of the patch without the patch's change", () => {
  const { dir } = scratchFor("touched-alpha");

  assert.equal(
    gitIn(dir, ["diff", "--name-only", "origin/main...HEAD"]),
    "src/alpha.txt",
  );
  assert.equal(readText(join(dir, "src", "alpha.txt")), "alpha\n\n");
});

void test("the setup runs after the base commit and before the change", () => {
  const { dir } = scratchFor("break-alpha", {
    setup:
      "git log --format=%s > setup-saw.txt && cat src/alpha.txt >> setup-saw.txt",
  });

  assert.equal(readText(join(dir, "setup-saw.txt")), "base\nalpha\n");
});

void test("a patch that does not apply leaves no scratch behind", () => {
  const checkout = makeSeededRepo();
  const rootDir = makeTempDir();
  repo = checkout;
  root = rootDir;

  assert.throws(() =>
    createScratch({
      checkout,
      skill: "verify-demo",
      patch: join(checkout, "src", "alpha.txt"),
      root: rootDir,
      setup: null,
    }),
  );
  assert.deepEqual(listDir(rootDir), []);
});
