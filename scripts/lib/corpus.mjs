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
import { parseJson } from "./json.mjs";
import { fieldOf } from "./safe-read.mjs";
import { isRecord, isText } from "./values.mjs";

/**
 * @typedef {object} Skill
 * @property {string} name
 * @property {string} description
 * @property {string} path
 * @property {string} dir
 * @property {unknown} source
 * @property {string} content
 */

/**
 * @typedef {object} SkillSource
 * @property {string} dir
 * @property {unknown} source
 */

/**
 * @typedef {object} CorpusOptions
 * @property {string} [project]
 * @property {string[]} [dirs]
 * @property {string[]} [packages]
 * @property {(spec: string) => string} [fetch]
 */

/**
 * @typedef {object} SyncedSkill
 * @property {string} target
 * @property {string} package
 */

const SKILL_FILE = "SKILL.md";
const SCAN_DEPTH = 4;
const SYNC_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "sync-skills.mjs",
);

/**
 * @param {string} path
 * @returns {boolean}
 */
function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function childDirs(dir) {
  return readdirSync(dir)
    .filter((entry) => !entry.startsWith(".") && entry !== "node_modules")
    .map((entry) => join(dir, entry))
    .filter(isDirectory);
}

/**
 * @param {string} dir
 * @param {number} [depth]
 * @returns {string[]}
 */
function skillDirsUnder(dir, depth = SCAN_DEPTH) {
  if (!isDirectory(dir)) return [];
  if (existsSync(join(dir, SKILL_FILE))) return [dir];
  if (depth === 0) return [];
  return childDirs(dir).flatMap((child) => skillDirsUnder(child, depth - 1));
}

/**
 * @param {string} skillDir
 * @param {unknown} source
 * @returns {Skill}
 */
function readSkill(skillDir, source) {
  const path = join(skillDir, SKILL_FILE);
  const { data, body } = parseFrontmatter(readFileSync(path, "utf8"));
  const name = isText(data.name) && data.name ? data.name : basename(skillDir);
  const description = isText(data.description) ? data.description : "";
  return { name, description, path, dir: skillDir, source, content: body };
}

/**
 * @param {unknown} value
 * @returns {value is SyncedSkill}
 */
function isSyncedSkill(value) {
  return isRecord(value) && isText(value.target) && isText(value.package);
}

/**
 * @param {string} project
 * @returns {SkillSource[]}
 */
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
  const skills = fieldOf(parseJson(output), "skills");
  return (Array.isArray(skills) ? skills : [])
    .filter(isSyncedSkill)
    .map((skill) => ({
      dir: resolve(project, skill.target),
      source: skill.package,
    }));
}

/**
 * @param {string} dir
 * @returns {SkillSource[]}
 */
function packageSkillDirs(dir) {
  const pkg = parseJson(readFileSync(join(dir, "package.json"), "utf8"));
  const skills = fieldOf(fieldOf(pkg, "antelopeJs"), "skills");
  const declared = Array.isArray(skills) ? skills : [];
  return declared
    .filter(isText)
    .flatMap((rel) => skillDirsUnder(resolve(dir, rel), 1))
    .map((skillDir) => ({ dir: skillDir, source: fieldOf(pkg, "name") }));
}

/**
 * @param {CorpusOptions} options
 * @returns {SkillSource[]}
 */
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
 * @param {CorpusOptions} options
 * @returns {{ skills: Skill[], duplicates: Skill[] }}
 */
export function loadCorpus(options) {
  /** @type {Map<string, Skill>} */
  const skills = new Map();
  /** @type {Skill[]} */
  const duplicates = [];
  for (const { dir, source } of sourcesOf(options)) {
    const skill = readSkill(dir, source);
    if (skills.has(skill.name)) duplicates.push(skill);
    else skills.set(skill.name, skill);
  }
  return { skills: [...skills.values()], duplicates };
}
