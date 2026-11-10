import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cpSync } from "node:fs";
import { join, sep } from "node:path";
import { execFileSync } from "node:child_process";

import {
  makeTempDir,
  removeDir,
  writeJson,
  writeSkillPackage,
  writeAntelopeConfig,
} from "./helpers.mjs";

/** @type {string} */
let root;

beforeEach(() => {
  root = makeTempDir();
});

afterEach(() => {
  removeDir(root);
});

/**
 * @param {string} scriptsParent
 * @param {string} project
 * @returns {string}
 */
function list(scriptsParent, project) {
  return execFileSync(
    process.execPath,
    [join(scriptsParent, "scripts", "sync-skills.mjs"), "--list"],
    { cwd: project, encoding: "utf8" },
  );
}

void test("a cached module that ships no skills hides the skills of the installed copy", () => {
  writeAntelopeConfig(root);
  writeJson(
    join(root, ".antelope", "cache", "@antelopejs", "dms", "package.json"),
    {
      name: "@antelopejs/dms",
      version: "2.0.0",
    },
  );
  writeSkillPackage(
    join(root, "node_modules", "@antelopejs", "dms"),
    "@antelopejs/dms",
    ["dms"],
  );
  writeSkillPackage(join(root, "node_modules", "other"), "other", ["beta"]);

  const output = list(join(import.meta.dirname, ".."), root);

  assert.match(output, /other--beta/);
  assert.doesNotMatch(output, /dms--dms/);
});

void test("reads the dependencies of an installed module, not those of any installed package", () => {
  writeAntelopeConfig(root);
  const modules = join(root, "node_modules");
  writeJson(join(modules, "a-module", "package.json"), {
    name: "a-module",
    antelopeJs: { implements: ["@acme/interface"] },
    dependencies: { "module-interface": "1" },
  });
  writeJson(join(modules, "a-library", "package.json"), {
    name: "a-library",
    dependencies: { "library-interface": "1" },
  });
  writeSkillPackage(
    join(modules, "a-module", "node_modules", "module-interface"),
    "module-interface",
    ["alpha"],
  );
  writeSkillPackage(
    join(modules, "a-library", "node_modules", "library-interface"),
    "library-interface",
    ["beta"],
  );

  const output = list(join(import.meta.dirname, ".."), root);

  assert.match(output, /module-interface--alpha/);
  assert.doesNotMatch(output, /library-interface--beta/);
});

void test("an installed module wins over a dependency copy of the same package", () => {
  writeAntelopeConfig(root);
  writeJson(join(root, ".antelope", "cache", "cached-module", "package.json"), {
    name: "cached-module",
    dependencies: { shared: "1" },
  });
  writeSkillPackage(
    join(root, ".antelope", "cache", "cached-module", "node_modules", "shared"),
    "shared",
    ["from-dependency"],
  );
  writeSkillPackage(join(root, "node_modules", "shared"), "shared", [
    "from-installed",
  ]);
  writeJson(join(root, "node_modules", "shared", "package.json"), {
    name: "shared",
    antelopeJs: { implements: ["@acme/interface"], skills: ["./skills"] },
  });

  const output = list(join(import.meta.dirname, ".."), root);

  assert.match(output, /shared--from-installed/);
  assert.doesNotMatch(output, /shared--from-dependency/);
});

void test("runs from a plugin checkout with no node_modules", () => {
  const checkout = join(root, "plugin");
  for (const dir of ["scripts", "packages"]) {
    cpSync(join(import.meta.dirname, "..", dir), join(checkout, dir), {
      recursive: true,
      filter: (source) => !source.split(sep).includes("node_modules"),
    });
  }
  const project = join(root, "project");
  writeAntelopeConfig(project);
  writeSkillPackage(join(project, "node_modules", "mod-a"), "mod-a", ["alpha"]);
  writeSkillPackage(join(project, ".antelope", "cache", "mod-b"), "mod-b", [
    "beta",
  ]);

  const output = list(checkout, project);

  assert.match(output, /mod-a--alpha/);
  assert.match(output, /mod-b--beta/);
});
