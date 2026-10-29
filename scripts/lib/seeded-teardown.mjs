import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { spawnRun } from "./executors.mjs";

const TEARDOWN_TIMEOUT_MS = 180_000;
const TAIL = 400;

/**
 * How each known harness stops what a run started, by recorded PID. `$SEEDED_RUNS`
 * is the case's private temporary folder, where the harness keeps its runs.
 */
export const TEARDOWNS = {
  "verify-dms":
    'for run in "$SEEDED_RUNS"/dms-control/*; do [ -d "$run" ] && node packages/dms/bin/dms-control.mjs down "$run"; done; true',
  "verify-antelopejs":
    'for run in "$SEEDED_RUNS"/verify-antelopejs/*; do [ -d "$run" ] && node .agents/skills/verify-antelopejs/bin/verify-ajs.mts clean "$run"; done; true',
};

/**
 * Runs the harness's own stop command for every run the case left under its
 * private temporary folder. Never throws; the outcome says whether it ran and,
 * when it failed, the tail of its error. `signal` aborting kills the stop
 * command's process group.
 */
export async function runTeardown({
  command,
  cwd,
  env,
  runs,
  timeoutMs = TEARDOWN_TIMEOUT_MS,
  run = spawnRun,
  signal,
}) {
  if (!command) return { ran: false };
  try {
    await run({
      command: "sh",
      args: ["-c", command],
      input: "",
      env: { ...env, SEEDED_RUNS: runs },
      cwd,
      timeoutMs,
      group: true,
      signal,
    });
    return { ran: true };
  } catch (error) {
    return { ran: true, error: String(error.message).slice(-TAIL) };
  }
}

/**
 * The processes still alive whose command line mentions one of `roots`: what the case started and the harness did not stop. Reads
 * `/proc`; returns nothing where it does not exist.
 */
export function leakedProcesses(roots, procRoot = "/proc") {
  let entries;
  try {
    entries = readdirSync(procRoot).filter((name) => /^\d+$/.test(name));
  } catch {
    return [];
  }
  const mine = new Set([String(process.pid), String(process.ppid)]);
  return entries
    .filter((pid) => !mine.has(pid))
    .flatMap((pid) => {
      try {
        const cmdline = readFileSync(join(procRoot, pid, "cmdline"), "utf8");
        return roots.some((root) => cmdline.includes(root))
          ? [
              {
                pid: Number(pid),
                cmdline: cmdline.replaceAll("\0", " ").slice(0, TAIL),
              },
            ]
          : [];
      } catch {
        return [];
      }
    });
}
