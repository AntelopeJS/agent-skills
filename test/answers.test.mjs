import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkAnswer,
  runAnswerEval,
  summarizeAnswers,
} from "../scripts/lib/answers.mjs";

const fence = "```";
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

test("mentions, forbidden names and the asks-first behaviour are checked on the answer text", () => {
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

test("a case without expectations passes every check", () => {
  const plain = { ...CASE, expect: { skills: ["dms-pages"] } };

  assert.deepEqual(checkAnswer(plain, "anything"), {
    missingMentions: [],
    forbiddenMentions: [],
    behaviourOk: true,
  });
});

test("answers each case with its expected skills loaded, verifies it and summarizes the invented rate", async () => {
  const requests = [];
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
  assert.equal(results[0].invented, 1);
  assert.equal(summary.inventedRate, 0.25);
  assert.equal(summary.passed, false);
});

test("a case whose skills are all absent from the corpus is skipped", async () => {
  const backend = { complete: async () => assert.fail("must not be called") };

  const results = await runAnswerEval({
    cases: [CASE],
    skills: [],
    backend,
    verify: async () => ({}),
  });

  assert.equal(results[0].skipped, true);
});
