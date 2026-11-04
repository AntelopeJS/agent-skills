import { test } from "node:test";
import assert from "node:assert/strict";

import { loadCases, minimumGaps } from "../scripts/lib/cases.mjs";
import { skillOf } from "./helpers.mjs";

const VERIFY_SKILLS = [
  "verify-antelopejs",
  "verify-dms",
  "verify-interface",
  "verify-module",
  "verify-template",
];

void test("the default case set carries trigger cases for every verification skill", () => {
  const { cases } = loadCases({ skills: [] });

  for (const name of VERIFY_SKILLS) {
    const triggers = cases.filter((item) => item.expect.skills.includes(name));
    assert.ok(
      triggers.some((item) => item.style === "casual"),
      `${name} has a casual case`,
    );
    assert.match(
      triggers.find((item) => item.style === "casual").prompt,
      /prove this change works/,
    );
  }
});

void test("each verification skill meets the case minimum of the corpus check", () => {
  const { cases } = loadCases({ skills: [] });

  assert.deepEqual(
    minimumGaps(
      cases,
      VERIFY_SKILLS.map((name) => skillOf(name)),
    ),
    [],
  );
});

void test("a neighbour case keeps each verification skill from being picked for plain usage questions", () => {
  const { cases } = loadCases({ skills: [] });

  for (const name of VERIFY_SKILLS)
    assert.ok(
      cases.some((item) => item.expect.avoid?.includes(name)),
      `${name} is avoided by a neighbour case`,
    );
});
