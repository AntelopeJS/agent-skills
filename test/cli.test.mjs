import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { makeTempDir, removeDir, writeFile, writeJson } from "./helpers.mjs";

const BIN = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "bin",
  "agent-skills.mjs",
);
const fence = "```";
let root;

function run(args, { input, env = {} } = {}) {
  const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ...clean } = process.env;
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: root,
    input,
    encoding: "utf8",
    env: { ...clean, ...env },
  });
}

before(() => {
  root = makeTempDir();
  writeJson(join(root, "package.json"), { name: "app" });
  const pkg = join(root, "node_modules", "@antelopejs", "interface-dms");
  writeJson(join(pkg, "package.json"), {
    name: "@antelopejs/interface-dms",
    exports: { ".": { types: "./index.d.ts" } },
  });
  writeFile(
    join(pkg, "index.d.ts"),
    "export declare function KpiCard(): void;\n",
  );
  writeFile(
    join(root, "skills", "dms-pages", "SKILL.md"),
    "---\nname: dms-pages\ndescription: Builds admin pages with tables and KPI cards.\n---\nUse `KpiCard`.\n",
  );
  writeFile(
    join(root, "skills", "dms-mailing", "SKILL.md"),
    "---\nname: dms-mailing\ndescription: Sends email templates.\n---\nBody.\n",
  );
  writeJson(join(root, "cases.json"), {
    version: 1,
    cases: [
      {
        id: "kpi",
        area: "dms",
        style: "clean",
        prompt: "Add KPI cards to the admin page",
        expect: { skills: ["dms-pages"] },
      },
      {
        id: "mail",
        area: "modules",
        style: "casual",
        prompt: "send the welcome email template",
        expect: { skills: ["dms-mailing"] },
      },
      {
        id: "orders",
        area: "dms",
        style: "clean",
        prompt: "orders please",
        expect: { skills: ["dms-pages"], mustMention: ["KpiCard"] },
      },
    ],
  });
  writeFile(
    join(root, "stub-backend.mjs"),
    [
      "export async function complete({ schema, user }) {",
      "  if (schema) return JSON.stringify({ skills: user.includes('email') ? ['dms-mailing'] : ['dms-pages'] });",
      "  return 'Use `KpiCard` and `KpiCards`.';",
      "}",
    ].join("\n"),
  );
});

after(() => {
  removeDir(root);
});

test("the bin lists the verify and evals commands", () => {
  const result = run([]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /verify/);
  assert.match(result.stdout, /evals/);
});

test("verify reads stdin and exits 1 on an unknown name", () => {
  const result = run(["verify", "-"], {
    input: `${fence}\nimport { KpiCard, KpiRow } from "@antelopejs/interface-dms";\n${fence}\n`,
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /KpiRow/);
});

test("verify reads a file, exits 0 when every name exists, and speaks JSON", () => {
  writeFile(join(root, "answer.md"), "Use `KpiCard`.\n");

  const result = run(["verify", "answer.md", "--json", "--offline"]);

  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).checked, 1);
});

const CORPUS = ["--skills", "skills", "--cases", "cases.json"];

test("evals runs the baseline by default and prints the table", () => {
  const result = run(["evals", ...CORPUS]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Backend: baseline/);
  assert.match(result.stdout, /overall/);
});

test("evals exits 1 under the recall threshold", () => {
  const result = run(["evals", ...CORPUS, "--min-recall", "1"]);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Below threshold/);
});

test("the anthropic backend is skipped cleanly without a key", () => {
  const result = run(["evals", "trigger", ...CORPUS, "--backend", "anthropic"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /ANTHROPIC_API_KEY is not set/);
});

test("dry-run prints the model prompt with names and descriptions only", () => {
  const result = run([
    "evals",
    ...CORPUS,
    "--backend",
    "anthropic",
    "--dry-run",
  ]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /- dms-pages: Builds admin pages/);
  assert.doesNotMatch(result.stdout, /Use `KpiCard`/);
});

test("a backend module plugs into the trigger eval", () => {
  const result = run([
    "evals",
    ...CORPUS,
    "--backend",
    "stub-backend.mjs",
    "--json",
  ]);
  const report = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(report.summary.recall, 1);
});

test("the answers eval verifies each answer and fails over the invented threshold", () => {
  const args = [
    "evals",
    "answers",
    ...CORPUS,
    "--only",
    "orders",
    "--backend",
    "stub-backend.mjs",
    "--offline",
  ];

  const lenient = run(args);
  const strict = run([...args, "--max-invented", "0"]);

  assert.equal(lenient.status, 0);
  assert.match(lenient.stdout, /1\/2 invented/);
  assert.equal(strict.status, 1);
});

test("evals refuses an unknown mode", () => {
  assert.equal(run(["evals", "nonsense", ...CORPUS]).status, 2);
});

function rubricDir() {
  return join(root, "prepared");
}

test("prepare writes requests, exec fills them, score reports and exits 1 on a failed bar", () => {
  const prepared = run([
    "evals",
    "prepare",
    ...CORPUS,
    "--out",
    rubricDir(),
    "--models",
    "claude-opus-5-5-low",
  ]);
  const stub = join(root, "claude-stub.sh");
  writeFile(
    stub,
    [
      "#!/bin/sh",
      'if echo "$@" | grep -q json-schema; then',
      '  echo \'{"result":"{\\"skills\\":[\\"dms-pages\\"]}","modelUsage":{"claude-opus-5-5":{}}}\'',
      "else",
      '  cat "$0.answers"',
      "fi",
    ].join("\n"),
  );
  writeJson(`${stub}.answers`, {
    result:
      'Use `KpiCard`:\n```ts\nimport { KpiCard, KpiRow } from "@antelopejs/interface-dms";\n```',
    modelUsage: { "claude-opus-5-5": {} },
  });
  chmodSync(stub, 0o755);

  const exec = run(["evals", "exec", rubricDir(), "--claude-bin", stub]);
  const score = run([
    "evals",
    "score",
    rubricDir(),
    "--offline",
    "--project",
    root,
    "--report",
  ]);

  assert.equal(prepared.status, 0);
  assert.equal(prepared.stdout, "");
  assert.equal(exec.status, 0, exec.stderr);
  assert.equal(score.status, 1);
  assert.match(score.stdout, /Verdict: FAIL/);
  assert.match(score.stdout, /unknown names: KpiRow/);
});

test("check passes the committed case files and fails a skill below the minimum", () => {
  const schemaOnly = run(["evals", "check", "--cases", "cases.json"]);
  const minimum = run([
    "evals",
    "check",
    "--cases",
    "cases.json",
    "--skills",
    "skills",
  ]);

  assert.equal(schemaOnly.status, 0, schemaOnly.stderr);
  assert.equal(minimum.status, 1);
  assert.match(minimum.stderr, /dms-pages lacks a casual should-trigger case/);
});

test("score --only limits the report to the named cases", () => {
  const score = run([
    "evals",
    "score",
    rubricDir(),
    "--offline",
    "--project",
    root,
    "--only",
    "kpi",
    "--json",
  ]);

  const { scored } = JSON.parse(score.stdout);

  assert.deepEqual(
    scored.manifest.cases.map((item) => item.id),
    ["kpi"],
  );
});
