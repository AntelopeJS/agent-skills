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

/** @param {string[]} args */
function git(...args) {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
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
    { encoding: "utf8" },
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
  git("add", ".");
  git(
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--quiet",
    "-m",
    "release",
  );
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
  git("add", ".");
  git(
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--quiet",
    "-m",
    "change",
  );
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
  assert.match(assertStatus(1), /cannot compare the plugin with release/);
});
