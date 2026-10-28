import { test } from "node:test";
import assert from "node:assert/strict";

import { MATRIX, floorTolerance, parseModels } from "../scripts/lib/matrix.mjs";

test("the default matrix is Opus 5.5 low, Sonnet 5.5 low and the Codex default GPT", () => {
  assert.deepEqual(
    parseModels(undefined).map((entry) => [
      entry.id,
      entry.model,
      entry.effort,
    ]),
    [
      ["claude-opus-5-5-low", "claude-opus-5-5", "low"],
      ["claude-sonnet-5-5-low", "claude-sonnet-5-5", "low"],
      ["codex-gpt", null, null],
    ],
  );
});

test("a custom spec names its executor, model and effort", () => {
  assert.deepEqual(
    parseModels("claude:claude-haiku-5-5:medium,codex:gpt-6.1-sol"),
    [
      {
        id: "claude-claude-haiku-5-5-medium",
        executor: "claude",
        model: "claude-haiku-5-5",
        effort: "medium",
      },
      {
        id: "codex-gpt-6.1-sol",
        executor: "codex",
        model: "gpt-6.1-sol",
        effort: null,
      },
    ],
  );
});

test("an unknown model or effort is refused", () => {
  assert.throws(() => parseModels("gemini"), /unknown model 'gemini'/);
  assert.throws(
    () => parseModels("claude:claude-opus-5-5:fast"),
    /unknown model/,
  );
});

test("only Sonnet is allowed 0.1 under the floors", () => {
  assert.deepEqual(
    MATRIX.map((entry) => floorTolerance(entry)),
    [0, 0.1, 0],
  );
});
