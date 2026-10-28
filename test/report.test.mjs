import { test } from "node:test";
import assert from "node:assert/strict";

import { computeLift, formatLift } from "../scripts/lib/lift.mjs";
import { applyPassBar } from "../scripts/lib/passbar.mjs";
import { formatEvalReport } from "../scripts/lib/report.mjs";
import { MATRIX } from "../scripts/lib/matrix.mjs";

const [OPUS, SONNET] = MATRIX;

function run(model, passes, { withSkills = true } = {}) {
  return {
    manifest: {
      withSkills,
      createdAt: "2026-10-28T00:00:00.000Z",
      runs: { trigger: 1, answers: 2 },
      corpus: [{ name: "dms-pages" }, { name: "dms-mailing" }],
      cases: [
        { id: "pages", expect: { skills: ["dms-pages"] } },
        { id: "mail", expect: { skills: ["dms-mailing"] } },
      ],
    },
    models: [
      {
        model,
        trigger: [],
        answers: [
          {
            id: "pages",
            pass: passes[0],
            runs: [
              {
                run: 1,
                pass: passes[0],
                invented: passes[0] ? 0 : 1,
                checked: 3,
                unknown: passes[0] ? [] : ["Ghost"],
                missingMentions: [],
                forbiddenMentions: [],
                behaviourOk: true,
                answer: "line one\nline two",
              },
            ],
          },
          {
            id: "mail",
            pass: passes[1],
            runs: [{ run: 1, pass: passes[1], invented: 0, checked: 1 }],
          },
        ],
      },
    ],
  };
}

test("the Eval report states the verdict, the executors and quotes each failing answer with its reason", () => {
  const scored = run(OPUS, [false, true]);
  const bar = applyPassBar(scored, { touched: new Set(["dms-pages"]) });

  const report = formatEvalReport({
    scored,
    bar,
    records: {
      [OPUS.id]: { observedModels: ["claude-opus-5-5"], cli: "2.1.312" },
    },
  });

  assert.match(report, /\*\*Verdict: FAIL\*\* \(1 failure\(s\)\)/);
  assert.match(
    report,
    /\| claude-opus-5-5-low \| claude \| claude-opus-5-5 \| low \| 2.1.312 \|/,
  );
  assert.match(report, /\[invented\] dms-pages: 1 invented API name/);
  assert.match(
    report,
    /\*\*claude-opus-5-5-low\*\* pages \(run 1\): unknown names: Ghost/,
  );
  assert.match(report, /~~~~\nline one\nline two\n~~~~/);
});

test("a baseline run says so in the Attention section", () => {
  const scored = run(OPUS, [true, true], { withSkills: false });

  const report = formatEvalReport({ scored, bar: applyPassBar(scored, {}) });

  assert.match(report, /\*\*Verdict: PASS\*\*/);
  assert.match(report, /Run without any skill loaded: a baseline, not a gate/);
});

test("lift is with minus without per skill and model, and a skill that helps nowhere has none", () => {
  const withSkills = {
    ...run(OPUS, [true, false]),
    models: [
      ...run(OPUS, [true, false]).models,
      ...run(SONNET, [true, false]).models,
    ],
  };
  const without = {
    ...run(OPUS, [false, false], { withSkills: false }),
    models: [
      ...run(OPUS, [false, false]).models,
      ...run(SONNET, [true, false]).models,
    ],
  };

  const rows = computeLift(withSkills, without);

  assert.deepEqual(
    rows.map((row) => [row.skill, row.meanLift, row.noLift]),
    [
      ["dms-mailing", 0, true],
      ["dms-pages", 0.5, false],
    ],
  );
  assert.match(
    formatLift(rows),
    /\| dms-pages \| 1 \| 100% \/ 0% \/ \+100 \| 100% \/ 100% \/ 0 \| \+50 \|/,
  );
});
