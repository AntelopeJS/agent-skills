import { DEFAULT_MODEL } from "./model.mjs";

export const EXECUTORS = ["claude", "codex"];

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const CUSTOM_RE = /^(claude|codex):([a-z0-9][a-z0-9.-]*)(?::([a-z]+))?$/;
const RELAXED_RE = /sonnet/;

/**
 * The model matrix of decision 10. `model: null` lets the Codex CLI pick its
 * own default GPT model; `effort: null` keeps the CLI's default effort.
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

/** Sonnet is allowed 0.1 below the trigger floors of the other models. */
export function floorTolerance(entry) {
  return RELAXED_RE.test(entry.model ?? "") ? 0.1 : 0;
}

function customEntry(spec) {
  const match = CUSTOM_RE.exec(spec);
  if (!match) return null;
  const [, executor, model, effort] = match;
  if (effort !== undefined && !EFFORTS.includes(effort)) return null;
  return {
    id: [executor, model, effort].filter(Boolean).join("-"),
    executor,
    model,
    effort: effort ?? null,
  };
}

/**
 * Resolves a comma-separated list of matrix ids, or of `claude:<model>[:<effort>]`
 * and `codex:<model>[:<effort>]` specs, to matrix entries.
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
