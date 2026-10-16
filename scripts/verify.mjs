#!/usr/bin/env node
// Checks the API names an answer or a diff uses against what the installed
// packages export, and reports the unknown ones (invented APIs).
//
//   verify [file|-] [--project <dir>] [--offline] [--json]
//
// Reads stdin when the file is `-` or omitted. Exits 1 when an unknown name is
// found. Answers (Markdown) are checked on their imports, code and inline
// code; unified diffs on the imports of their added lines.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { verifyText, formatReport } from "./lib/verify.mjs";

const EXIT = { ok: 0, unknown: 1, usage: 2 };
const STDIN = "-";
const OPTIONS = {
  project: { type: "string" },
  offline: { type: "boolean" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};
const USAGE = `Usage: verify [file|-] [--project <dir>] [--offline] [--json]

  file           a Markdown answer or a unified diff (default: stdin)
  --project      where the packages are installed (default: cwd)
  --offline      never fetch interface packages from npm
  --json         machine-readable report
`;

async function main() {
  const { values, positionals } = parseArgs({ options: OPTIONS, allowPositionals: true });
  if (values.help || positionals.length > 1) {
    process.stdout.write(USAGE);
    return values.help ? EXIT.ok : EXIT.usage;
  }
  const file = positionals[0] ?? STDIN;
  const text = readFileSync(file === STDIN ? process.stdin.fd : resolve(file), "utf8");
  const report = await verifyText(text, { project: resolve(values.project ?? process.cwd()), offline: Boolean(values.offline) });
  process.stdout.write(`${values.json ? JSON.stringify(report, null, 2) : formatReport(report)}\n`);
  return report.findings.length ? EXIT.unknown : EXIT.ok;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`error: ${error.message}\n`);
    process.exit(EXIT.usage);
  },
);
