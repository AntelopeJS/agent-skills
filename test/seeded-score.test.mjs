import { test } from "node:test";
import assert from "node:assert/strict";

import {
  excuseControlGaps,
  judgeCase,
  summarizeSeeded,
} from "../scripts/lib/seeded-score.mjs";

const BREAK = { kind: "break", subject: "alpha" };
const DOOR = { kind: "door", subject: "data" };
const CONTROL = { kind: "control", subject: "head" };
const verdict = (result, failedFeatures = [], doors = [], notRun = []) => ({
  verdict: { result, failedFeatures, notRun, doors, summary: "" },
});

void test("a break is caught only by a FAIL that names its feature", () => {
  assert.equal(judgeCase(BREAK, verdict("FAIL", ["alpha"])).passed, true);
  assert.equal(
    judgeCase(BREAK, verdict("FAIL", ["Alpha", "smoke"])).passed,
    true,
  );
  assert.equal(judgeCase(BREAK, verdict("FAIL", ["smoke"])).passed, false);
  assert.equal(judgeCase(BREAK, verdict("FAIL", [])).passed, false);
  assert.equal(judgeCase(BREAK, verdict("PASS", ["alpha"])).passed, false);
  assert.equal(
    judgeCase(BREAK, verdict("PASS+NOTES", ["alpha"])).passed,
    false,
  );
});

void test("a FAIL for a feature whose journeys did not run is not a catch", () => {
  const blocked = judgeCase(
    BREAK,
    verdict("FAIL", ["alpha"], [], ["alpha/start", "smoke/smoke"]),
  );

  assert.equal(blocked.passed, false);
  assert.match(blocked.why, /alpha\/start/);
  assert.equal(
    judgeCase(BREAK, verdict("FAIL", ["alpha"], [], ["beta/other"])).passed,
    true,
  );
  assert.equal(
    judgeCase(BREAK, verdict("FAIL", ["alpha"], [], ["alpha"])).passed,
    false,
  );
});

void test("a door is caught by naming its kind, whatever the result", () => {
  assert.equal(
    judgeCase(DOOR, verdict("PASS+NOTES", [], ["data"])).passed,
    true,
  );
  assert.equal(judgeCase(DOOR, verdict("FAIL", ["x"], ["data"])).passed, true);
  assert.equal(
    judgeCase(DOOR, verdict("FAIL", ["data"], ["format"])).passed,
    false,
  );
  assert.equal(judgeCase(DOOR, verdict("PASS", [], [])).passed, false);
});

void test("the unpatched head passes unless the verdict is FAIL", () => {
  assert.equal(judgeCase(CONTROL, verdict("PASS")).passed, true);
  assert.equal(judgeCase(CONTROL, verdict("PASS+NOTES")).passed, true);
  const alarm = judgeCase(CONTROL, verdict("FAIL", ["smoke"]));
  assert.equal(alarm.passed, false);
  assert.match(alarm.why, /false alarm/);
});

void test("a case with no verdict is an error and counts as missed on every kind", () => {
  for (const item of [BREAK, DOOR, CONTROL]) {
    const result = judgeCase(item, { error: "timed out after 5 s" });
    assert.deepEqual(
      [result.passed, result.status, result.why],
      [false, "error", "timed out after 5 s"],
    );
  }
});

function resultsOf(entries) {
  return entries.map(([kind, id, passed, subject, status = "wrong"]) => ({
    kind,
    id,
    passed,
    subject,
    status,
  }));
}

void test("the gates fail on one missed break, one missed door or a false alarm", () => {
  const allCaught = resultsOf([
    ["break", "break-a", true],
    ["break", "break-b", true],
    ["door", "door-data", true],
    ["control", "control", true],
  ]);
  const gates = { minCatch: 1, minDoorCatch: 1 };

  assert.equal(summarizeSeeded(allCaught, gates).passed, true);
  const missedBreak = summarizeSeeded(
    resultsOf([
      ["break", "break-a", true],
      ["break", "break-b", false],
    ]),
    gates,
  );
  assert.equal(missedBreak.breaks.rate, 0.5);
  assert.match(missedBreak.failures[0], /break-b/);
  assert.equal(
    summarizeSeeded(resultsOf([["door", "door-data", false]]), gates).passed,
    false,
  );
  assert.equal(
    summarizeSeeded(resultsOf([["control", "control", false]]), gates).passed,
    false,
  );
});

void test("a false alarm on the unpatched head fails the run even when every break and door is caught", () => {
  const falseAlarm = resultsOf([
    ["break", "break-a", true],
    ["door", "door-data", true],
    ["control", "control", false],
  ]);
  const gated = summarizeSeeded(falseAlarm, { minCatch: 1, minDoorCatch: 1 });

  assert.equal(gated.breaks.rate, 1);
  assert.equal(gated.doors.rate, 1);
  assert.equal(gated.passed, false);
  assert.deepEqual(gated.failures, [
    "the unpatched head returned FAIL or no verdict",
  ]);
  assert.equal(summarizeSeeded(falseAlarm).passed, false);
  assert.equal(
    summarizeSeeded(resultsOf([["control", "control", false]])).passed,
    false,
  );
});

void test("a touched head gates only under --min-clean", () => {
  const results = resultsOf([
    ["touched", "touched-a", true],
    ["touched", "touched-b", false],
  ]);

  assert.equal(summarizeSeeded(results).passed, true);
  assert.equal(summarizeSeeded(results).touched.rate, 0.5);
  const gated = summarizeSeeded(results, { minClean: 1 });
  assert.equal(gated.passed, false);
  assert.match(gated.failures[0], /touched-b/);
});

void test("a break whose touched twin also FAILs is reported as not separated from the head", () => {
  const summary = summarizeSeeded(
    resultsOf([
      ["break", "break-a", true, "a"],
      ["touched", "touched-a", true, "a"],
      ["break", "break-b", true, "b"],
      ["touched", "touched-b", false, "b"],
      ["break", "break-c", true, "c"],
      ["break", "break-d", true, "d"],
      ["touched", "touched-d", false, "d", "error"],
    ]),
  );

  assert.deepEqual(summary.separated.indistinct, ["break-b"]);
  assert.equal(summary.separated.total, 1);
  assert.equal(summary.separated.rate, 1);
  assert.equal(summary.breaks.rate, 1);
});

void test("without a gate a missed break reports its rate and does not fail the run", () => {
  const summary = summarizeSeeded(resultsOf([["break", "break-a", false]]));

  assert.equal(summary.breaks.rate, 0);
  assert.equal(summary.passed, true);
});

void test("a gate on a run that held no break fails instead of passing on zero cases", () => {
  assert.equal(
    summarizeSeeded(resultsOf([["control", "control", true]]), { minCatch: 1 })
      .passed,
    false,
  );
});

void test("an interrupted case is listed, fails the run and does not count as a miss in the rates", () => {
  const caught = {
    id: "break-alpha",
    kind: "break",
    subject: "alpha",
    ...judgeCase(BREAK, verdict("FAIL", ["alpha"])),
  };
  const stopped = {
    id: "break-beta",
    kind: "break",
    subject: "beta",
    ...judgeCase(
      { kind: "break", subject: "beta" },
      { interrupted: true, error: "interrupted" },
    ),
  };

  const summary = summarizeSeeded([caught, stopped], { minCatch: 1 });

  assert.equal(stopped.status, "interrupted");
  assert.equal(summary.breaks.rate, 1);
  assert.deepEqual(summary.interrupted, ["break-beta"]);
  assert.equal(summary.passed, false);
  assert.match(summary.failures.join("\n"), /interrupted: 1 case\(s\)/);
});

const caseOf = (kind, id, subject, value) => ({
  kind,
  id,
  subject,
  ...judgeCase({ kind, subject }, { verdict: value }),
  verdict: value,
});
const full = (result, failedFeatures, notRun, passed) => ({
  result,
  failedFeatures,
  notRun,
  passed,
  doors: [],
  summary: "",
});

void test("a break whose only unrun journey never passes on the unpatched head is caught", () => {
  const results = [
    caseOf(
      "break",
      "break-smoke",
      "smoke",
      full("FAIL", ["smoke"], ["smoke/sandbox"], ["smoke/create"]),
    ),
    caseOf(
      "control",
      "control",
      "head",
      full("PASS+NOTES", [], ["smoke/sandbox"], ["smoke/create"]),
    ),
  ];

  assert.equal(results[0].passed, false);
  const scored = excuseControlGaps(results);
  assert.equal(scored[0].passed, true);
  assert.match(scored[0].why, /smoke\/sandbox/);
  assert.equal(summarizeSeeded(scored, { minCatch: 1 }).passed, true);
});

void test("a break whose unrun journey passes on the unpatched head stays missed", () => {
  const results = [
    caseOf(
      "break",
      "break-smoke",
      "smoke",
      full("FAIL", ["smoke"], ["smoke/sandbox"], ["smoke/create"]),
    ),
    caseOf(
      "control",
      "control",
      "head",
      full("PASS", [], [], ["smoke/create", "smoke/sandbox"]),
    ),
  ];

  const scored = excuseControlGaps(results);
  assert.equal(scored[0].passed, false);
  assert.equal(summarizeSeeded(scored, { minCatch: 1 }).passed, false);
});

void test("a break with no unpatched run of its feature keeps the strict judgement", () => {
  const results = [
    caseOf(
      "break",
      "break-alpha",
      "alpha",
      full("FAIL", ["alpha"], ["alpha/slow"], []),
    ),
    caseOf(
      "control",
      "control",
      "head",
      full("PASS+NOTES", [], [], ["smoke/create"]),
    ),
  ];

  assert.equal(excuseControlGaps(results)[0].passed, false);
});

void test("the touched twin is the unpatched run of a feature the control does not cover", () => {
  const results = [
    caseOf(
      "break",
      "break-alpha",
      "alpha",
      full("FAIL", ["alpha"], ["alpha/sandbox"], ["alpha/create"]),
    ),
    caseOf(
      "control",
      "control",
      "head",
      full("PASS+NOTES", [], [], ["smoke/create"]),
    ),
    caseOf(
      "touched",
      "touched-alpha",
      "alpha",
      full("PASS+NOTES", [], ["alpha/sandbox"], ["alpha/create"]),
    ),
  ];

  assert.equal(excuseControlGaps(results)[0].passed, true);
});

const smokeBreak = (notRun) =>
  caseOf("break", "break-smoke", "smoke", full("FAIL", ["smoke"], notRun, []));
const smokeControl = (notRun, passed) =>
  caseOf("control", "control", "head", full("PASS+NOTES", [], notRun, passed));

void test("a journey the unpatched head does not list as unrun is not excused", () => {
  const scored = excuseControlGaps([
    smokeBreak(["smoke/sandbox"]),
    smokeControl([], ["smoke/create"]),
  ]);

  assert.equal(scored[0].passed, false);
});

void test("a bare feature entry is never excused", () => {
  const scored = excuseControlGaps([
    smokeBreak(["smoke"]),
    smokeControl(["smoke"], ["smoke/create"]),
  ]);

  assert.equal(scored[0].passed, false);
});

void test("a touched twin that FAILs is no baseline", () => {
  const scored = excuseControlGaps([
    caseOf(
      "break",
      "break-alpha",
      "alpha",
      full("FAIL", ["alpha"], ["alpha/sandbox"], []),
    ),
    smokeControl([], ["smoke/create"]),
    caseOf(
      "touched",
      "touched-alpha",
      "alpha",
      full("FAIL", ["alpha"], ["alpha/sandbox"], ["alpha/create"]),
    ),
  ]);

  assert.equal(scored[0].passed, false);
});

void test("a control written before `passed` existed gives no baseline and does not throw", () => {
  const legacy = {
    kind: "control",
    id: "control",
    subject: "head",
    passed: true,
    status: "ok",
    verdict: {
      result: "PASS+NOTES",
      failedFeatures: [],
      notRun: ["smoke/sandbox"],
      doors: [],
      summary: "",
    },
  };

  const scored = excuseControlGaps([smokeBreak(["smoke/sandbox"]), legacy]);
  assert.equal(scored[0].passed, false);
});

void test("journey names match case-insensitively and another feature's prefix never matches", () => {
  assert.equal(
    excuseControlGaps([
      smokeBreak(["Smoke/Sandbox"]),
      smokeControl(["smoke/sandbox"], ["smoke/create"]),
    ])[0].passed,
    true,
  );
  assert.equal(
    excuseControlGaps([
      smokeBreak(["smoke/sandbox"]),
      smokeControl(["smoke-x/sandbox"], ["smoke-x/create"]),
    ])[0].passed,
    false,
  );
});

void test("a break whose FAIL does not name its feature is never excused", () => {
  const results = [
    caseOf(
      "break",
      "break-smoke",
      "smoke",
      full("FAIL", ["other"], ["smoke/sandbox"], []),
    ),
    caseOf(
      "control",
      "control",
      "head",
      full("PASS+NOTES", [], [], ["smoke/create"]),
    ),
  ];

  assert.equal(excuseControlGaps(results)[0].passed, false);
});
