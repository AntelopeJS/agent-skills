import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, readlinkSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  makeTempDir,
  removeDir,
  writeFile,
  writeJson,
  link,
  writeSkillPackage,
  writeAntelopeConfig,
  runJson,
  runScript,
} from "./helpers.mjs";

const SCRIPT = "sync-skills.mjs";
let root;

beforeEach(() => {
  root = makeTempDir();
});

afterEach(() => {
  removeDir(root);
});

function skillsDir(project) {
  return join(project, ".claude", "skills");
}

function sync(project, args = []) {
  return runJson(SCRIPT, project, args);
}

function byName(result) {
  return Object.fromEntries(result.skills.map((s) => [s.name, s]));
}

test("does nothing outside an AntelopeJS project", () => {
  writeJson(join(root, "package.json"), { name: "plain" });
  const result = sync(root);
  assert.equal(result.project, false);
  assert.equal(existsSync(join(root, ".claude")), false);
});

test("follows pnpm symlinks and links through the stable node_modules path", () => {
  writeAntelopeConfig(root);
  const store = join(root, "node_modules", ".pnpm", "@antelopejs+dms@1.0.0", "node_modules", "@antelopejs", "dms");
  writeSkillPackage(store, "@antelopejs/dms", ["dms", "dms-best-practices"]);
  link(store, join(root, "node_modules", "@antelopejs", "dms"));

  const result = sync(root);

  assert.deepEqual(result.added.sort(), ["dms--dms", "dms--dms-best-practices"]);
  const entry = join(skillsDir(root), "dms--dms");
  assert.ok(lstatSync(entry).isSymbolicLink());
  assert.equal(readlinkSync(entry), join("..", "..", "node_modules", "@antelopejs", "dms", "skills", "dms"));
  assert.equal(byName(result)["dms--dms"].origin, "node_modules");
});

test("links skills of modules installed by ajs in .antelope/cache", () => {
  writeAntelopeConfig(root);
  writeSkillPackage(join(root, ".antelope", "cache", "@antelopejs", "dms-saas"), "@antelopejs/dms-saas", ["dms-saas"]);
  writeSkillPackage(join(root, ".antelope", "cache", "local-mod"), "local-mod", ["local-mod"]);

  const skills = byName(sync(root));

  assert.equal(skills["dms-saas--dms-saas"].origin, "antelope-cache");
  assert.equal(skills["local-mod--local-mod"].package, "local-mod");
});

test("detects an embedded runtime project without antelope.config", () => {
  writeJson(join(root, "package.json"), { name: "adonis-app", dependencies: { "@antelopejs/core": "^1.14.0" } });
  writeSkillPackage(join(root, "node_modules", "@antelopejs", "dms"), "@antelopejs/dms", ["dms"]);

  const result = sync(root);

  assert.equal(result.project, true);
  assert.deepEqual(result.added, ["dms--dms"]);
});

test("links workspace packages of a monorepo before installed copies", () => {
  writeFile(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n  # comment\nonlyBuiltDependencies:\n  - esbuild\n');
  writeJson(join(root, "package.json"), { name: "workspace", private: true });
  writeSkillPackage(join(root, "packages", "dms"), "@antelopejs/dms", ["dms"], "2.0.0-dev");
  writeSkillPackage(join(root, "packages", "interface-dms"), "@antelopejs/interface-dms", ["dms-interface"]);
  const playground = join(root, "packages", "dms", "playground");
  writeAntelopeConfig(playground);
  writeSkillPackage(join(playground, "node_modules", "@antelopejs", "dms"), "@antelopejs/dms", ["dms"], "1.0.0");

  const skills = byName(sync(playground));

  assert.equal(skills["dms--dms"].origin, "workspace");
  assert.equal(skills["dms--dms"].version, "2.0.0-dev");
  assert.equal(skills["interface-dms--dms-interface"].origin, "workspace");
});

test("prunes skills whose package disappeared and never touches user entries", () => {
  writeAntelopeConfig(root);
  const pkg = join(root, "node_modules", "mod-a");
  writeSkillPackage(pkg, "mod-a", ["alpha"]);
  writeSkillPackage(join(root, "node_modules", "mod-b"), "mod-b", ["beta"]);
  writeFile(join(skillsDir(root), "mod-b--beta", "SKILL.md"), "user-owned\n");
  sync(root);

  rmSync(pkg, { recursive: true });
  const result = sync(root);

  assert.deepEqual(result.removed, ["mod-a--alpha"]);
  assert.equal(existsSync(join(skillsDir(root), "mod-a--alpha")), false);
  assert.equal(readFileSync(join(skillsDir(root), "mod-b--beta", "SKILL.md"), "utf8"), "user-owned\n");
  assert.equal(byName(result)["mod-b--beta"].status, "skipped");
});

test("keeps managed entries out of git and stays idempotent", () => {
  writeAntelopeConfig(root);
  writeSkillPackage(join(root, "node_modules", "mod-a"), "mod-a", ["alpha"]);
  sync(root);

  const second = sync(root);

  assert.deepEqual(second.added, []);
  assert.deepEqual(second.kept, ["mod-a--alpha"]);
  const gitignore = readFileSync(join(skillsDir(root), ".gitignore"), "utf8").split("\n");
  assert.ok(gitignore.includes("mod-a--alpha"));
  assert.ok(gitignore.includes(".ajs-managed.json"));
});

test("--list reports skills with their source and changes nothing", () => {
  writeAntelopeConfig(root);
  writeSkillPackage(join(root, "node_modules", "mod-a"), "mod-a", ["alpha"]);

  const output = runScript(SCRIPT, root, ["--list"]);

  assert.match(output, /mod-a--alpha\s+alpha\s+mod-a@1\.0\.0\s+node_modules\s+not synced yet/);
  assert.equal(existsSync(join(root, ".claude")), false);
});

test("skips skill directories that escape their package", () => {
  writeAntelopeConfig(root);
  writeJson(join(root, "node_modules", "evil", "package.json"), { name: "evil", antelopeJs: { skills: ["../../outside"] } });
  writeFile(join(root, "outside", "x", "SKILL.md"), "---\nname: x\n---\n");

  const result = sync(root);

  assert.deepEqual(result.added, []);
  assert.match(result.warnings[0], /escapes the package/);
});
