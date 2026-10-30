import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, readlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import {
  makeTempDir,
  removeDir,
  writeFile,
  writeJson,
  link,
  writeSkillPackage,
  writeAntelopeConfig,
  runScript,
} from "./helpers.mjs";
import { readText } from "./helpers/read.mjs";
import { parseSyncOutput, runSyncJson } from "./helpers/sync-output.mjs";

/**
 * @typedef {import("./helpers/sync-output.mjs").SyncOutput} SyncOutput
 */

const SCRIPT = "sync-skills.mjs";
/** @type {string} */
let root;

beforeEach(() => {
  root = makeTempDir();
});

afterEach(() => {
  removeDir(root);
});

/** @type {Record<string, string[]>} */
const TARGET_DIRS = {
  claude: [".claude", "skills"],
  codex: [".agents", "skills"],
};

/**
 * @param {string} project
 * @param {string} [target]
 * @returns {string}
 */
function skillsDir(project, target = "claude") {
  return join(project, ...TARGET_DIRS[target]);
}

/**
 * @param {SyncOutput} result
 * @param {string} [target]
 */
function forTarget(result, target = "claude") {
  const found = result.targets.find((t) => t.target === target);
  assert.ok(found, `no ${target} result`);
  return found;
}

/**
 * @param {string} project
 * @param {string[]} [args]
 * @returns {SyncOutput}
 */
function sync(project, args = []) {
  return runSyncJson(SCRIPT, project, args);
}

/**
 * @param {SyncOutput} result
 */
function byName(result) {
  return Object.fromEntries(result.skills.map((s) => [s.name, s]));
}

void test("does nothing outside an AntelopeJS project", () => {
  writeJson(join(root, "package.json"), { name: "plain" });
  const result = sync(root);
  assert.equal(result.project, false);
  assert.equal(existsSync(join(root, ".claude")), false);
});

void test("follows pnpm symlinks and links through the stable node_modules path", () => {
  writeAntelopeConfig(root);
  const store = join(
    root,
    "node_modules",
    ".pnpm",
    "@antelopejs+dms@1.0.0",
    "node_modules",
    "@antelopejs",
    "dms",
  );
  writeSkillPackage(store, "@antelopejs/dms", ["dms", "dms-best-practices"]);
  link(store, join(root, "node_modules", "@antelopejs", "dms"));

  const result = sync(root);

  assert.deepEqual(forTarget(result).added.sort(), [
    "dms--dms",
    "dms--dms-best-practices",
  ]);
  const entry = join(skillsDir(root), "dms--dms");
  assert.ok(lstatSync(entry).isSymbolicLink());
  assert.equal(
    readlinkSync(entry),
    join("..", "..", "node_modules", "@antelopejs", "dms", "skills", "dms"),
  );
  assert.equal(byName(result)["dms--dms"].origin, "node_modules");
});

void test("links skills of modules installed by ajs in .antelope/cache", () => {
  writeAntelopeConfig(root);
  writeSkillPackage(
    join(root, ".antelope", "cache", "@antelopejs", "dms-saas"),
    "@antelopejs/dms-saas",
    ["dms-saas"],
  );
  writeSkillPackage(
    join(root, ".antelope", "cache", "local-mod"),
    "local-mod",
    ["local-mod"],
  );

  const skills = byName(sync(root));

  assert.equal(skills["dms-saas--dms-saas"].origin, "antelope-cache");
  assert.equal(skills["local-mod--local-mod"].package, "local-mod");
});

void test("detects an embedded runtime project without antelope.config", () => {
  writeJson(join(root, "package.json"), {
    name: "adonis-app",
    dependencies: { "@antelopejs/core": "^1.14.0" },
  });
  writeSkillPackage(
    join(root, "node_modules", "@antelopejs", "dms"),
    "@antelopejs/dms",
    ["dms"],
  );

  const result = sync(root);

  assert.equal(result.project, true);
  assert.deepEqual(forTarget(result).added, ["dms--dms"]);
});

void test("links workspace packages of a monorepo before installed copies", () => {
  writeFile(
    join(root, "pnpm-workspace.yaml"),
    'packages:\n  - "packages/*"\n  # comment\nonlyBuiltDependencies:\n  - esbuild\n',
  );
  writeJson(join(root, "package.json"), { name: "workspace", private: true });
  writeSkillPackage(
    join(root, "packages", "dms"),
    "@antelopejs/dms",
    ["dms"],
    "2.0.0-dev",
  );
  writeSkillPackage(
    join(root, "packages", "interface-dms"),
    "@antelopejs/interface-dms",
    ["dms-interface"],
  );
  const playground = join(root, "packages", "dms", "playground");
  writeAntelopeConfig(playground);
  writeSkillPackage(
    join(playground, "node_modules", "@antelopejs", "dms"),
    "@antelopejs/dms",
    ["dms"],
    "1.0.0",
  );

  const skills = byName(sync(playground));

  assert.equal(skills["dms--dms"].origin, "workspace");
  assert.equal(skills["dms--dms"].version, "2.0.0-dev");
  assert.equal(skills["interface-dms--dms-interface"].origin, "workspace");
});

void test("prunes skills whose package disappeared and never touches user entries", () => {
  writeAntelopeConfig(root);
  const pkg = join(root, "node_modules", "mod-a");
  writeSkillPackage(pkg, "mod-a", ["alpha"]);
  writeSkillPackage(join(root, "node_modules", "mod-b"), "mod-b", ["beta"]);
  writeFile(join(skillsDir(root), "mod-b--beta", "SKILL.md"), "user-owned\n");
  sync(root);

  rmSync(pkg, { recursive: true });
  const result = sync(root);

  assert.deepEqual(forTarget(result).removed, ["mod-a--alpha"]);
  assert.equal(existsSync(join(skillsDir(root), "mod-a--alpha")), false);
  assert.equal(
    readText(join(skillsDir(root), "mod-b--beta", "SKILL.md")),
    "user-owned\n",
  );
  assert.equal(byName(result)["mod-b--beta"].status.claude, "skipped");
});

void test("keeps managed entries out of git and stays idempotent", () => {
  writeAntelopeConfig(root);
  writeSkillPackage(join(root, "node_modules", "mod-a"), "mod-a", ["alpha"]);
  sync(root);

  const second = sync(root);

  for (const target of Object.keys(TARGET_DIRS)) {
    assert.deepEqual(forTarget(second, target).added, []);
    assert.deepEqual(forTarget(second, target).kept, ["mod-a--alpha"]);
    const gitignore = readText(
      join(skillsDir(root, target), ".gitignore"),
    ).split("\n");
    assert.ok(gitignore.includes("mod-a--alpha"));
    assert.ok(gitignore.includes(".ajs-managed.json"));
  }
});

void test("--list reports skills with their source and changes nothing", () => {
  writeAntelopeConfig(root);
  writeSkillPackage(join(root, "node_modules", "mod-a"), "mod-a", ["alpha"]);

  const output = runScript(SCRIPT, root, ["--list"]);

  assert.match(output, /FROM\s+CLAUDE\s+CODEX\s+SOURCE/);
  assert.match(
    output,
    /mod-a--alpha\s+alpha\s+mod-a@1\.0\.0\s+node_modules\s+not synced yet\s+not synced yet/,
  );
  assert.equal(existsSync(join(root, ".claude")), false);
  assert.equal(existsSync(join(root, ".agents")), false);
});

void test("skips skill directories that escape their package", () => {
  writeAntelopeConfig(root);
  writeJson(join(root, "node_modules", "evil", "package.json"), {
    name: "evil",
    antelopeJs: { skills: ["../../outside"] },
  });
  writeFile(join(root, "outside", "x", "SKILL.md"), "---\nname: x\n---\n");

  const result = sync(root);

  assert.deepEqual(forTarget(result).added, []);
  assert.match(result.warnings[0], /escapes the package/);
});

void test("links the same entries into .claude/skills and .agents/skills by default", () => {
  writeAntelopeConfig(root);
  writeSkillPackage(
    join(root, "node_modules", "@antelopejs", "dms"),
    "@antelopejs/dms",
    ["dms"],
  );

  const result = sync(root);

  for (const target of Object.keys(TARGET_DIRS)) {
    assert.deepEqual(forTarget(result, target).added, ["dms--dms"]);
    const entry = join(skillsDir(root, target), "dms--dms");
    assert.equal(
      readlinkSync(entry),
      join("..", "..", "node_modules", "@antelopejs", "dms", "skills", "dms"),
    );
  }
});

void test("--target syncs one directory and leaves the other untouched", () => {
  writeAntelopeConfig(root);
  writeSkillPackage(join(root, "node_modules", "mod-a"), "mod-a", ["alpha"]);
  writeFile(
    join(skillsDir(root, "claude"), "mod-a--alpha", "SKILL.md"),
    "user-owned\n",
  );

  const result = sync(root, ["--target", "codex"]);
  const inline = sync(root, ["--target=codex"]);

  assert.deepEqual(
    result.targets.map((t) => t.target),
    ["codex"],
  );
  assert.deepEqual(forTarget(result, "codex").added, ["mod-a--alpha"]);
  assert.deepEqual(forTarget(inline, "codex").kept, ["mod-a--alpha"]);
  assert.equal(
    existsSync(join(skillsDir(root, "claude"), ".ajs-managed.json")),
    false,
  );
  assert.ok(
    lstatSync(join(skillsDir(root, "codex"), "mod-a--alpha")).isSymbolicLink(),
  );
});

void test("rejects an unknown --target", () => {
  writeAntelopeConfig(root);

  assert.throws(
    () => runScript(SCRIPT, root, ["--target", "cursor"]),
    /expects one of claude, codex, all/,
  );
});

void test("the agent-skills bin forwards sync to the sync script", () => {
  writeAntelopeConfig(root);
  writeSkillPackage(join(root, "node_modules", "mod-a"), "mod-a", ["alpha"]);
  const bin = join(import.meta.dirname, "..", "bin", "agent-skills.mjs");

  const output = execFileSync(
    process.execPath,
    [bin, "sync", "--target", "codex", "--json"],
    { cwd: root, encoding: "utf8" },
  );

  assert.deepEqual(forTarget(parseSyncOutput(output), "codex").added, [
    "mod-a--alpha",
  ]);
});

void test("links the framework skills @antelopejs/core ships into an embedded-runtime app", () => {
  writeJson(join(root, "package.json"), {
    name: "host-app",
    dependencies: { "@antelopejs/core": "^1.0.0" },
  });
  const frameworkSkills = [
    "ajs-author-interface",
    "ajs-cli",
    "ajs-consume-interface",
    "antelopejs",
  ];
  writeSkillPackage(
    join(root, "node_modules", "@antelopejs", "core"),
    "@antelopejs/core",
    frameworkSkills,
  );

  const result = sync(root);

  assert.deepEqual(
    forTarget(result).added.sort(),
    frameworkSkills.map((skill) => `core--${skill}`),
  );
  assert.equal(byName(result)["core--antelopejs"].skill, "antelopejs");
});
