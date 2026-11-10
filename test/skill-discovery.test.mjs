import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { collectSkillPackages } from "../packages/agent-skills/index.mjs";
import {
  makeTempDir,
  removeDir,
  writeFile,
  writeJson,
  link,
  writeSkillPackage,
} from "./helpers.mjs";

/** @type {string} */
let root;

beforeEach(() => {
  root = makeTempDir();
});

afterEach(() => {
  removeDir(root);
});

/** @param {string[]} parts */
function at(...parts) {
  return join(root, ...parts);
}

/**
 * @param {string} base
 * @param {string} name
 */
function installedAt(base, name) {
  return join(base, "node_modules", ...name.split("/"));
}

/** @param {import("../packages/agent-skills/index.js").SkillPackage[]} packages */
function summary(packages) {
  return packages.map(({ name, kind }) => `${kind}:${name}`);
}

void test("orders modules, their dependencies, the project's dependencies, then installed packages", () => {
  const moduleDir = at("cache", "mod-a");
  writeSkillPackage(moduleDir, "mod-a", ["a"]);
  writeJson(join(moduleDir, "package.json"), {
    name: "mod-a",
    version: "1.0.0",
    antelopeJs: { skills: ["./skills"] },
    dependencies: { "dep-a": "1" },
  });
  writeSkillPackage(installedAt(moduleDir, "dep-a"), "dep-a", ["d"]);
  writeSkillPackage(at("cache", "mod-b"), "mod-b", ["b"]);
  const project = at("app");
  writeJson(join(project, "package.json"), {
    name: "app",
    dependencies: { "proj-dep": "1" },
    devDependencies: { "dev-dep": "1" },
  });
  writeSkillPackage(installedAt(project, "proj-dep"), "proj-dep", ["p"]);
  writeSkillPackage(installedAt(project, "dev-dep"), "dev-dep", ["v"]);
  writeSkillPackage(at("sweep", "swept"), "swept", ["s"]);

  const packages = collectSkillPackages({
    modules: [{ dir: moduleDir }, { dir: at("cache", "mod-b") }],
    project,
    installed: [at("sweep", "swept")],
  });

  assert.deepEqual(summary(packages), [
    "module:mod-a",
    "module:mod-b",
    "dependency:dep-a",
    "project:proj-dep",
    "project:dev-dep",
    "installed:swept",
  ]);
  assert.deepEqual(packages[0], {
    name: "mod-a",
    version: "1.0.0",
    dir: moduleDir,
    skillDirs: [join(moduleDir, "skills")],
    kind: "module",
  });
});

void test("an installed package that implements an interface counts as a module and brings its dependencies", () => {
  const installed = at("app", "node_modules", "impl");
  writeSkillPackage(at("cache", "mod"), "mod", ["m"]);
  writeJson(join(installed, "package.json"), {
    name: "impl",
    antelopeJs: { implements: ["@acme/interface-x"], skills: ["./skills"] },
    dependencies: { "impl-dep": "1" },
  });
  writeFile(join(installed, "skills", "i", "SKILL.md"), "---\nname: i\n---\n");
  writeSkillPackage(installedAt(installed, "impl-dep"), "impl-dep", ["d"]);
  writeSkillPackage(at("app", "node_modules", "plain"), "plain", ["p"]);

  const packages = collectSkillPackages({
    modules: [{ dir: at("cache", "mod") }],
    installed: [at("app", "node_modules", "plain"), installed],
  });

  assert.deepEqual(summary(packages), [
    "module:mod",
    "module:impl",
    "dependency:impl-dep",
    "installed:plain",
  ]);
});

void test("keeps the first copy of a package name and drops later ones", () => {
  writeSkillPackage(at("cache", "first"), "shared", ["from-cache"]);
  writeSkillPackage(at("sweep", "second"), "shared", ["from-sweep"]);

  const packages = collectSkillPackages({
    modules: [{ dir: at("cache", "first") }],
    installed: [at("sweep", "second")],
  });

  assert.deepEqual(
    packages.map((pkg) => pkg.dir),
    [at("cache", "first")],
  );
});

void test("a module without skills still reserves its name against an installed copy", () => {
  writeJson(at("cache", "quiet", "package.json"), { name: "quiet-pkg" });
  writeSkillPackage(at("sweep", "quiet"), "quiet-pkg", ["hidden"]);
  writeSkillPackage(at("sweep", "other"), "other-pkg", ["shown"]);

  const packages = collectSkillPackages({
    modules: [{ dir: at("cache", "quiet") }],
    installed: [at("sweep", "quiet"), at("sweep", "other")],
  });

  assert.deepEqual(summary(packages), ["installed:other-pkg"]);
});

void test("a dependency without skills reserves its name against an installed copy", () => {
  const moduleDir = at("cache", "mod");
  writeJson(join(moduleDir, "package.json"), {
    name: "mod",
    dependencies: { bare: "1" },
  });
  writeJson(join(installedAt(moduleDir, "bare"), "package.json"), {
    name: "bare",
  });
  writeSkillPackage(at("sweep", "bare"), "bare", ["hidden"]);

  const packages = collectSkillPackages({
    modules: [{ dir: moduleDir }],
    installed: [at("sweep", "bare")],
  });

  assert.deepEqual(packages, []);
});

void test("drops a skills dir outside its package, warns, and keeps the others", () => {
  const dir = at("cache", "mod");
  writeJson(join(dir, "package.json"), {
    name: "mod",
    antelopeJs: {
      skills: ["./skills", "../elsewhere", at("abs"), "./..hidden"],
    },
  });
  /** @type {string[]} */
  const warnings = [];

  const [pkg] = collectSkillPackages({
    modules: [{ dir }],
    onWarning: (message) => warnings.push(message),
  });

  assert.deepEqual(pkg.skillDirs, [join(dir, "skills"), join(dir, "..hidden")]);
  assert.deepEqual(warnings, [
    "mod: skills dir '../elsewhere' escapes the package — skipped.",
    `mod: skills dir '${at("abs")}' escapes the package — skipped.`,
  ]);
});

void test("returns nothing for a package whose only skills dir escapes or whose skills array is empty", () => {
  writeJson(at("cache", "escaping", "package.json"), {
    name: "escaping",
    antelopeJs: { skills: ["../outside"] },
  });
  writeJson(at("cache", "empty", "package.json"), {
    name: "empty",
    antelopeJs: { skills: [] },
  });

  const packages = collectSkillPackages({
    modules: [{ dir: at("cache", "escaping") }, { dir: at("cache", "empty") }],
    onWarning: () => {},
  });

  assert.deepEqual(packages, []);
});

void test("reads a malformed or missing manifest as absent and never throws", () => {
  writeFile(at("cache", "broken-json", "package.json"), "{ not json");
  writeFile(at("cache", "array", "package.json"), '["name"]');
  writeFile(at("cache", "null", "package.json"), "null");
  writeJson(at("cache", "number-name", "package.json"), {
    name: 4,
    antelopeJs: { skills: ["./skills"] },
  });
  writeJson(at("cache", "string-skills", "package.json"), {
    name: "string-skills",
    antelopeJs: { skills: "skills" },
  });
  writeJson(at("cache", "null-config", "package.json"), {
    name: "null-config",
    antelopeJs: null,
    dependencies: ["x"],
  });
  writeJson(at("cache", "bad-entries", "package.json"), {
    name: "bad-entries",
    version: 3,
    antelopeJs: { skills: [7, null, "", ["x"], "./skills"] },
  });
  const modules = [
    "broken-json",
    "array",
    "null",
    "number-name",
    "string-skills",
    "null-config",
    "bad-entries",
    "missing",
  ].map((name) => ({ dir: at("cache", name) }));

  const packages = collectSkillPackages({ modules });

  assert.deepEqual(packages, [
    {
      name: "bad-entries",
      version: null,
      dir: at("cache", "bad-entries"),
      skillDirs: [join(at("cache", "bad-entries"), "skills")],
      kind: "module",
    },
  ]);
});

void test("falls back to the module id and the dependency name when a manifest has no name", () => {
  writeJson(at("cache", "nameless", "package.json"), {
    antelopeJs: { skills: ["./skills"] },
    dependencies: { "dep-nameless": "1" },
  });
  writeJson(at("cache", "skipped", "package.json"), {
    antelopeJs: { skills: ["./skills"] },
  });
  writeJson(
    join(installedAt(at("cache", "nameless"), "dep-nameless"), "package.json"),
    {
      antelopeJs: { skills: ["./skills"] },
    },
  );
  writeJson(at("sweep", "unnamed", "package.json"), {
    antelopeJs: { skills: ["./skills"] },
  });

  const packages = collectSkillPackages({
    modules: [
      { dir: at("cache", "nameless"), id: "given-id" },
      { dir: at("cache", "skipped") },
    ],
    installed: [at("sweep", "unnamed")],
  });

  assert.deepEqual(summary(packages), [
    "module:given-id",
    "dependency:dep-nameless",
  ]);
});

void test("resolves a pnpm-style symlinked dependency and the dependencies of a symlinked module from their real paths", () => {
  const store = at("app", "node_modules", ".pnpm", "mod@1", "node_modules");
  writeJson(join(store, "mod", "package.json"), {
    name: "mod",
    dependencies: { leaf: "1" },
  });
  writeSkillPackage(join(store, "leaf"), "leaf", ["l"]);
  link(join(store, "mod"), at("app", "node_modules", "mod"));

  const packages = collectSkillPackages({
    modules: [{ dir: at("app", "node_modules", "mod") }],
  });

  assert.deepEqual(summary(packages), ["dependency:leaf"]);
  assert.equal(packages[0].dir, join(store, "leaf"));
});

void test("reads the project's devDependencies only when a project is given", () => {
  const project = at("app");
  writeJson(join(project, "package.json"), {
    name: "app",
    devDependencies: { tool: "1" },
    optionalDependencies: { extra: "1" },
  });
  writeSkillPackage(installedAt(project, "tool"), "tool", ["t"]);
  writeSkillPackage(installedAt(project, "extra"), "extra", ["e"]);

  const without = collectSkillPackages({ modules: [] });
  const withProject = collectSkillPackages({ modules: [], project });

  assert.deepEqual(without, []);
  assert.deepEqual(summary(withProject), ["project:extra", "project:tool"]);
});

void test("a module's devDependencies are not read", () => {
  const moduleDir = at("cache", "mod");
  writeJson(join(moduleDir, "package.json"), {
    name: "mod",
    devDependencies: { tool: "1" },
  });
  writeSkillPackage(installedAt(moduleDir, "tool"), "tool", ["t"]);

  assert.deepEqual(collectSkillPackages({ modules: [{ dir: moduleDir }] }), []);
});
