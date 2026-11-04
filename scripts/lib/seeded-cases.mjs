import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * What a seeded case checks: a break the verdict must FAIL on, a door the
 * One-way doors section must name, the unpatched head, or the head with the
 * files of a break touched.
 * @typedef {"break" | "door" | "control" | "touched"} CaseKind
 */

/**
 * One case of the seeded eval.
 * @typedef {object} SeededCase
 * @property {string} id
 * @property {CaseKind} kind
 * @property {string} subject The feature of a break, the kind of a door, `head` for the control.
 * @property {string} [patch] The patch file the case applies; absent for the unpatched head.
 * @property {boolean} [touch] Whether the case only appends a blank line to the files its patch changes.
 */

export const CONTROL_ID = "control";
export const SKILL_PREFIX = "verify-";
export const SKILLS_DIR = join(".agents", "skills");
/** @type {string[]} */
export const KINDS = ["breaks", "doors", "control", "touched"];
const DEFAULT_MODES = ["breaks", "doors", "control"];
const PATCH_SUFFIX = ".patch";
/** @type {Record<"break" | "door", string>} */
const PATCH_DIRS = {
  break: "seeded-breaks",
  door: "seeded-doors",
};

/**
 * The verification skills of a checkout: `.agents/skills/verify-<repo>/`.
 * @param {string} checkout
 * @returns {string[]}
 */
export function verifySkillsOf(checkout) {
  const root = join(checkout, SKILLS_DIR);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith(SKILL_PREFIX),
    )
    .map((entry) => entry.name)
    .sort();
}

/**
 * Picks the checkout's verification skill, by `--skill` or when there is exactly one.
 * @param {string} checkout
 * @param {string | undefined} requested
 * @returns {string}
 */
export function pickSkill(checkout, requested) {
  const skills = verifySkillsOf(checkout);
  if (requested) {
    if (!skills.includes(requested))
      throw new Error(
        `${checkout} has no ${SKILLS_DIR}/${requested} (found: ${skills.join(", ") || "none"})`,
      );
    return requested;
  }
  if (skills.length !== 1)
    throw new Error(
      `${checkout} needs --skill: found ${skills.length} verification skills (${skills.join(", ") || "none"})`,
    );
  return skills[0];
}

/**
 * @param {string} checkout
 * @param {string} skill
 * @param {"break" | "door"} kind
 * @returns {SeededCase[]}
 */
function patchesOf(checkout, skill, kind) {
  const dir = join(checkout, SKILLS_DIR, skill, PATCH_DIRS[kind]);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(PATCH_SUFFIX))
    .sort()
    .map((file) => ({
      id: `${kind}-${file.slice(0, -PATCH_SUFFIX.length)}`,
      kind,
      subject: file.slice(0, -PATCH_SUFFIX.length),
      patch: join(dir, file),
    }));
}

/**
 * The eval cases of a repository: one per `seeded-breaks/<feature>.patch`
 * (the verdict must be FAIL naming the feature), one per
 * `seeded-doors/<kind>.patch` (the One-way doors section must name the kind)
 * and the unpatched head (the verdict must not be FAIL). Each break also has a
 * `touched-<feature>` case: the head with a blank line appended to the files
 * its patch changes, so the feature's journeys run on correct code and a
 * journey that fails on its own cannot pass as a catch.
 * @param {string} checkout
 * @param {string} skill
 * @returns {SeededCase[]}
 */
export function discoverCases(checkout, skill) {
  const breaks = patchesOf(checkout, skill, "break");
  /** @type {SeededCase[]} */
  const touched = breaks.map((item) => ({
    ...item,
    id: `touched-${item.subject}`,
    kind: "touched",
    touch: true,
  }));
  return [
    ...breaks,
    ...patchesOf(checkout, skill, "door"),
    { id: CONTROL_ID, kind: "control", subject: "head", patch: undefined },
    ...touched,
  ];
}

/** @type {Record<string, CaseKind>} */
const MODE_KINDS = {
  breaks: "break",
  doors: "door",
  control: "control",
  touched: "touched",
};

/**
 * Keeps the cases of the chosen modes (`breaks`, `doors`, `control`) and ids.
 * @param {SeededCase[]} cases
 * @param {{ modes: string[], only: string[] }} choice
 * @returns {SeededCase[]}
 */
export function selectSeeded(cases, { modes, only }) {
  const chosen = modes.length ? modes : only.length ? KINDS : DEFAULT_MODES;
  const kinds = new Set(chosen.map((mode) => MODE_KINDS[mode]));
  const ids = new Set(only);
  return cases.filter(
    (item) => kinds.has(item.kind) && (!ids.size || ids.has(item.id)),
  );
}
