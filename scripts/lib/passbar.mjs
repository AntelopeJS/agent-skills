import { floorTolerance } from "./matrix.mjs";
import { summarize } from "./scoring.mjs";

export const FLOORS = { recall: 0.8, precision: 0.7 };
export const MAX_CORPUS_DROP = 0.02;
const EPSILON = 1e-9;

function allowedOf(evalCase) {
  return new Set([
    ...evalCase.expect.skills,
    ...(evalCase.expect.acceptable ?? []),
  ]);
}

function ratio(part, whole) {
  return whole === 0 ? undefined : part / whole;
}

/**
 * Per skill: recall over the cases that expect it, precision over the cases
 * where the model picked it, and the invented API names in its answers cases.
 */
export function skillStats(result, cases) {
  const byId = new Map(cases.map((item) => [item.id, item]));
  const scored = result.trigger.filter((item) => !item.skipped && !item.error);
  const names = new Set([
    ...scored.flatMap((item) => [...item.expected, ...item.predicted]),
    ...result.answers.flatMap((item) => byId.get(item.id)?.expect.skills ?? []),
  ]);
  return Object.fromEntries(
    [...names]
      .sort((left, right) => left.localeCompare(right))
      .map((name) => {
        const expected = scored.filter((item) => item.expected.includes(name));
        const picked = scored.filter((item) => item.predicted.includes(name));
        const correct = picked.filter(
          (item) =>
            item.expected.includes(name) ||
            allowedOf(byId.get(item.id)).has(name),
        );
        const invented = result.answers
          .filter((item) => byId.get(item.id)?.expect.skills.includes(name))
          .flatMap((item) => item.runs)
          .reduce((sum, run) => sum + (run.invented ?? 0), 0);
        return [
          name,
          {
            recall: ratio(
              expected.filter((item) => item.predicted.includes(name)).length,
              expected.length,
            ),
            precision: ratio(correct.length, picked.length),
            expectedCases: expected.length,
            pickedCases: picked.length,
            invented,
          },
        ];
      }),
  );
}

function missingFailures(result) {
  const model = result.model.id;
  const absent = [
    ...result.trigger.filter((item) => item.error === "no answer file"),
    ...result.answers.filter((item) => item.runs.some((run) => run.missing)),
  ];
  const broken = result.trigger.filter(
    (item) => item.error && item.error !== "no answer file",
  );
  return [
    ...(absent.length
      ? [
          {
            rule: "missing-answer",
            model,
            message: `${absent.length} case(s) have no answer file: ${absent.map((item) => item.id).join(", ")}`,
          },
        ]
      : []),
    ...broken.map((item) => ({
      rule: "bad-reply",
      model,
      id: item.id,
      message: `trigger reply not readable: ${item.error}`,
    })),
  ];
}

function passes(result) {
  return new Map([
    ...result.trigger.map((item) => [`trigger:${item.id}`, item]),
    ...result.answers.map((item) => [`answers:${item.id}`, item]),
  ]);
}

function regressionFailures(current, against) {
  const before = passes(against);
  return [...passes(current)]
    .filter(([key, item]) => before.get(key)?.pass && !item.pass)
    .map(([key]) => ({
      rule: "regression",
      model: current.model.id,
      id: key.split(":")[1],
      message: `${key} passed on main and fails now`,
    }));
}

function newCaseFailures(current, newCases) {
  return [...passes(current)]
    .filter(
      ([key, item]) =>
        newCases.has(key.split(":")[1]) && !item.pass && !item.skipped,
    )
    .map(([key]) => ({
      rule: "new-case",
      model: current.model.id,
      id: key.split(":")[1],
      message: `new case ${key} fails`,
    }));
}

function floorFailures(model, stats, touched) {
  const tolerance = floorTolerance(model);
  const minRecall = FLOORS.recall - tolerance;
  const minPrecision = FLOORS.precision - tolerance;
  return Object.entries(stats)
    .filter(([name]) => !touched || touched.has(name))
    .flatMap(([skill, stat]) =>
      [
        ...(stat.recall !== undefined && stat.recall + EPSILON < minRecall
          ? [
              `recall ${stat.recall.toFixed(2)} is under ${minRecall.toFixed(1)}`,
            ]
          : []),
        ...(stat.precision !== undefined &&
        stat.precision + EPSILON < minPrecision
          ? [
              `precision ${stat.precision.toFixed(2)} is under ${minPrecision.toFixed(1)}`,
            ]
          : []),
        ...(stat.invented > 0
          ? [`${stat.invented} invented API name(s) in its answers`]
          : []),
      ].map((message) => ({
        rule: message.includes("invented") ? "invented" : "floor",
        model: model.id,
        skill,
        message: `${skill}: ${message}`,
      })),
    );
}

function commonSummary(result, ids) {
  const scores = result.trigger.filter((item) => ids.has(item.id));
  return summarize(scores);
}

function corpusFailures(current, against) {
  const ids = new Set(against.trigger.map((item) => item.id));
  const now = commonSummary(current, ids);
  const before = commonSummary(against, ids);
  return ["recall", "precision"]
    .filter(
      (metric) => before[metric] - now[metric] > MAX_CORPUS_DROP + EPSILON,
    )
    .map((metric) => ({
      rule: "corpus-drop",
      model: current.model.id,
      message: `full-corpus ${metric} fell from ${before[metric].toFixed(2)} to ${now[metric].toFixed(2)}`,
    }));
}

/**
 * Applies the pass bar of decisions 19 to 21 and 23 to a scored run:
 * no regression against `main`'s run, every new case passing on every model,
 * the per-skill floors and invented-name rule for the touched skills, and at
 * most a 2-point drop of the full-corpus means.
 */
export function applyPassBar(current, options = {}) {
  const { against, touched, newCases = new Set() } = options;
  const comparable = (model) =>
    against?.models.find((item) => item.model.id === model.model.id);
  const perModel = current.models.map((result) => ({
    model: result.model,
    skills: skillStats(result, current.manifest.cases),
  }));
  const failures = current.models.flatMap((result, index) => {
    const before = comparable(result);
    return [
      ...missingFailures(result),
      ...(before ? regressionFailures(result, before) : []),
      ...(before ? corpusFailures(result, before) : []),
      ...newCaseFailures(result, newCases),
      ...floorFailures(result.model, perModel[index].skills, touched),
    ];
  });
  return { failures, perModel, passed: failures.length === 0 };
}
