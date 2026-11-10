import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync } from "node:fs";
import { delimiter, join } from "node:path";

import { fetchPackage } from "../scripts/lib/packages.mjs";
import { makeTempDir, removeDir, writeFile } from "./helpers.mjs";

/** @type {string} */
let root;
/** @type {string | undefined} */
let path;

beforeEach(() => {
  root = makeTempDir();
  path = process.env.PATH;
  const npm = join(root, "bin", "npm");
  writeFile(
    npm,
    [
      "#!/bin/sh",
      'if [ "$1" = view ]; then echo \'"1.0.0"\'; exit 0; fi',
      'dest="$4"',
      'src=$(mktemp -d "$dest/src.XXXXXX")',
      'mkdir "$src/package"',
      'echo \'{"name":"@acme/kit","version":"1.0.0"}\' > "$src/package/package.json"',
      'tar -czf "$dest/acme-kit-1.0.0.tgz" -C "$src" package',
      'rm -rf "$src"',
      'echo \'[{"filename":"acme-kit-1.0.0.tgz"}]\'',
    ].join("\n"),
  );
  chmodSync(npm, 0o755);
  process.env.PATH = `${join(root, "bin")}${delimiter}${path}`;
});

afterEach(() => {
  process.env.PATH = path;
  removeDir(root);
});

void test("two specs of the same version fetched together share one extracted copy", async () => {
  const cache = join(root, "cache");

  const dirs = await Promise.all([
    fetchPackage("@acme/kit@latest", cache),
    fetchPackage("@acme/kit@1.0.0", cache),
  ]);

  assert.deepEqual(dirs, [
    join(cache, "acme__kit", "1.0.0", "package"),
    join(cache, "acme__kit", "1.0.0", "package"),
  ]);
  assert.ok(existsSync(join(dirs[0], "package.json")));
});
