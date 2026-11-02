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
