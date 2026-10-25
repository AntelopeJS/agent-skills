import { test } from "node:test";
import assert from "node:assert/strict";

import { createBaselinePicker, tokenize } from "../scripts/lib/baseline.mjs";

const SKILLS = [
  {
    name: "dms-pages",
    description:
      "Declares admin pages: Form / TableView / KpiCard blocks, tables and charts.",
  },
  {
    name: "dms-mailing",
    description:
      "Sends transactional e-mail templates with SendTemplate; bounces and webhooks.",
  },
  {
    name: "dms-frontend",
    description:
      "Runs, builds and deploys the DMS frontend with the ajs dms CLI behind a reverse proxy.",
  },
  {
    name: "dms",
    description:
      "Mental model of the AntelopeJS DMS; routes to the DMS skills.",
  },
];

test("tokenize lowercases, strips accents, splits identifiers and drops stop words", () => {
  assert.deepEqual(tokenize("Add the KpiCard to café-pages"), [
    "add",
    "kpi",
    "card",
    "cafe",
    "page",
  ]);
});

test("picks the skill whose description carries the prompt's key terms", () => {
  const pick = createBaselinePicker(SKILLS);

  assert.deepEqual(pick("Add a table of the orders on an admin page"), [
    "dms-pages",
  ]);
  assert.deepEqual(pick("deploy the frontend behind nginx"), ["dms-frontend"]);
});

test("picks nothing for an unrelated prompt", () => {
  const pick = createBaselinePicker(SKILLS);

  assert.deepEqual(pick("apple pie recipe"), []);
});

test("stops picking a skill once its description loses the key terms", () => {
  const renamed = SKILLS.map((s) =>
    s.name === "dms-mailing" ? { ...s, description: "Messaging module." } : s,
  );

  assert.deepEqual(
    createBaselinePicker(SKILLS)("send the welcome email template"),
    ["dms-mailing"],
  );
  assert.notDeepEqual(
    createBaselinePicker(renamed)("send the welcome email template"),
    ["dms-mailing"],
  );
});

test("is deterministic", () => {
  const pick = createBaselinePicker(SKILLS);

  assert.deepEqual(pick("build the dms pages"), pick("build the dms pages"));
});
