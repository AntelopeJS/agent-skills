const PERCENT = 100;
const MAX_QUOTED_ANSWERS = 10;
const MAX_QUOTED_LINES = 14;
const FENCE = "~~~~";

const pct = (value) =>
  value === undefined ? "-" : `${Math.round(value * PERCENT)}%`;

function table(header, rows) {
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join(
    "\n",
  );
}

function mean(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : undefined;
}

function modelRow(result) {
  const scored = result.trigger.filter((item) => !item.skipped);
  const answered = result.answers;
  const invented = answered
    .flatMap((item) => item.runs)
    .reduce((sum, run) => sum + (run.invented ?? 0), 0);
  const checked = answered
    .flatMap((item) => item.runs)
    .reduce((sum, run) => sum + (run.checked ?? 0), 0);
  const unverified = answered
    .flatMap((item) => item.runs)
    .reduce((sum, run) => sum + (run.unverified?.length ?? 0), 0);
  return [
    result.model.id,
    pct(mean(scored.map((item) => item.recall))),
    pct(mean(scored.map((item) => item.precision))),
    `${scored.filter((item) => item.pass).length}/${scored.length}`,
    `${answered.filter((item) => item.pass).length}/${answered.length}`,
    `${invented}/${checked}`,
    String(unverified),
  ];
}

function executorRows(scored, records) {
  return scored.models.map(({ model }) => {
    const record = records[model.id] ?? {};
    const observed = record.observedModels?.length
      ? record.observedModels.join(", ")
      : (model.model ?? "CLI default");
    return [
      model.id,
      model.executor,
      observed,
      model.effort ?? "CLI default",
      record.cli ?? "not recorded",
    ];
  });
}

function skillRows(bar, touched = []) {
  const names = [
    ...new Set(bar.perModel.flatMap(({ skills }) => Object.keys(skills))),
  ]
    .filter((name) => !touched.length || touched.includes(name))
    .sort((left, right) => left.localeCompare(right));
  return names.map((name) => [
    name,
    ...bar.perModel.map(({ skills }) => {
      const stat = skills[name];
      return stat
        ? `R ${pct(stat.recall)} / P ${pct(stat.precision)} / inv ${stat.invented}`
        : "-";
    }),
  ]);
}

function failingTriggers(scored) {
  return scored.models.flatMap(({ model, trigger }) =>
    trigger
      .filter((item) => !item.skipped && !item.pass)
      .map(
        (item) =>
          `- \`${model.id}\` ${item.id}: expected ${item.expected.join(", ")}; picked ${item.predicted.join(", ") || "(none)"}${item.avoided?.length ? `; picked ${item.avoided.join(", ")}, which the case avoids` : ""}${item.error ? ` (${item.error})` : ""}`,
      ),
  );
}

function quoteAnswer(model, item, run) {
  const reasons = [
    run.unknown?.length ? `unknown names: ${run.unknown.join(", ")}` : "",
    run.missingMentions?.length
      ? `missing: ${run.missingMentions.join(", ")}`
      : "",
    run.forbiddenMentions?.length
      ? `forbidden: ${run.forbiddenMentions.join(", ")}`
      : "",
    run.behaviourOk === false ? "did not ask first" : "",
    run.missing ? "no answer file" : "",
  ].filter(Boolean);
  const lines = (run.answer ?? "").trim().split("\n");
  const shown = lines.slice(0, MAX_QUOTED_LINES).join("\n");
  return [
    `**${model.id}** ${item.id} (run ${run.run}): ${reasons.join("; ")}`,
    "",
    FENCE,
    shown + (lines.length > MAX_QUOTED_LINES ? "\n..." : ""),
    FENCE,
  ].join("\n");
}

function failingAnswers(scored) {
  const quotes = scored.models.flatMap(({ model, answers }) =>
    answers.flatMap((item) =>
      item.runs
        .filter((run) => !run.pass)
        .map((run) => quoteAnswer(model, item, run)),
    ),
  );
  const extra = quotes.length - MAX_QUOTED_ANSWERS;
  return [
    ...quotes.slice(0, MAX_QUOTED_ANSWERS),
    ...(extra > 0 ? [`...and ${extra} more failing answer(s).`] : []),
  ];
}

function section(title, body) {
  return body.length ? [`### ${title}`, "", ...body, ""] : [];
}

/**
 * Renders the Eval report: verdict, corpus, executors, per-model scores, the
 * per-skill figures behind the floors, the failures and the failing answers
 * quoted.
 */
export function formatEvalReport({ scored, bar, records = {}, notes = {} }) {
  const { manifest } = scored;
  const triggerCount = new Set(
    scored.models.flatMap(({ trigger }) => trigger.map((item) => item.id)),
  ).size;
  const answerCount = new Set(
    scored.models.flatMap(({ answers }) => answers.map((item) => item.id)),
  ).size;
  const attention = [
    ...(notes.attention ?? []),
    ...(manifest.withSkills
      ? []
      : ["Run without any skill loaded: a baseline, not a gate."]),
  ].map((line) => `- ${line}`);
  return [
    "## Eval report",
    "",
    `**Verdict: ${bar.passed ? "PASS" : "FAIL"}**${bar.passed ? "" : ` (${bar.failures.length} failure(s))`}`,
    "",
    `- Variant: ${manifest.withSkills ? "with the skills of the corpus" : "without any skill"}`,
    `- Corpus: ${manifest.corpus.length} skills; cases: ${manifest.cases.length} (${triggerCount} trigger, ${answerCount} answers; answers runs: ${manifest.runs.answers})`,
    `- Touched skills: ${notes.touched?.length ? notes.touched.join(", ") : "all"}`,
    `- Judge: none, every check is deterministic (names verified against the packages' .d.ts files)`,
    `- Prepared: ${manifest.createdAt}`,
    "",
    ...section("Executors", [
      table(
        ["Model id", "Executor", "Model", "Effort", "CLI"],
        executorRows(scored, records),
      ),
    ]),
    ...section("Scores", [
      table(
        [
          "Model",
          "Trigger recall",
          "Trigger precision",
          "Trigger cases passed",
          "Answers cases passed",
          "Invented / checked names",
          "Unverified names",
        ],
        scored.models.map(modelRow),
      ),
    ]),
    ...section("Skills", [
      table(
        ["Skill", ...scored.models.map(({ model }) => model.id)],
        skillRows(bar, notes.touched),
      ),
    ]),
    ...section(
      "Pass bar failures",
      bar.failures.map(
        (failure) =>
          `- \`${failure.model}\` [${failure.rule}] ${failure.message}`,
      ),
    ),
    ...section("Failing trigger cases", failingTriggers(scored)),
    ...section("Failing answers", failingAnswers(scored)),
    ...section("Attention", attention),
  ]
    .join("\n")
    .trimEnd();
}
