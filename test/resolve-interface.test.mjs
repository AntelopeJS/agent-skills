import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import {
  makeTempDir,
  removeDir,
  writeFile,
  writeJson,
  runScript,
} from "./helpers.mjs";
import { isRecord } from "../scripts/lib/values.mjs";

const SCRIPT = "resolve-interface.mjs";
const OFFLINE = ["--offline"];
/** @type {string} */
let project;

/**
 * @param {string[]} args
 * @returns {unknown}
 */
function resolverJson(args) {
  return JSON.parse(runScript(SCRIPT, project, [...args, "--json"]));
}

before(() => {
  project = makeTempDir();
  writeJson(join(project, "package.json"), {
    name: "consumer",
    dependencies: { "@acme/interface-payments": "^1.0.0" },
  });
  const pkg = join(project, "node_modules", "@acme", "interface-payments");
  writeJson(join(pkg, "package.json"), {
    name: "@acme/interface-payments",
    version: "1.2.0",
    description: "Payments contract",
    exports: {
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      "./refunds": {
        types: "./dist/refunds.d.ts",
        default: "./dist/refunds.js",
      },
    },
  });
  writeFile(
    join(pkg, "dist", "index.d.ts"),
    "export declare function Charge(amount: number): Promise<string>;\n",
  );
  writeFile(
    join(pkg, "dist", "refunds.d.ts"),
    "export interface Refund {\n    id: string;\n}\n",
  );
});

after(() => {
  removeDir(project);
});

void test("show resolves a bare name against a scope discovered from the project", () => {
  const result = resolverJson(["show", "payments", ...OFFLINE]);

  if (!isRecord(result) || !Array.isArray(result.subpaths))
    assert.fail("show printed no subpaths");
  assert.equal(result.package, "@acme/interface-payments");
  assert.equal(result.version, "1.2.0");
  assert.deepEqual(
    result.subpaths.map((s) => (isRecord(s) ? s.import : undefined)),
    ["@acme/interface-payments", "@acme/interface-payments/refunds"],
  );
});

void test("contract prints the .d.ts of a subpath", () => {
  const output = runScript(SCRIPT, project, [
    "contract",
    "@acme/interface-payments",
    "refunds",
    ...OFFLINE,
  ]);

  assert.match(output, /export interface Refund/);
});

void test("list includes locally installed interfaces when offline", () => {
  const rows = resolverJson(["list", ...OFFLINE]);

  assert.ok(
    Array.isArray(rows) &&
      rows.some(
        (row) =>
          isRecord(row) &&
          row.package === "@acme/interface-payments" &&
          row.source === "local",
      ),
  );
});
