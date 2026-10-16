import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { verifyText } from "../scripts/lib/verify.mjs";
import { makeTempDir, removeDir, writeFile, writeJson } from "./helpers.mjs";

const fence = "```";
let project;
let interfacesDir;

function writePackage(base, name, manifest, files) {
  const dir = join(base, "node_modules", ...name.split("/"));
  writeJson(join(dir, "package.json"), { name, version: "1.0.0", ...manifest });
  for (const [path, content] of Object.entries(files)) writeFile(join(dir, path), content);
}

before(() => {
  project = makeTempDir();
  writeJson(join(project, "package.json"), { name: "app" });
  writePackage(
    project,
    "@antelopejs/interface-dms",
    {
      exports: {
        ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
        "./base": { types: "./dist/base/index.d.ts", default: "./dist/base/index.js" },
        "./package.json": "./package.json",
      },
    },
    {
      "dist/index.d.ts": "export declare function RegisterPage(): ClassDecorator;\nexport { PageController as Controller } from './page';\n",
      "dist/page.d.ts": "export declare abstract class PageController {}\n",
      "dist/base/index.d.ts": "export * from './kpi-card';\nexport * from './table-view';\nexport * as Charts from './chart';\n",
      "dist/base/kpi-card.d.ts": "/** export declare function NotReal(): void; */\nexport declare function KpiCard(): void;\n",
      "dist/base/table-view/index.d.ts": "export {\n  TableView,\n  type TableViewOptions,\n} from './factory';\n",
      "dist/base/chart.d.ts": "export declare const ChartCard: unknown;\n",
    },
  );
  writePackage(project, "@antelopejs/legacy", { types: "lib/main.d.ts" }, { "lib/main.d.ts": "export interface LegacyThing {}\n" });
  writePackage(project, "untyped-lib", { main: "index.js" }, { "index.js": "module.exports = {};\n" });

  interfacesDir = makeTempDir();
  const contract = join(interfacesDir, "interface-dms-mailing");
  writeJson(join(contract, "package.json"), {
    name: "@antelopejs/interface-dms-mailing",
    version: "0.7.0",
    exports: { ".": { types: "./dist/index.d.ts" } },
  });
  writeFile(join(contract, "dist", "index.d.ts"), "export declare function SendTemplate(): Promise<void>;\n");
});

after(() => {
  removeDir(project);
  removeDir(interfacesDir);
});

function verify(text) {
  return verifyText(text, { project, offline: true, env: { ...process.env, AJS_INTERFACES_DIR: interfacesDir } });
}

function unknownNames(report) {
  return report.findings.map((finding) => finding.name).sort();
}

test("accepts names exported through export *, aliases and directory indexes", async () => {
  const report = await verify(
    `${fence}ts\nimport { KpiCard, TableView, Charts } from "@antelopejs/interface-dms/base";\nimport { RegisterPage, Controller } from "@antelopejs/interface-dms";\n${fence}`,
  );

  assert.deepEqual(report.findings, []);
  assert.equal(report.checked, 7);
});

test("reports a name the module does not export, ignoring commented-out declarations", async () => {
  const report = await verify(`${fence}\nimport { NotReal, KpiCards } from "@antelopejs/interface-dms/base";\n${fence}`);

  assert.deepEqual(unknownNames(report), ["KpiCards", "NotReal"]);
  assert.equal(report.findings[0].kind, "import");
  assert.equal(report.findings[0].line, 2);
});

test("reports a subpath the package does not export", async () => {
  const report = await verify(`${fence}\nimport { KpiCard } from "@antelopejs/interface-dms/blocks";\n${fence}`);

  assert.deepEqual(report.findings.map((f) => [f.kind, f.name]), [["subpath", "@antelopejs/interface-dms/blocks"]]);
});

test("reads packages without an exports map from their types field", async () => {
  const report = await verify(`${fence}\nimport { LegacyThing, Nope } from "@antelopejs/legacy";\n${fence}`);

  assert.deepEqual(unknownNames(report), ["Nope"]);
});

test("checks node built-ins against their runtime exports", async () => {
  const report = await verify(`${fence}\nimport { readFileSync, readEverything } from "node:fs";\n${fence}`);

  assert.deepEqual(unknownNames(report), ["readEverything"]);
});

test("flags a missing AntelopeJS package and leaves other missing or untyped packages unchecked", async () => {
  const report = await verify(
    `${fence}\nconst { DatabaseService } = require("@antelopejs/core");\nimport { x } from "lodash";\nimport { y } from "untyped-lib";\n${fence}`,
  );

  assert.deepEqual(report.findings.map((f) => [f.kind, f.name]), [["package", "@antelopejs/core"]]);
  assert.deepEqual(report.unchecked.map((u) => u.specifier).sort(), ["lodash", "untyped-lib"]);
});

test("falls back to the interface resolver for an interface package that is not installed", async () => {
  const report = await verify(`${fence}\nimport { SendTemplate, SendMail } from "@antelopejs/interface-dms-mailing";\n${fence}`);

  assert.deepEqual(unknownNames(report), ["SendMail"]);
  assert.equal(report.packages.find((p) => p.specifier === "@antelopejs/interface-dms-mailing").source, "resolver");
});

test("checks unimported API names of an answer against every installed AntelopeJS package", async () => {
  const report = await verify("Wrap it in `KpiCard` and call `DatabaseService.find()`.");

  assert.deepEqual(unknownNames(report), ["DatabaseService"]);
  assert.equal(report.findings[0].kind, "reference");
});

test("counts the invented rate over every checked name", async () => {
  const report = await verify("`KpiCard`, `TableView`, `DatabaseService` and `RegisterPage`.");

  assert.equal(report.checked, 4);
  assert.equal(report.inventedRate, 0.25);
});

test("names reachable only through a `*` exports pattern count as known", async () => {
  const dir = join(project, "node_modules", "@antelopejs", "interface-wild");
  writeJson(join(dir, "package.json"), {
    name: "@antelopejs/interface-wild",
    exports: { ".": { types: "./dist/index.d.ts" }, "./*": { types: "./dist/*.d.ts" } },
  });
  writeFile(join(dir, "dist", "index.d.ts"), "export {};\n");
  writeFile(join(dir, "dist", "base", "custom.d.ts"), "export declare function CustomBlock(name: string): void;\n");

  const imported = await verify(`${fence}\nimport { CustomBlock } from "@antelopejs/interface-wild/base/custom";\n${fence}`);
  const referenced = await verify("Declare it with `CustomBlock`.");

  assert.deepEqual(imported.findings, []);
  assert.deepEqual(referenced.findings, []);
});

test("survives export * cycles between declaration files", async () => {
  const dir = join(project, "node_modules", "@antelopejs", "interface-cycle");
  writeJson(join(dir, "package.json"), { name: "@antelopejs/interface-cycle", types: "a.d.ts" });
  writeFile(join(dir, "a.d.ts"), "export * from './b';\nexport declare const A1: number;\n");
  writeFile(join(dir, "b.d.ts"), "export * from './a';\nexport declare const B1: number;\n");

  const report = await verify(`${fence}\nimport { A1, B1, C1 } from "@antelopejs/interface-cycle";\n${fence}`);

  assert.deepEqual(unknownNames(report), ["C1"]);
});
