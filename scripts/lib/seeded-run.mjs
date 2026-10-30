import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { pool } from "./executors.mjs";
import {
  agentEnv,
  createAgentHome,
  removeAgentHome,
  runAgent,
} from "./seeded-agent.mjs";
import { createScratch, removeScratch } from "./seeded-scratch.mjs";
import { judgeCase } from "./seeded-score.mjs";
import { leakedProcesses, runTeardown } from "./seeded-teardown.mjs";

/** @typedef {import("./executors.mjs").SpawnRunner} SpawnRunner */
/** @typedef {import("./seeded-agent.mjs").AgentHome} AgentHome */
/** @typedef {import("./seeded-agent.mjs").AgentOutcome} AgentOutcome */
/** @typedef {import("./seeded-cases.mjs").SeededCase} SeededCase */
/** @typedef {import("./seeded-score.mjs").CaseOutcome} CaseOutcome */
/** @typedef {import("./seeded-score.mjs").CaseResult} CaseResult */
/** @typedef {import("./seeded-scratch.mjs").Scratch} Scratch */
/** @typedef {import("./seeded-teardown.mjs").LeakedProcess} LeakedProcess */
/** @typedef {import("./seeded-teardown.mjs").TeardownOutcome} TeardownOutcome */

/**
 * How the cases run.
 * @typedef {object} SeededOptions
 * @property {number} jobs Cases at once.
 * @property {string} model
 * @property {string} effort
 * @property {number} maxBudget
 * @property {number} timeoutSeconds
 * @property {string} claudeBin
 * @property {string | null} setup The command run in each scratch checkout, or nothing to skip it.
 * @property {NodeJS.ProcessEnv} setupEnv
 * @property {string} scratchRoot
 * @property {string[]} passEnv
 * @property {boolean} [keepScratch]
 * @property {boolean} [resume]
 * @property {string} [cacheHome]
 * @property {string} [ref]
 * @property {string} [teardown] The stop command run after each case.
 * @property {SpawnRunner} [run] Runs the agent; `spawnRun` when absent.
 * @property {SpawnRunner} [teardownRun] Runs the stop command; `spawnRun` when absent.
 * @property {AbortSignal} [signal] Aborts on the first interrupt.
 * @property {AbortSignal} [forceSignal] Aborts on the second interrupt.
 */

/**
 * What stopping a case's runs found.
 * @typedef {object} RunsStopped
 * @property {TeardownOutcome} teardown
 * @property {LeakedProcess[]} leaked
 */

/**
 * What a case came to: a run that was cut short or failed to start, or the agent's outcome with the commits and what its stop command found.
 * @typedef {CaseOutcome | (AgentOutcome & RunsStopped & { baseSha: string, headSha: string })} CaseRun
 */

const RESULT_FILE = "result.json";

/**
 * @param {string} dir
 * @returns {CaseResult | undefined}
 */
function readFinished(dir) {
  const file = join(dir, RESULT_FILE);
  if (!existsSync(file)) return undefined;
  const record = JSON.parse(readFileSync(file, "utf8"));
  return record.status === "error" || record.status === "interrupted"
    ? undefined
    : record;
}

/**
 * After the agent ended (or was killed by an interrupt), stops what its runs
 * started through the harness's own command, then lists the processes of the
 * case that are still alive. It never kills them: a leak is reported, and fails
 * the run.
 * @param {{ options: SeededOptions, scratch: Scratch, agentHome: AgentHome }} stopped
 * @returns {Promise<RunsStopped>}
 */
async function stopRuns({ options, scratch, agentHome }) {
  const teardown = await runTeardown({
    command: options.teardown,
    cwd: scratch.dir,
    env: agentEnv({
      agentHome,
      passEnv: options.passEnv,
      cacheHome: options.cacheHome,
    }),
    runs: agentHome.tmp,
    run: options.teardownRun,
    signal: options.forceSignal,
  });
  return {
    teardown,
    leaked: leakedProcesses([agentHome.tmp, scratch.dir]),
  };
}

/**
 * @param {{ item: SeededCase, checkout: string, skill: string, caseDir: string, options: SeededOptions }} request
 * @returns {Promise<CaseRun>}
 */
async function runOne({ item, checkout, skill, caseDir, options }) {
  const scratch = createScratch({
    checkout,
    skill,
    patch: item.patch,
    touch: item.touch,
    ref: options.ref,
    root: options.scratchRoot,
    setup: options.setup,
    env: options.setupEnv,
  });
  const agentHome = createAgentHome({ root: options.scratchRoot });
  try {
    if (options.signal?.aborted)
      return {
        interrupted: true,
        error: "interrupted before the agent started",
      };
    const outcome = await runAgent({
      scratch,
      skill,
      agentHome,
      model: options.model,
      effort: options.effort,
      maxBudget: options.maxBudget,
      timeoutSeconds: options.timeoutSeconds,
      claudeBin: options.claudeBin,
      passEnv: options.passEnv,
      cacheHome: options.cacheHome,
      run: options.run,
      signal: options.signal,
    });
    writeFileSync(join(caseDir, "prompt.txt"), `${outcome.prompt}\n`);
    return {
      ...outcome,
      baseSha: scratch.baseSha,
      headSha: scratch.headSha,
      ...(await stopRuns({ options, scratch, agentHome })),
    };
  } finally {
    if (options.keepScratch)
      writeFileSync(join(caseDir, "scratch.txt"), `${scratch.dir}\n`);
    else removeScratch(scratch);
    removeAgentHome(agentHome);
  }
}

/**
 * @param {unknown} error
 * @param {SeededOptions} options
 * @returns {CaseOutcome}
 */
function failedSetup(error, options) {
  const message = error instanceof Error ? error.message : String(error);
  return options.signal?.aborted
    ? { interrupted: true, error: "interrupted during setup" }
    : { error: `setup failed: ${message.slice(0, 400)}` };
}

/**
 * Runs the cases, at most `options.jobs` at once, each in its own scratch
 * checkout and agent home. Every case writes `<out>/<id>/result.json`; with
 * `options.resume` a case whose result is already there and is not an error or
 * interrupted is not run again. A case whose setup fails is recorded as an
 * error. When `options.signal` aborts, the live agents are killed with their
 * process groups, each of those cases still runs its stop command and removes
 * its folders, the cases not started are skipped, and every one of them is
 * recorded as interrupted. `options.forceSignal` aborting also kills the stop
 * commands.
 * @param {{ checkout: string, skill: string, cases: SeededCase[], out: string, options: SeededOptions }} request
 * @returns {Promise<CaseResult[]>}
 */
export async function runSeeded({ checkout, skill, cases, out, options }) {
  /** @type {CaseResult[]} */
  const results = [];
  await pool(cases, options.jobs, async (item) => {
    const caseDir = join(out, item.id);
    mkdirSync(caseDir, { recursive: true });
    const finished = options.resume ? readFinished(caseDir) : undefined;
    if (finished) return void results.push(finished);
    rmSync(join(caseDir, RESULT_FILE), { force: true });
    /** @type {CaseRun} */
    let outcome;
    try {
      outcome = options.signal?.aborted
        ? { interrupted: true, error: "interrupted before it started" }
        : await runOne({ item, checkout, skill, caseDir, options });
    } catch (error) {
      outcome = failedSetup(error, options);
    }
    const record = {
      id: item.id,
      kind: item.kind,
      subject: item.subject,
      ...judgeCase(item, outcome),
      ...outcome,
      prompt: undefined,
      at: new Date().toISOString(),
    };
    writeFileSync(
      join(caseDir, RESULT_FILE),
      `${JSON.stringify(record, null, 2)}\n`,
    );
    results.push(record);
  });
  return results.sort((left, right) => left.id.localeCompare(right.id));
}
