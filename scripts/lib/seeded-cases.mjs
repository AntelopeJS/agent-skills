import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const CONTROL_ID = "control";
export const SKILL_PREFIX = "verify-";
export const SKILLS_DIR = join(".agents", "skills");
export const KINDS = ["breaks", "doors", "control", "touched"];
const DEFAULT_MODES = ["breaks", "doors", "control"];
const PATCH_SUFFIX = ".patch";
const PATCH_DIRS = {
  break: "seeded-breaks",
  door: "seeded-doors",
};

/** The verification skills of a checkout: `.agents/skills/verify-<repo>/`. */
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

/** Picks the checkout's verification skill, by `--skill` or when there is exactly one. */
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
 */
export function discoverCases(checkout, skill) {
  const breaks = patchesOf(checkout, skill, "break");
  return [
    ...breaks,
    ...patchesOf(checkout, skill, "door"),
    { id: CONTROL_ID, kind: "control", subject: "head", patch: undefined },
    ...breaks.map((item) => ({
      ...item,
      id: `touched-${item.subject}`,
      kind: "touched",
      touch: true,
    })),
  ];
}

const MODE_KINDS = {
  breaks: "break",
  doors: "door",
  control: "control",
  touched: "touched",
};

/** Keeps the cases of the chosen modes (`breaks`, `doors`, `control`) and ids. */
export function selectSeeded(cases, { modes, only }) {
  const chosen = modes.length ? modes : only.length ? KINDS : DEFAULT_MODES;
  const kinds = new Set(chosen.map((mode) => MODE_KINDS[mode]));
  const ids = new Set(only);
  return cases.filter(
    (item) => kinds.has(item.kind) && (!ids.size || ids.has(item.id)),
  );
}
