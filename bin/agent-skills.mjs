#!/usr/bin/env node
// Entry point for running the scripts without a plugin, e.g.
// `npx -y github:AntelopeJS/agent-skills sync`.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
);
const FAILURE_EXIT_CODE = 1;
const COMMANDS = {
  sync: {
    script: "sync-skills.mjs",
    args: [],
    help: "link package-shipped skills into .claude/skills and .agents/skills",
  },
  list: {
    script: "sync-skills.mjs",
    args: ["--list"],
    help: "list package-shipped skills and their sync status",
  },
  interface: {
    script: "resolve-interface.mjs",
    args: [],
    help: "look up an interface contract (list, show, contract, versions…)",
  },
  verify: {
    script: "verify.mjs",
    args: [],
    help: "report API names an answer or diff uses that no installed package exports",
  },
  evals: {
    script: "evals.mjs",
    args: [],
    help: "score which skills a prompt triggers and the answers they produce (trigger, answers, prepare, exec, score, lift, check)",
  },
};

function printUsage() {
  const lines = Object.entries(COMMANDS).map(
    ([name, { help }]) => `  ${name.padEnd(10)} ${help}`,
  );
  process.stdout.write(
    `Usage: agent-skills <command> [options]\n\nCommands:\n${lines.join("\n")}\n\n`,
  );
  process.stdout.write(
    "sync and list accept --target claude|codex|all (default: all), --dry-run and --json.\n",
  );
  process.stdout.write("verify and evals accept --help.\n");
}

const [name, ...rest] = process.argv.slice(2);
const command = Object.hasOwn(COMMANDS, name ?? "") ? COMMANDS[name] : null;
if (!command) {
  printUsage();
  process.exit(name ? FAILURE_EXIT_CODE : 0);
}

const child = spawnSync(
  process.execPath,
  [join(SCRIPTS_DIR, command.script), ...command.args, ...rest],
  { stdio: "inherit" },
);
process.exit(child.status ?? FAILURE_EXIT_CODE);
