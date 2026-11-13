import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { makeTempDir, removeDir } from "./helpers.mjs";
import { fieldOf } from "../plugin/scripts/lib/safe-read.mjs";
import { isText } from "../plugin/scripts/lib/values.mjs";

const PACKAGE_DIR = join(
  import.meta.dirname,
  "..",
  "plugin",
  "packages",
  "agent-skills",
);
const WORKFLOW_SKILLS = [
  "dms-best-practices",
  "dms-builder-mcp",
  "dms-external-database",
  "dms-mockup",
  "dms-mockup-build",
  "dms-page-design",
  "dms-pages",
];
const OTHER_PLUGIN_SKILLS = [
  "interface",
  "new-module",
  "skills",
  "sync-skills",
];
const work = makeTempDir();

after(() => removeDir(work));

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {string}
 */
function textField(value, key) {
  const field = fieldOf(value, key);
  assert.ok(isText(field), key);
  return field;
}

/** @returns {string} the tarball's path */
function pack() {
  const output = execFileSync(
    "npm",
    ["pack", "--json", "--pack-destination", work],
    { cwd: PACKAGE_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  /** @type {unknown} */
  const packed = JSON.parse(output);
  return join(work, textField([packed].flat()[0], "filename"));
}

void test("the published package's workflowSkillsDir holds the plugin's DMS workflow skills and no other plugin skill", async () => {
  execFileSync("tar", ["-xzf", pack(), "-C", work]);
  /** @type {unknown} */
  const published = await import(
    pathToFileURL(join(work, "package", "index.mjs")).href
  );
  const dir = textField(published, "workflowSkillsDir");

  for (const name of WORKFLOW_SKILLS)
    assert.ok(existsSync(join(dir, name, "SKILL.md")), name);
  for (const name of OTHER_PLUGIN_SKILLS)
    assert.equal(existsSync(join(dir, name)), false, name);
});

void test("packing leaves no copied skills in the source checkout", () => {
  pack();

  assert.equal(existsSync(join(PACKAGE_DIR, "skills")), false);
});
