import { chmodSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { writeFile } from "../helpers.mjs";
import { readJson } from "./read.mjs";

/**
 * An executable that stands for `claude` and never answers: it starts a child
 * in its own process group, and a harness process of its own (detached, with
 * its TMPDIR on the command line, its pid in `$TMPDIR/harness.pid`), and records
 * their pids in `agents/` beside it.
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

/** The pid records the sleeping agents wrote under `dir`. */
export function recordsOf(dir) {
  const agents = join(dir, "agents");
  return existsSync(agents)
    ? readdirSync(agents).map((name) => readJson(join(agents, name)))
    : [];
}
