import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { makeTempDir, removeDir, writeJson } from "./helpers.mjs";
import {
  cachedModuleDirs,
  cachedModules,
} from "../plugin/scripts/lib/module-cache.mjs";

/** @type {string} */
let root;

beforeEach(() => {
  root = makeTempDir();
});

afterEach(() => {
  removeDir(root);
});

/**
 * @param {string} rel
 * @returns {string}
 */
function cacheDir(rel) {
  const dir = join(root, ".antelope", "cache", rel);
  writeJson(join(dir, "package.json"), { name: rel });
  return dir;
}

void test("finds a scoped module in its name@version folder and ranks the wanted version first", () => {
  const v1 = cacheDir("@antelopejs/dms@1.0.0");
  const v2 = cacheDir("@antelopejs/dms@1.10.0");
  assert.deepEqual(cachedModuleDirs(root, "@antelopejs/dms"), [v2, v1]);
  assert.deepEqual(cachedModuleDirs(root, "@antelopejs/dms", "v1.0.0"), [
    v1,
    v2,
  ]);
});

void test("finds an unversioned folder and does not match a longer name", () => {
  const plain = cacheDir("local-mod");
  cacheDir("local-mod-extra@2.0.0");
  assert.deepEqual(cachedModuleDirs(root, "local-mod"), [plain]);
});

void test("lists a versioned scoped entry under its package name, never name@version", () => {
  cacheDir("@antelopejs/dms@1.0.0");
  assert.deepEqual(
    cachedModules(root).map((m) => [m.name, m.version]),
    [["@antelopejs/dms", "1.0.0"]],
  );
});
