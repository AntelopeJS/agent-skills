import { chmodSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { readJsonFile } from "../../scripts/lib/json.mjs";
import { fieldOf } from "../../scripts/lib/safe-read.mjs";
import { isText } from "../../scripts/lib/values.mjs";
import { writeFile } from "../helpers.mjs";

/**
 * What a sleeping agent records about itself: the pids of the agent, of its
 * child and of its detached harness process, and its TMPDIR.
 * @typedef {object} AgentRecord
 * @property {number} agent
 * @property {number} child
 * @property {number} harness
 * @property {string} tmp
 */

/**
 * An executable that stands for `claude` and never answers: it starts a child
 * in its own process group, and a harness process of its own (detached, with
 * its TMPDIR on the command line, its pid in `$TMPDIR/harness.pid`), and records
 * their pids in `agents/` beside it.
 * @param {string} dir
 * @returns {string} The executable's path.
 */
export function makeSleepingAgent(dir) {
  const bin = join(dir, "sleeping-agent.mjs");
  writeFile(
    bin,
    `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const sleep = ["-e", "setTimeout(() => undefined, 60000)"];
const child = spawn(process.execPath, sleep, { stdio: "ignore" });
const harness = spawn(process.execPath, [...sleep, process.env.TMPDIR], { stdio: "ignore", detached: true });
writeFileSync(join(process.env.TMPDIR, "harness.pid"), String(harness.pid));
mkdirSync(${JSON.stringify(join(dir, "agents"))}, { recursive: true });
writeFileSync(join(${JSON.stringify(join(dir, "agents"))}, String(process.pid)), JSON.stringify({ agent: process.pid, child: child.pid, harness: harness.pid, tmp: process.env.TMPDIR }));
process.stdin.resume();
setTimeout(() => undefined, 60000);
`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

/**
 * @param {unknown} value
 * @returns {value is AgentRecord}
 */
function isAgentRecord(value) {
  return (
    typeof fieldOf(value, "agent") === "number" &&
    typeof fieldOf(value, "child") === "number" &&
    typeof fieldOf(value, "harness") === "number" &&
    isText(fieldOf(value, "tmp"))
  );
}

/**
 * Reads the record a sleeping agent wrote in `file`; it throws when the file holds anything else.
 * @param {string} file
 * @returns {AgentRecord}
 */
export function readAgentRecord(file) {
  const record = readJsonFile(file);
  if (!isAgentRecord(record)) throw new Error(`${file} holds no agent record`);
  return record;
}

/**
 * The pid records the sleeping agents wrote under `dir`.
 * @param {string} dir
 * @returns {AgentRecord[]}
 */
export function recordsOf(dir) {
  const agents = join(dir, "agents");
  return existsSync(agents)
    ? readdirSync(agents).map((name) => readAgentRecord(join(agents, name)))
    : [];
}
