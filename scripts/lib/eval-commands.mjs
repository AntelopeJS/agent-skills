import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCases, minimumGaps } from "./cases.mjs";
import { CENTRAL_FILES, loadDataset } from "./dataset.mjs";
import { execRun, readExecutorRecords } from "./executors.mjs";
import { computeLift, formatLift } from "./lift.mjs";
import { parseModels } from "./matrix.mjs";
import { applyPassBar } from "./passbar.mjs";
import { formatEvalReport } from "./report.mjs";
import {
  DEFAULT_RUNS,
  MODES,
  listTasks,
  readManifest,
  writeRun,
} from "./requests.mjs";
import { scoreRun } from "./run-score.mjs";
import { rubricErrorsOf } from "./rubric.mjs";
import { verifyText } from "./verify.mjs";
import {
  EXIT,
  fail,
  hasCorpusOption,
  listOption,
  loadSkills,
  parseCount,
  selectCases,
} from "./eval-options.mjs";

const PLUGIN_SKILLS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "skills",
);
const DEFAULT_TIMEOUT_SECONDS = 300;
const MILLISECONDS = 1000;

function requireDir(positionals, index, what) {
  const dir = positionals[index];
  if (!dir) fail(`expected ${what}`);
  return resolve(dir);
}

function modelList(value) {
  try {
    return parseModels(value);
  } catch (error) {
    return fail(error.message);
  }
}

export function prepare(values) {
  if (!values.out) fail("prepare needs --out <dir>");
  const modes = listOption(values.modes);
  if (modes.some((mode) => !MODES.includes(mode)))
    fail(`--modes takes ${MODES.join(", ")}`);
  const skills = loadSkills(values);
  const { selected } = selectCases(values, skills);
  if (!selected.length) fail("no case matches --only/--area");
  writeRun({
    dir: resolve(values.out),
    cases: selected,
    skills,
    models: modelList(values.models),
    options: {
      modes: modes.length ? modes : MODES,
      runs: {
        ...DEFAULT_RUNS,
        answers: parseCount(values.runs, "runs", DEFAULT_RUNS.answers),
      },
      withSkills: !values["no-skills"],
    },
  });
  return EXIT.ok;
}

export async function exec(values, positionals) {
  const dir = requireDir(positionals, 1, "the run directory");
  const { failed } = await execRun({
    dir,
    models: values.models ? listOption(values.models) : undefined,
    options: {
      jobs: parseCount(values.jobs, "jobs", undefined),
      bins: {
        claude: values["claude-bin"] ?? "claude",
        codex: values["codex-bin"] ?? "codex",
      },
      timeoutMs:
        parseCount(values.timeout, "timeout", DEFAULT_TIMEOUT_SECONDS) *
        MILLISECONDS,
    },
  });
  for (const { task, error } of failed)
    process.stderr.write(
      `${task.model} ${task.mode} ${task.caseId} run ${task.run}: ${error}\n`,
    );
  return failed.length ? EXIT.failed : EXIT.ok;
}

function attentionOf(manifest) {
  const covered = new Set(listTasks(manifest).map((task) => task.caseId));
  const skipped = manifest.cases.filter((item) => !covered.has(item.id));
  return skipped.length
    ? [
        `${skipped.length} case(s) skipped, no expected skill in the corpus: ${skipped.map((item) => item.id).join(", ")}`,
      ]
    : [];
}

export async function score(values, positionals) {
  const dir = requireDir(positionals, 1, "the run directory");
  const verifyOptions = {
    project: resolve(values.project ?? process.cwd()),
    offline: Boolean(values.offline),
  };
  const verify = (answer) => verifyText(answer, verifyOptions);
  const only = new Set(listOption(values.only));
  const whole = readManifest(dir);
  const manifest = only.size
    ? { ...whole, cases: whole.cases.filter((item) => only.has(item.id)) }
    : whole;
  const scored = await scoreRun(dir, manifest, verify);
  const againstDir = values.against ? resolve(values.against) : undefined;
  const against = againstDir
    ? await scoreRun(againstDir, readManifest(againstDir), verify)
    : undefined;
  const touched = listOption(values.touched);
  const bar = applyPassBar(scored, {
    against,
    touched: touched.length ? new Set(touched) : undefined,
    newCases: new Set(listOption(values["new-cases"])),
  });
  if (values.json)
    process.stdout.write(`${JSON.stringify({ bar, scored }, null, 2)}\n`);
  else if (values.report)
    process.stdout.write(
      `${formatEvalReport({
        scored,
        bar,
        records: readExecutorRecords(dir, manifest.models),
        notes: { touched, attention: attentionOf(manifest) },
      })}\n`,
    );
  else
    for (const failure of bar.failures)
      process.stdout.write(
        `${failure.model} [${failure.rule}] ${failure.message}\n`,
      );
  return bar.passed ? EXIT.ok : EXIT.failed;
}

export async function lift(values, positionals) {
  const [withDir, withoutDir] = [1, 2].map((index) =>
    requireDir(positionals, index, "the with-skills and without-skills runs"),
  );
  const verifyOptions = {
    project: resolve(values.project ?? process.cwd()),
    offline: Boolean(values.offline),
  };
  const verify = (answer) => verifyText(answer, verifyOptions);
  const rows = computeLift(
    await scoreRun(withDir, readManifest(withDir), verify),
    await scoreRun(withoutDir, readManifest(withoutDir), verify),
  );
  process.stdout.write(
    values.json
      ? `${JSON.stringify(rows, null, 2)}\n`
      : `${formatLift(rows)}\n\nNo lift: ${
          rows
            .filter((row) => row.noLift)
            .map((row) => row.skill)
            .join(", ") || "none"
        }\n`,
  );
  return EXIT.ok;
}

export function check(values) {
  const problems = [];
  for (const file of values.cases ? [resolve(values.cases)] : CENTRAL_FILES)
    try {
      loadDataset(file);
    } catch (error) {
      problems.push(error.message);
    }
  problems.push(
    ...rubricErrorsOf(
      readdirSync(PLUGIN_SKILLS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    ),
  );
  if (hasCorpusOption(values)) {
    const skills = loadSkills(values, { defaultProject: false });
    try {
      const { cases } = loadCases({
        skills,
        centralFile: values.cases ? resolve(values.cases) : undefined,
      });
      for (const gap of minimumGaps(cases, skills))
        problems.push(`${gap.skill} lacks ${gap.missing.join("; ")}`);
    } catch (error) {
      problems.push(error.message);
    }
  }
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  return problems.length ? EXIT.failed : EXIT.ok;
}
