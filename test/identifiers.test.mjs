import { test } from "node:test";
import assert from "node:assert/strict";

import { extractApiReferences } from "../scripts/lib/identifiers.mjs";

const fence = "```";

function importsOf(text) {
  return extractApiReferences(text).imports.map(({ specifier, names }) => [specifier, names.map((n) => n.imported)]);
}

function referencesOf(text) {
  return extractApiReferences(text).references.map((r) => r.name);
}

test("reads named, aliased, type and multi-line imports from code fences", () => {
  const answer = [
    "Use the table view:",
    `${fence}ts`,
    'import { TableView, KpiCard as Kpi, type PageOptions } from "@antelopejs/interface-dms/base";',
    "import {",
    "  RegisterPage,",
    "  PageController,",
    '} from "@antelopejs/interface-dms";',
    fence,
  ].join("\n");

  assert.deepEqual(importsOf(answer), [
    ["@antelopejs/interface-dms/base", ["TableView", "KpiCard", "PageOptions"]],
    ["@antelopejs/interface-dms", ["RegisterPage", "PageController"]],
  ]);
});

test("reads require destructuring, re-exports and side-effect imports", () => {
  const code = [
    fence,
    'const { DatabaseService } = require("@antelopejs/core");',
    'export { SendTemplate } from "@antelopejs/interface-dms-mailing";',
    'import "@antelopejs/interface-dms-media/register";',
    fence,
  ].join("\n");

  assert.deepEqual(importsOf(code), [
    ["@antelopejs/core", ["DatabaseService"]],
    ["@antelopejs/interface-dms-mailing", ["SendTemplate"]],
    ["@antelopejs/interface-dms-media/register", []],
  ]);
});

test("default and namespace imports bind names without checking them", () => {
  const { imports } = extractApiReferences(`${fence}\nimport Mailer, * as Media from "x";\n${fence}`);

  assert.deepEqual(imports[0].names, []);
  assert.deepEqual(imports[0].bound, ["Mailer", "Media"]);
});

test("collects API-shaped references from inline code and code, minus locals, imports and globals", () => {
  const answer = [
    "Call `DatabaseService.find()` or decorate with `@RegisterPage`; set `DMS_AI=1` and read `orders`.",
    `${fence}ts`,
    'import { TableView } from "@antelopejs/interface-dms/base";',
    "class OrdersPage {}",
    "@Controller('/orders')",
    "export class Orders extends OrdersPage {",
    "  table = TableView.fromSource(new Promise(() => {}));",
    "  kpi = KpiCard({ label: 'Revenue' });",
    "}",
    fence,
  ].join("\n");

  assert.deepEqual(referencesOf(answer).sort(), ["Controller", "DatabaseService", "KpiCard", "RegisterPage"]);
});

test("a diff contributes only its added lines and only its imports", () => {
  const diff = [
    "diff --git a/src/page.ts b/src/page.ts",
    "--- a/src/page.ts",
    "+++ b/src/page.ts",
    "@@ -1,3 +1,4 @@",
    '-import { Old } from "@antelopejs/interface-dms";',
    '+import { KpiCard } from "@antelopejs/interface-dms/base";',
    "+const card = LocalHelper();",
  ].join("\n");

  const result = extractApiReferences(diff);

  assert.equal(result.mode, "diff");
  assert.deepEqual(importsOf(diff), [["@antelopejs/interface-dms/base", ["KpiCard"]]]);
  assert.deepEqual(result.references, []);
});

test("reports the line of each finding in the original text", () => {
  const answer = ["intro", `${fence}`, 'import { A1b } from "pkg";', fence, "then `Missing` here"].join("\n");

  const result = extractApiReferences(answer);

  assert.equal(result.imports[0].line, 3);
  assert.equal(result.references.find((r) => r.name === "Missing").line, 5);
});
