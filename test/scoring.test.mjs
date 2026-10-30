import { test } from "node:test";
import assert from "node:assert/strict";

import { scoreCase, summarize, formatTable } from "../scripts/lib/scoring.mjs";

const CORPUS = new Set(["dms-pages", "dms-best-practices", "dms", "dms-auth"]);

function evalCase(skills, acceptable = []) {
  return {
    id: "c",
    prompt: "p",
    style: "clean",
    area: "dms",
    expect: { skills, acceptable },
  };
}

void test("perfect prediction scores 1/1", () => {
  const score = scoreCase(
    evalCase(["dms-pages", "dms-best-practices"]),
    ["dms-pages", "dms-best-practices"],
    CORPUS,
  );

  assert.equal(score.precision, 1);
  assert.equal(score.recall, 1);
});

void test("acceptable skills do not cost precision but do not count toward recall", () => {
  const score = scoreCase(
    evalCase(["dms-pages", "dms-best-practices"], ["dms"]),
    ["dms-pages", "dms"],
    CORPUS,
  );

  assert.equal(score.precision, 1);
  assert.equal(score.recall, 0.5);
});

void test("an unrelated or invented skill costs precision", () => {
  const score = scoreCase(
    evalCase(["dms-pages"]),
    ["dms-pages", "dms-auth", "made-up"],
    CORPUS,
  );

  assert.equal(score.precision, 1 / 3);
  assert.deepEqual(score.extra, ["dms-auth", "made-up"]);
});

void test("expected skills absent from the corpus are left out; a case with none left is skipped", () => {
  const partial = scoreCase(
    evalCase(["dms-pages", "dms-mailing"]),
    ["dms-pages"],
    CORPUS,
  );
  const skipped = scoreCase(evalCase(["dms-mailing"]), [], CORPUS);

  assert.equal(partial.recall, 1);
  assert.deepEqual(partial.absent, ["dms-mailing"]);
  assert.equal(skipped.skipped, true);
});

void test("the summary averages scored cases only and checks the thresholds", () => {
  const scores = [
    scoreCase(evalCase(["dms-pages"]), ["dms-pages"], CORPUS),
    scoreCase(evalCase(["dms-auth"]), ["dms"], CORPUS),
    scoreCase(evalCase(["dms-mailing"]), [], CORPUS),
  ];

  const summary = summarize(scores, { minRecall: 0.6, minPrecision: 0 });

  assert.equal(summary.scored, 2);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.recall, 0.5);
  assert.equal(summary.passed, false);
});

void test("the table lists every case and the overall line", () => {
  const scores = [
    scoreCase(
      { ...evalCase(["dms-pages"]), id: "orders-table" },
      ["dms-pages"],
      CORPUS,
    ),
  ];

  const table = formatTable(scores, summarize(scores, {}));

  assert.match(table, /orders-table/);
  assert.match(table, /overall/i);
});
