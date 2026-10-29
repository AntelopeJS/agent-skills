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

const RESULT_FILE = "result.json";

function readFinished(dir) {
  const file = join(dir, RESULT_FILE);
  if (!existsSync(file)) return undefined;
  const record = JSON.parse(readFileSync(file, "utf8"));
  return record.status === "error" ? undefined : record;
}

/**
 * After the agent ended, stops what its runs started through the harness's own
 * command, then lists the processes of the case that are still alive. It never
 * kills them: a leak is reported, and fails the run.
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
  });
  return {
    teardown,
    leaked: leakedProcesses([agentHome.tmp, scratch.dir]),
  };
}

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
 * Runs the cases, at most `options.jobs` at once, each in its own scratch
 * checkout and agent home. Every case writes `<out>/<id>/result.json`; with
 * `options.resume` a case whose result is already there and is not an error is
 * not run again. A case whose setup fails is recorded as an error.
 */
export async function runSeeded({ checkout, skill, cases, out, options }) {
  const results = [];
  await pool(cases, options.jobs, async (item) => {
    const caseDir = join(out, item.id);
    mkdirSync(caseDir, { recursive: true });
    const finished = options.resume ? readFinished(caseDir) : undefined;
    if (finished) return void results.push(finished);
    rmSync(join(caseDir, RESULT_FILE), { force: true });
    let outcome;
    try {
      outcome = await runOne({ item, checkout, skill, caseDir, options });
    } catch (error) {
      outcome = { error: `setup failed: ${error.message.slice(0, 400)}` };
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
