const PERCENT = 100;

function passRates(scored) {
  const byCase = new Map(scored.manifest.cases.map((item) => [item.id, item]));
  return scored.models.map(({ model, answers }) => {
    const bySkill = new Map();
    for (const answer of answers)
      for (const skill of byCase.get(answer.id).expect.skills) {
        const entry = bySkill.get(skill) ?? { passed: 0, total: 0 };
        bySkill.set(skill, {
          passed: entry.passed + (answer.pass ? 1 : 0),
          total: entry.total + 1,
        });
      }
    return { model, bySkill };
  });
}

function rate({ passed, total }) {
  return passed / total;
}

/**
 * The baseline lift of decision 5: per skill and model, the share of its
 * answers cases that pass with the skills loaded against with none loaded.
 * A skill has no lift when its mean lift over the models is not above zero.
 */
export function computeLift(withSkills, withoutSkills) {
  const before = passRates(withoutSkills);
  const rows = new Map();
  passRates(withSkills).forEach(({ model, bySkill }, index) => {
    for (const [skill, now] of bySkill) {
      const base = before[index].bySkill.get(skill);
      if (!base) continue;
      rows.set(skill, [
        ...(rows.get(skill) ?? []),
        {
          model: model.id,
          withScore: rate(now),
          withoutScore: rate(base),
          lift: rate(now) - rate(base),
          cases: now.total,
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

/** One Markdown table: skill, cases, per-model with / without / lift, mean lift. */
export function formatLift(rows) {
  const ids = rows[0]?.models.map((item) => item.model) ?? [];
  const header = [
    "Skill",
    "Cases",
    ...ids.map((id) => `${id} (with / without / lift)`),
    "Mean lift",
  ];
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [
    line(header),
    line(header.map(() => "---")),
    ...rows.map((row) =>
      line([
        row.skill,
        row.models[0].cases,
        ...row.models.map(
          (item) =>
            `${pct(item.withScore)} / ${pct(item.withoutScore)} / ${signed(item.lift)}`,
        ),
        `${signed(row.meanLift)}${row.noLift ? " (no lift)" : ""}`,
      ]),
    ),
  ].join("\n");
}
