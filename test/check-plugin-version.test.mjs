import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { makeTempDir, removeDir, writeFile, writeJson } from "./helpers.mjs";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "check-plugin-version.mjs",
);
const MANIFESTS = [
  "plugin/.claude-plugin/plugin.json",
  "plugin/.codex-plugin/plugin.json",
  "package.json",
];
/** @type {string} */
let root;

/** The environment of a git hook minus its `GIT_*` variables, so git works on the fixture repository, never on the checkout running the tests. */
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);

/** @param {string[]} args */
function git(...args) {
  execFileSync("git", args, { cwd: root, stdio: "ignore", env: ENV });
}

/** @param {string} message */
function commit(message) {
  git("add", "--all");
  git(
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    message,
  );
}

/** @param {string} version */
function setVersion(version) {
  for (const path of MANIFESTS) writeJson(join(root, path), { version });
}

/** @param {string} path */
function edit(path) {
  writeFile(join(root, path), `changed ${path}\n`);
}

function check() {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    [SCRIPT, "--released", "release", root],
    { encoding: "utf8", env: ENV },
  );
  return { status, output: stdout + stderr };
}

/** @param {number} expected */
function assertStatus(expected) {
  const { status, output } = check();
  assert.equal(status, expected, output);
  return output;
}

beforeEach(() => {
  root = makeTempDir();
  git("init", "--quiet");
  setVersion("0.8.2");
  writeFile(join(root, "plugin/skills/dms-pages/SKILL.md"), "released\n");
  writeFile(join(root, "plugin/scripts/sync-skills.mjs"), "released\n");
  writeFile(join(root, "plugin/packages/agent-skills/index.mjs"), "released\n");
  writeFile(join(root, "plugin/packages/agent-skills/README.md"), "released\n");
  writeFile(join(root, "README.md"), "released\n");
  commit("release");
  git("branch", "release");
});

afterEach(() => removeDir(root));

void test("passes when nothing the plugin ships changed", () => {
  edit("README.md");
  edit("plugin/packages/agent-skills/README.md");
  writeJson(join(root, "plugin/packages/agent-skills/package.json"), {
    version: "0.9.0",
  });
  assertStatus(0);
});

void test("fails on a changed skill with the released version, naming the file", () => {
  edit("plugin/skills/dms-pages/SKILL.md");
  const output = assertStatus(1);
  assert.match(
    output,
    /version 0\.8\.2 is not greater than 0\.8\.2 at release/,
  );
  assert.match(output, /^ {2}plugin\/skills\/dms-pages\/SKILL\.md$/m);
});

void test("fails on a new untracked skill file with the released version", () => {
  writeFile(join(root, "plugin/skills/new-skill/SKILL.md"), "new\n");
  assert.match(assertStatus(1), /plugin\/skills\/new-skill\/SKILL\.md/);
});

void test("fails on a committed change to the package code the plugin runs", () => {
  edit("plugin/packages/agent-skills/index.mjs");
  commit("change");
  assert.match(assertStatus(1), /agent-skills\/index\.mjs/);
});

void test("fails when the version went down", () => {
  edit("plugin/scripts/sync-skills.mjs");
  setVersion("0.8.1");
  assert.match(assertStatus(1), /version 0\.8\.1 is not greater than 0\.8\.2/);
});

void test("passes once the version is bumped at any level", () => {
  edit("plugin/skills/dms-pages/SKILL.md");
  for (const version of ["0.8.3", "0.9.0", "1.0.0"]) {
    setVersion(version);
    assertStatus(0);
  }
});

void test("compares versions numerically, not as text", () => {
  edit("plugin/skills/dms-pages/SKILL.md");
  setVersion("0.8.10");
  assertStatus(0);
});

void test("fails with a hint when the released ref is missing", () => {
  edit("plugin/skills/dms-pages/SKILL.md");
  git("branch", "-D", "release");
  assert.match(assertStatus(1), /cannot read release, the released plugin/);
});

void test("fails on a deleted skill with the released version", () => {
  git("rm", "--quiet", "plugin/skills/dms-pages/SKILL.md");
  assert.match(assertStatus(1), /^ {2}plugin\/skills\/dms-pages\/SKILL\.md$/m);
});

void test("fails when a later part grows but an earlier one shrinks", () => {
  edit("plugin/skills/dms-pages/SKILL.md");
  setVersion("0.7.9");
  assert.match(assertStatus(1), /version 0\.7\.9 is not greater than 0\.8\.2/);
});

void test("fails on a version that is not MAJOR.MINOR.PATCH", () => {
  edit("plugin/skills/dms-pages/SKILL.md");
  for (const version of ["0.9", "0.9.0-beta.1"]) {
    setVersion(version);
    assert.match(assertStatus(1), /version must be MAJOR\.MINOR\.PATCH/);
  }
});

void test("compares with the release that moved past the branch", () => {
  git("checkout", "--quiet", "-b", "work");
  edit("plugin/skills/dms-pages/SKILL.md");
  setVersion("0.8.3");
  commit("work");
  git("checkout", "--quiet", "release");
  edit("plugin/scripts/sync-skills.mjs");
  setVersion("0.8.3");
  commit("another release");
  git("checkout", "--quiet", "work");
  const output = assertStatus(1);
  assert.match(output, /version 0\.8\.3 is not greater than 0\.8\.3/);
  assert.doesNotMatch(output, /sync-skills/);
});

void test("passes on a branch behind the release that leaves the plugin alone", () => {
  git("checkout", "--quiet", "-b", "work");
  edit("README.md");
  commit("docs");
  git("checkout", "--quiet", "release");
  edit("plugin/scripts/sync-skills.mjs");
  setVersion("0.8.3");
  commit("another release");
  git("checkout", "--quiet", "work");
  assertStatus(0);
});

void test("prints the usage and exits 2 on an unknown option", () => {
  const { status, stdout } = spawnSync(
    process.execPath,
    [SCRIPT, "--unknown"],
    { encoding: "utf8", env: ENV },
  );
  assert.equal(status, 2);
  assert.match(stdout, /^Usage: check-plugin-version/);
});
