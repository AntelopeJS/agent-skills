/**
 * The skill corpus an eval runs against: every SKILL.md of a project (found
 * the way the sync finds them), of explicit directories, or of npm packages.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parseFrontmatter } from "./frontmatter.mjs";
import { fetchPackage } from "./packages.mjs";
import { isText } from "./values.mjs";

const SKILL_FILE = "SKILL.md";
const SCAN_DEPTH = 4;
const SYNC_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "sync-skills.mjs",
);

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function childDirs(dir) {
  return readdirSync(dir)
    .filter((entry) => !entry.startsWith(".") && entry !== "node_modules")
    .map((entry) => join(dir, entry))
    .filter(isDirectory);
}

function skillDirsUnder(dir, depth = SCAN_DEPTH) {
  if (!isDirectory(dir)) return [];
  if (existsSync(join(dir, SKILL_FILE))) return [dir];
  if (depth === 0) return [];
  return childDirs(dir).flatMap((child) => skillDirsUnder(child, depth - 1));
}

function readSkill(skillDir, source) {
  const path = join(skillDir, SKILL_FILE);
  const { data, body } = parseFrontmatter(readFileSync(path, "utf8"));
  const name = isText(data.name) && data.name ? data.name : basename(skillDir);
  const description = isText(data.description) ? data.description : "";
  return { name, description, path, dir: skillDir, source, content: body };
}

function projectSkillDirs(project) {
  const output = execFileSync(
    process.execPath,
    [SYNC_SCRIPT, "--list", "--json", "--target", "claude"],
    {
      cwd: project,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  const result = JSON.parse(output);
  return result.skills.map((skill) => ({
    dir: resolve(project, skill.target),
    source: skill.package,
  }));
}

function packageSkillDirs(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const declared = Array.isArray(pkg.antelopeJs?.skills)
    ? pkg.antelopeJs.skills
    : [];
  return declared
    .filter(isText)
    .flatMap((rel) => skillDirsUnder(resolve(dir, rel), 1))
    .map((skillDir) => ({ dir: skillDir, source: pkg.name }));
}

function sourcesOf({
  project,
  dirs = [],
  packages = [],
  fetch = fetchPackage,
}) {
  return [
    ...dirs.flatMap((dir) =>
      skillDirsUnder(resolve(dir)).map((skillDir) => ({
        dir: skillDir,
        source: resolve(dir),
      })),
    ),
    ...(project ? projectSkillDirs(resolve(project)) : []),
    ...packages.flatMap((spec) => packageSkillDirs(fetch(spec))),
  ];
}

/**
 * Loads the corpus from any mix of directories, a project and npm package specs,
 * in that order. The first skill of a given name wins; later ones land in
 * `duplicates`, so explicit directories override what a project installs.
 */
export function loadCorpus(options) {
  const skills = new Map();
  const duplicates = [];
  for (const { dir, source } of sourcesOf(options)) {
    const skill = readSkill(dir, source);
    if (skills.has(skill.name)) duplicates.push(skill);
    else skills.set(skill.name, skill);
  }
  return { skills: [...skills.values()], duplicates };
}
