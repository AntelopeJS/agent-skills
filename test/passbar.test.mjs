import { test } from "node:test";
import assert from "node:assert/strict";

import { MATRIX } from "../scripts/lib/matrix.mjs";
import { applyPassBar } from "../scripts/lib/passbar.mjs";
import { caseOf } from "./helpers.mjs";

/** @typedef {import("../scripts/lib/dataset.mjs").EvalCase} EvalCase */
/** @typedef {import("../scripts/lib/matrix.mjs").MatrixEntry} MatrixEntry */
/** @typedef {import("../scripts/lib/requests.mjs").Manifest} Manifest */
/** @typedef {import("../scripts/lib/run-score.mjs").AnswerCaseResult} AnswerCaseResult */
/** @typedef {import("../scripts/lib/run-score.mjs").ScoredRun} ScoredRun */
/** @typedef {import("../scripts/lib/run-score.mjs").TriggerResult} TriggerResult */

const [OPUS, SONNET] = MATRIX;

/**
 * @param {string} id
 * @param {{ expected: string[], predicted: string[], allowed?: string[] }} picks
 * @returns {TriggerResult}
 */
function trigger(id, { expected, predicted, allowed = expected }) {
  const missed = expected.filter((name) => !predicted.includes(name));
  const extra = predicted.filter((name) => !allowed.includes(name));
  return {
    id,
    style: "clean",
    area: "dms",
    skipped: false,
    expected,
    predicted,
    absent: [],
    missed,
    extra,
    avoided: [],
    recall: (expected.length - missed.length) / expected.length,
    precision: predicted.length
      ? (predicted.length - extra.length) / predicted.length
      : 1,
    pass: !missed.length,
  };
}

/**
 * @param {string} id
 * @param {number} [invented]
 * @returns {AnswerCaseResult}
 */
function answer(id, invented = 0) {
  const runs = [1, 2].map((run) => ({
    run,
    missing: false,
    invented,
    checked: 4,
    pass: invented === 0,
  }));
  return { id, runs, pass: invented === 0 };
}

/**
 * @param {EvalCase[]} cases
 * @returns {Manifest}
 */
function manifestOf(cases) {
  return {
    version: 1,
    createdAt: "2026-10-28T00:00:00.000Z",
    withSkills: true,
    modes: ["trigger", "answers"],
    runs: { trigger: 1, answers: 2 },
    models: [OPUS],
    corpus: [],
    cases,
  };
}

/**
 * @param {MatrixEntry} model
 * @param {EvalCase[]} cases
 * @param {{ trigger?: TriggerResult[], answers?: AnswerCaseResult[] }} results
 * @returns {ScoredRun}
 */
function scored(model, cases, results) {
  return {
    manifest: manifestOf(cases),
    models: [
      { model, trigger: results.trigger ?? [], answers: results.answers ?? [] },
    ],
  };
}

const PAGES = caseOf("pages", ["dms-pages"]);

void test("a case that passed on main and fails now is a regression on that model only", () => {
  const before = scored(OPUS, [PAGES], {
    trigger: [
      trigger("pages", { expected: ["dms-pages"], predicted: ["dms-pages"] }),
    ],
  });
  const now = scored(OPUS, [PAGES], {
    trigger: [
      trigger("pages", { expected: ["dms-pages"], predicted: ["dms"] }),
    ],
  });

  const bar = applyPassBar(now, { against: before, touched: new Set() });

  assert.deepEqual(
    bar.failures.map((failure) => [failure.rule, failure.id]),
    [
      ["regression", "pages"],
      ["corpus-drop", undefined],
      ["corpus-drop", undefined],
    ],
  );
});

void test("a case that already failed on main is not a regression", () => {
  const failing = scored(OPUS, [PAGES], {
    trigger: [trigger("pages", { expected: ["dms-pages"], predicted: [] })],
  });

  const bar = applyPassBar(failing, { against: failing, touched: new Set() });

  assert.deepEqual(bar.failures, []);
});

void test("every new case must pass, trigger and answers", () => {
  const now = scored(OPUS, [PAGES], {
    trigger: [trigger("pages", { expected: ["dms-pages"], predicted: [] })],
    answers: [answer("pages", 1)],
  });

  const bar = applyPassBar(now, {
    touched: new Set(),
    newCases: new Set(["pages"]),
  });

  assert.deepEqual(
    bar.failures.map((failure) => failure.rule),
    ["new-case", "new-case"],
  );
});

void test("the trigger floors are 0.8 and 0.7, with 0.1 less for Sonnet only", () => {
  const cases = ["a", "b", "c", "d", "e"].map((id) =>
    caseOf(id, ["dms-pages"]),
  );
  /** @param {number} hits */
  const picks = (hits) =>
    cases.map(({ id }, index) =>
      trigger(id, {
        expected: ["dms-pages"],
        predicted: index < hits ? ["dms-pages"] : [],
      }),
    );

  /** @param {MatrixEntry} model */
  const fourOfFive = (model) =>
    applyPassBar(scored(model, cases, { trigger: picks(4) }), {}).failures;
  /** @param {MatrixEntry} model */
  const threeOfFive = (model) =>
    applyPassBar(scored(model, cases, { trigger: picks(3) }), {}).failures;

  assert.deepEqual(fourOfFive(OPUS), []);
  assert.equal(threeOfFive(OPUS).length, 1);
  assert.equal(threeOfFive(SONNET).length, 1);
  assert.match(threeOfFive(SONNET)[0].message, /recall 0.60 is under 0.7/);
  const sevenOfTen = Array.from({ length: 10 }, (_, index) =>
    caseOf(`c${index}`, ["dms-pages"]),
  );
  const result = scored(SONNET, sevenOfTen, {
    trigger: sevenOfTen.map(({ id }, index) =>
      trigger(id, {
        expected: ["dms-pages"],
        predicted: index < 7 ? ["dms-pages"] : [],
      }),
    ),
  });
  assert.deepEqual(applyPassBar(result, {}).failures, []);
});

void test("an extra pick outside the allowed skills lowers that skill's precision", () => {
  const cases = [caseOf("a", ["dms-pages"]), caseOf("b", ["dms-mailing"])];
  const now = scored(OPUS, cases, {
    trigger: [
      trigger("a", { expected: ["dms-pages"], predicted: ["dms-pages"] }),
      trigger("b", {
        expected: ["dms-mailing"],
        predicted: ["dms-mailing", "dms-pages"],
      }),
    ],
  });

  const bar = applyPassBar(now, { touched: new Set(["dms-pages"]) });

  assert.deepEqual(
    bar.failures.map((failure) => failure.message),
    ["dms-pages: precision 0.50 is under 0.7"],
  );
});

void test("one invented API name in a touched skill's answers fails, and an untouched skill's does not", () => {
  const now = scored(OPUS, [PAGES], { answers: [answer("pages", 1)] });

  assert.equal(
    applyPassBar(now, { touched: new Set(["dms-pages"]) }).failures[0].rule,
    "invented",
  );
  assert.deepEqual(
    applyPassBar(now, { touched: new Set(["dms-mailing"]) }).failures,
    [],
  );
});

void test("a task with no answer file fails the run instead of passing silently", () => {
  const now = scored(OPUS, [PAGES], {
    trigger: [
      {
        ...trigger("pages", { expected: ["dms-pages"], predicted: [] }),
        error: "no answer file",
      },
    ],
  });

  const bar = applyPassBar(now, { touched: new Set() });

  assert.equal(bar.failures[0].rule, "missing-answer");
});

void test("the full-corpus means may fall by 2 points, not more", () => {
  const ids = Array.from({ length: 50 }, (_, index) => `c${index}`);
  const cases = ids.map((id) => caseOf(id, ["dms-pages"]));
  /** @param {number} hits */
  const run = (hits) =>
    scored(OPUS, cases, {
      trigger: ids.map((id, index) =>
        trigger(id, {
          expected: ["dms-pages"],
          predicted: index < hits ? ["dms-pages"] : [],
        }),
      ),
    });

  /** @param {number} hits */
  const lose = (hits) =>
    applyPassBar(run(hits), {
      against: run(50),
      touched: new Set(),
    }).failures.filter((failure) => failure.rule === "corpus-drop");

  assert.equal(lose(50).length, 0);
  assert.equal(lose(49).length, 0);
  assert.equal(lose(48).length, 1);
});
