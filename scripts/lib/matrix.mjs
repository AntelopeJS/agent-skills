import { DEFAULT_MODEL } from "./model.mjs";

/** @typedef {import("./model.mjs").Effort} Effort */

/**
 * One model of the matrix: the local CLI that runs it (`claude` or `codex`),
 * the model it asks for and the effort. A `null` model or effort keeps the
 * CLI's own default.
 * @typedef {object} MatrixEntry
 * @property {string} id
 * @property {string} executor
 * @property {string | null} model
 * @property {Effort | null} effort
 */

export const EXECUTORS = ["claude", "codex"];

/** @type {Effort[]} */
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const CUSTOM_RE = /^(claude|codex):([a-z0-9][a-z0-9.-]*)(?::([a-z]+))?$/;
const RELAXED_RE = /sonnet/;

/**
 * The model matrix of decision 10. `model: null` lets the Codex CLI pick its
 * own default GPT model; `effort: null` keeps the CLI's default effort.
 * @type {MatrixEntry[]}
 */
export const MATRIX = [
  {
    id: "claude-opus-5-5-low",
    executor: "claude",
    model: DEFAULT_MODEL,
    effort: "low",
  },
  {
    id: "claude-sonnet-5-5-low",
    executor: "claude",
    model: "claude-sonnet-5-5",
    effort: "low",
  },
  { id: "codex-gpt", executor: "codex", model: null, effort: null },
];

/**
 * Sonnet is allowed 0.1 below the trigger floors of the other models.
 * @param {MatrixEntry} entry
 * @returns {number}
 */
export function floorTolerance(entry) {
  return RELAXED_RE.test(entry.model ?? "") ? 0.1 : 0;
}

/**
 * @param {string} spec
 * @returns {MatrixEntry | null}
 */
function customEntry(spec) {
  const match = CUSTOM_RE.exec(spec);
  if (!match) return null;
  const [, executor, model, effort] = match;
  const knownEffort = EFFORTS.find((known) => known === effort);
  if (effort !== undefined && knownEffort === undefined) return null;
  return {
    id: [executor, model, effort].filter(Boolean).join("-"),
    executor,
    model,
    effort: knownEffort ?? null,
  };
}

/**
 * Resolves a comma-separated list of matrix ids, or of `claude:<model>[:<effort>]`
 * and `codex:<model>[:<effort>]` specs, to matrix entries.
 * @param {string | undefined} spec
 * @returns {MatrixEntry[]}
 */
export function parseModels(spec) {
  if (!spec) return MATRIX;
  return spec
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const entry =
        MATRIX.find((known) => known.id === item) ?? customEntry(item);
      if (!entry) throw new Error(`unknown model '${item}'`);
      return entry;
    });
}
