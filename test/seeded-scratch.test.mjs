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

let repo;
let scratch;
let root;

afterEach(() => {
  if (scratch) removeScratch(scratch);
  if (repo) removeDir(repo);
  if (root) removeDir(root);
  repo = scratch = root = undefined;
});

function scratchFor(id, extra = {}) {
  repo = makeSeededRepo();
  root = makeTempDir();
  const item = discoverCases(repo, "verify-demo").find((c) => c.id === id);
  scratch = createScratch({
    checkout: repo,
    skill: "verify-demo",
    patch: item.patch,
    touch: item.touch,
    root,
    setup: null,
    ...extra,
  });
  return scratch;
}

test("the patch is the only change over origin/main, and the checkout it came from is untouched", () => {
  const { dir, baseSha, headSha } = scratchFor("break-alpha");

  assert.notEqual(baseSha, headSha);
  assert.equal(gitIn(dir, ["rev-parse", "origin/main"]), baseSha);
  assert.equal(
    gitIn(dir, ["diff", "--name-only", "origin/main...HEAD"]),
    "src/alpha.txt",
  );
  assert.equal(readText(join(dir, "src", "alpha.txt")), "broken\n");
  assert.equal(readText(join(repo, "src", "alpha.txt")), "alpha\n");
  assert.equal(gitIn(repo, ["status", "--porcelain"]), "");
});

test("the verifier finds no seeded patch in the tree or in the history", () => {
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

test("origin keeps the GitHub URL for rendering but cannot be pushed to", () => {
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

test("the unpatched head has no commit over its base", () => {
  const { dir, baseSha, headSha } = scratchFor("control");

  assert.equal(headSha, baseSha);
  assert.equal(gitIn(dir, ["diff", "--name-only", "origin/main...HEAD"]), "");
});

test("a touched head changes the files of the patch without the patch's change", () => {
  const { dir } = scratchFor("touched-alpha");

  assert.equal(
    gitIn(dir, ["diff", "--name-only", "origin/main...HEAD"]),
    "src/alpha.txt",
  );
  assert.equal(readText(join(dir, "src", "alpha.txt")), "alpha\n\n");
});

test("the setup runs after the base commit and before the change", () => {
  const { dir } = scratchFor("break-alpha", {
    setup:
      "git log --format=%s > setup-saw.txt && cat src/alpha.txt >> setup-saw.txt",
  });

  assert.equal(readText(join(dir, "setup-saw.txt")), "base\nalpha\n");
});

test("a patch that does not apply leaves no scratch behind", () => {
  repo = makeSeededRepo();
  root = makeTempDir();

  assert.throws(() =>
    createScratch({
      checkout: repo,
      skill: "verify-demo",
      patch: join(repo, "src", "alpha.txt"),
      root,
      setup: null,
    }),
  );
  assert.deepEqual(listDir(root), []);
});
