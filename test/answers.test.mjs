import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkAnswer,
  runAnswerEval,
  summarizeAnswers,
} from "../scripts/lib/answers.mjs";

/** @typedef {import("../scripts/lib/dataset.mjs").EvalCase} EvalCase */
/** @typedef {import("../scripts/lib/model.mjs").ModelBackend} ModelBackend */
/** @typedef {import("../scripts/lib/model.mjs").ModelRequest} ModelRequest */

const fence = "```";
/** @type {EvalCase} */
const CASE = {
  id: "kanban-board",
  area: "dms",
  style: "clean",
  prompt: "Add a kanban board.",
  expect: {
    skills: ["dms-best-practices"],
    mustMention: ["CustomComponent"],
    mustNotMention: ["KanbanBoard"],
    behaviour: "asks-first",
  },
};

void test("mentions, forbidden names and the asks-first behaviour are checked on the answer text", () => {
  const good = checkAnswer(
    CASE,
    "There is no kanban block. Build it as a `CustomComponent`, or keep a TableView?\n",
  );
  const bad = checkAnswer(
    CASE,
    `${fence}ts\nKanbanBoard()\n${fence}\nShall I go on?`,
  );

  assert.deepEqual(good, {
    missingMentions: [],
    forbiddenMentions: [],
    behaviourOk: true,
  });
  assert.deepEqual(bad, {
    missingMentions: ["CustomComponent"],
    forbiddenMentions: ["KanbanBoard"],
    behaviourOk: false,
  });
});

void test("asks-first accepts a closed choice as a table or numbered options and rejects a build without one", () => {
  const behaviour = (/** @type {string} */ answer) =>
    checkAnswer(CASE, `CustomComponent ${answer}`).behaviourOk;
  const table =
    "Which layout do you want?\n\n| Option | Result |\n| --- | --- |\n| A | TableView |\n| B | Kanban |\n";
  const tableNoMark =
    "Pick one:\n\n| Option | Result |\n| --- | --- |\n| A | TableView |\n";
  const numbered = "Choose one:\n1. TableView\n2. CustomComponent\n";
  const steps = "Steps:\n1. Create the page\n2. Add the block\n";

  assert.equal(behaviour(table), true);
  assert.equal(behaviour(tableNoMark), true);
  assert.equal(behaviour(numbered), true);
  assert.equal(behaviour(steps), false);
  assert.equal(behaviour(`${numbered}${fence}ts\nx\n${fence}`), true);
  assert.equal(behaviour(`${fence}ts\nx\n${fence}\n${numbered}`), false);
});

void test("asks-first reads the cue in the line that introduces the options, not in the steps or the closing prose", () => {
  const behaviour = (/** @type {string} */ answer) =>
    checkAnswer(CASE, answer).behaviourOk;
  const build =
    "I'll build the customers page now:\n1. Create the page\n2. Add a TableView block\nLet me know if you want changes.\n";
  const plan =
    "Here is the plan:\n1. Select the TableView block\n2. Add the columns\n";

  assert.equal(behaviour(`${build}${fence}ts\nx\n${fence}`), false);
  assert.equal(behaviour(`${plan}${fence}ts\nx\n${fence}`), false);
  assert.equal(
    behaviour("Two ways, pick one:\n- A TableView page\n- A CustomComponent\n"),
    true,
  );
  assert.equal(
    behaviour("Pick one:\n**A.** A TableView page\n**B.** A CustomComponent\n"),
    true,
  );
  assert.equal(
    behaviour("Pick one:\n**1.** TableView\n**2.** CustomComponent\n"),
    true,
  );
});

void test("a case without expectations passes every check", () => {
  const plain = { ...CASE, expect: { skills: ["dms-pages"] } };

  assert.deepEqual(checkAnswer(plain, "anything"), {
    missingMentions: [],
    forbiddenMentions: [],
    behaviourOk: true,
  });
});

void test("answers each case with its expected skills loaded, verifies it and summarizes the invented rate", async () => {
  /** @type {ModelRequest[]} */
  const requests = [];
  /** @type {ModelBackend} */
  const backend = {
    complete: async (request) => {
      requests.push(request);
      return "Use `CustomComponent`, or a TableView?";
    },
  };
  const corpus = [
    { name: "dms-best-practices", description: "d", content: "RULES" },
    { name: "dms-pages", description: "d", content: "PAGES" },
  ];
  const verify = async () => ({
    checked: 4,
    findings: [{ name: "KanbanBoard" }],
    inventedRate: 0.25,
  });

  const results = await runAnswerEval({
    cases: [CASE],
    skills: corpus,
    backend,
    verify,
  });
  const summary = summarizeAnswers(results, { maxInvented: 0.2 });

  assert.match(requests[0].system, /RULES/);
  assert.doesNotMatch(requests[0].system, /PAGES/);
  assert.ok(!results[0].skipped);
  assert.equal(results[0].invented, 1);
  assert.equal(summary.inventedRate, 0.25);
  assert.equal(summary.passed, false);
});

void test("a case whose skills are all absent from the corpus is skipped", async () => {
  const backend = { complete: async () => assert.fail("must not be called") };

  const results = await runAnswerEval({
    cases: [CASE],
    skills: [],
    backend,
    verify: async () => ({ checked: 0, findings: [] }),
  });

  assert.equal(results[0].skipped, true);
});
