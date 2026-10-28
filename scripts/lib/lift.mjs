const PERCENT = 100;

function answered(scored) {
  const byCase = new Map(scored.manifest.cases.map((item) => [item.id, item]));
  return scored.models.map(({ model, answers }) => ({
    model,
    byCase,
    results: new Map(
      answers
        .filter((answer) => !answer.runs.some((run) => run.missing))
        .map((answer) => [answer.id, answer.pass]),
    ),
  }));
}

function tally(withResults, withoutResults, byCase) {
  const bySkill = new Map();
  for (const [id, passed] of withResults) {
    if (!withoutResults.has(id)) continue;
    for (const skill of byCase.get(id).expect.skills) {
      const entry = bySkill.get(skill) ?? { now: 0, base: 0, total: 0 };
      bySkill.set(skill, {
        now: entry.now + (passed ? 1 : 0),
        base: entry.base + (withoutResults.get(id) ? 1 : 0),
        total: entry.total + 1,
      });
    }
  }
  return bySkill;
}

/**
 * The baseline lift of decision 5: per skill and model, the share of its
 * answers cases that pass with the skills loaded against with none loaded.
 * Cases missing an answer in either run are left out, and a skill left with
 * no case on a model has no entry for it. A skill has no lift when its mean
 * lift over the models that ran is not above zero.
 */
export function computeLift(withSkills, withoutSkills) {
  const before = answered(withoutSkills);
  const rows = new Map();
  answered(withSkills).forEach(({ model, byCase, results }, index) => {
    const bySkill = tally(results, before[index].results, byCase);
    for (const [skill, count] of bySkill) {
      rows.set(skill, [
        ...(rows.get(skill) ?? []),
        {
          model: model.id,
          withScore: count.now / count.total,
          withoutScore: count.base / count.total,
          lift: (count.now - count.base) / count.total,
          cases: count.total,
        },
      ]);
    }
  });
  return [...rows]
    .map(([skill, models]) => {
      const meanLift =
        models.reduce((sum, item) => sum + item.lift, 0) / models.length;
      return { skill, models, meanLift, noLift: meanLift <= 0 };
    })
    .sort((left, right) => left.skill.localeCompare(right.skill));
}

const pct = (value) => `${Math.round(value * PERCENT)}%`;
const signed = (value) =>
  `${value > 0 ? "+" : ""}${Math.round(value * PERCENT)}`;

/**
 * One Markdown table: skill, per-model cases / with / without / lift, mean
 * lift. A model with no case run for a skill reads "not run".
 */
export function formatLift(rows, modelIds) {
  const ids = modelIds ?? [
    ...new Set(rows.flatMap((row) => row.models.map((item) => item.model))),
  ];
  const header = [
    "Skill",
    ...ids.map((id) => `${id} (cases: with / without / lift)`),
    "Mean lift",
  ];
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [
    line(header),
    line(header.map(() => "---")),
    ...rows.map((row) =>
      line([
        row.skill,
        ...ids.map((id) => {
          const item = row.models.find((entry) => entry.model === id);
          return item
            ? `${item.cases}: ${pct(item.withScore)} / ${pct(item.withoutScore)} / ${signed(item.lift)}`
            : "not run";
        }),
        `${signed(row.meanLift)}${row.noLift ? " (no lift)" : ""}`,
      ]),
    ),
  ].join("\n");
}
