import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { loadCases, minimumGaps } from "../scripts/lib/cases.mjs";
import { validateDataset } from "../scripts/lib/dataset.mjs";
import {
  caseOf,
  makeTempDir,
  removeDir,
  skillOf,
  writeJson,
} from "./helpers.mjs";

/** @type {string} */
let root;

beforeEach(() => {
  root = makeTempDir();
});

afterEach(() => {
  removeDir(root);
});

/**
 * @param {import("../scripts/lib/dataset.mjs").EvalCase[]} cases
 * @returns {string}
 */
function writeCentral(cases) {
  const file = join(root, "central.json");
  writeJson(file, { version: 1, cases });
  return file;
}

/**
 * @param {string} name
 * @param {import("../scripts/lib/dataset.mjs").EvalCase[]} cases
 */
function skillWithCases(name, cases) {
  const dir = join(root, "skills", name);
  writeJson(join(dir, "cases.json"), { version: 1, cases });
  return skillOf(name, { dir });
}

void test("a skill's own case replaces the central case with the same id, so it never runs twice", () => {
  const centralFile = writeCentral([
    caseOf("pages-table", ["dms-pages"], { prompt: "central wording" }),
    caseOf("other", ["dms"]),
  ]);
  const skill = skillWithCases("dms-pages", [
    caseOf("pages-table", ["dms-pages"], { prompt: "package wording" }),
  ]);

  const { cases, shadowed } = loadCases({ skills: [skill], centralFile });

  assert.deepEqual(
    cases.map((item) => [item.id, item.prompt, item.source]),
    [
      ["pages-table", "package wording", "dms-pages"],
      ["other", "prompt of other", "central"],
    ],
  );
  assert.deepEqual(
    shadowed.map((item) => item.id),
    ["pages-table"],
  );
});

void test("a skill without a cases file adds no case and an invalid file is refused", () => {
  const centralFile = writeCentral([]);
  const plain = skillOf("dms-auth", { dir: join(root, "none") });
  const broken = skillOf("dms-pages", { dir: join(root, "broken") });
  writeJson(join(root, "broken", "cases.json"), { version: 1, cases: [{}] });

  assert.deepEqual(loadCases({ skills: [plain], centralFile }).cases, []);
  assert.throws(
    () => loadCases({ skills: [broken], centralFile }),
    /invalid dataset/,
  );
});

const COMPLETE = [
  caseOf("a-clean", ["dms-pages"], { expect: { mustMention: ["Table"] } }),
  caseOf("a-casual", ["dms-pages"], { style: "casual" }),
  caseOf("a-neighbour", ["dms-auth"], { expect: { avoid: ["dms-pages"] } }),
];

void test("a skill with all four kinds of case meets the minimum", () => {
  assert.deepEqual(minimumGaps(COMPLETE, [skillOf("dms-pages")]), []);
});

void test("each missing kind of case is named", () => {
  const gaps = minimumGaps(
    [caseOf("only-clean", ["dms-pages"])],
    [skillOf("dms-pages")],
  );

  assert.deepEqual(gaps, [
    {
      skill: "dms-pages",
      missing: [
        "a casual should-trigger case",
        "a should-not-trigger case aimed at its nearest neighbour",
        "an answers case with mustMention or behaviour",
      ],
    },
  ]);
});

void test("an acceptable skill does not count as covered", () => {
  const cases = [
    ...COMPLETE.filter((item) => item.id !== "a-casual"),
    caseOf("a-casual", ["dms"], {
      style: "casual",
      expect: { acceptable: ["dms-pages"] },
    }),
  ];

  assert.equal(minimumGaps(cases, [skillOf("dms-pages")]).length, 1);
});

void test("a case cannot both allow and avoid a skill", () => {
  const errors = validateDataset({
    version: 1,
    cases: [
      caseOf("x", ["dms"], {
        expect: { acceptable: ["dms-pages"], avoid: ["dms-pages"] },
      }),
    ],
  });

  assert.deepEqual(errors, [
    "case x: expect.avoid lists dms-pages, which the case also allows",
  ]);
});
