#!/usr/bin/env node
// Sync package-shipped Claude Code skills into the current project.
//
// A package ships skills by declaring `antelopeJs.skills` in its package.json:
// an array of directories (relative to the package root) whose subdirectories
// each contain a SKILL.md. Every declared skill is linked into
// `.claude/skills/<module-short-name>--<skill-dir-name>` as a RELATIVE symlink.
//
// Packages are discovered, first hit per package name wins, in:
//   1. workspace  — the cwd, its ancestors up to the repository/workspace root,
//                   and the packages listed by that root's pnpm-workspace.yaml
//                   or package.json `workspaces` (source checkouts, playgrounds).
//   2. node_modules — `node_modules` of the cwd and of that root (direct and
//                   hoisted dependencies). pnpm symlinks into `.pnpm` are
//                   followed; the link keeps the `node_modules/<pkg>` path so
//                   it survives version bumps.
//   3. antelope-cache — `.antelope/cache`, where `ajs` installs project modules.
//
// A directory is an AntelopeJS project when it holds `antelope.config.*`, or
// when its package.json depends on `@antelopejs/core` (embedded runtime, e.g.
// the AdonisJS template). Anywhere else the script exits 0 and does nothing.
//
// Only entries the script created are ever touched: they are tracked in
// `.claude/skills/.ajs-managed.json`, and `.claude/skills/.gitignore` keeps them
// out of git. Managed entries whose package or skill disappeared are pruned.
//
// Flags:
//   --quiet    No output, warnings included (hook mode).
//   --json     Machine-readable summary on stdout.
//   --dry-run  Report what would change without touching the filesystem.
//   --list     Show every package-shipped skill, its source and its status;
//              changes nothing.

import {
  readFileSync,
  readdirSync,
  existsSync,
  lstatSync,
  statSync,
  mkdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  readlinkSync,
} from "node:fs";
import { join, relative, resolve, dirname, isAbsolute } from "node:path";

const argv = new Set(process.argv.slice(2));
const LIST = argv.has("--list");
const QUIET = argv.has("--quiet");
const JSON_OUT = argv.has("--json");
const DRY_RUN = argv.has("--dry-run") || LIST;

const cwd = process.cwd();
const SKILLS_DIR = join(cwd, ".claude", "skills");
const MANIFEST_PATH = join(SKILLS_DIR, ".ajs-managed.json");
const GITIGNORE_PATH = join(SKILLS_DIR, ".gitignore");
const CONFIG_VARIANTS = ["antelope.config.ts", "antelope.config.js", "antelope.config.mjs", "antelope.config.cjs", "antelope.config.json"];
const CORE_PACKAGE = "@antelopejs/core";
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"];
const WORKSPACE_FILE = "pnpm-workspace.yaml";
const ORIGIN = { workspace: "workspace", nodeModules: "node_modules", cache: "antelope-cache" };
const STATUS = { linked: "linked", added: "added", skipped: "skipped" };
const RECURSIVE_GLOB_DEPTH = 3;

function log(msg) {
  if (!QUIET && !JSON_OUT) console.log(msg);
}

function warn(msg) {
  if (!QUIET) process.stderr.write(`warning: ${msg}\n`);
}

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readTextSafe(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function lstatSafe(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function isDirectorySafe(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readdirSafe(path) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

// ---- project detection ----

function dependsOnCore(pkg) {
  return DEPENDENCY_FIELDS.some((field) => pkg?.[field]?.[CORE_PACKAGE]);
}

function isAntelopeProject(dir) {
  if (CONFIG_VARIANTS.some((f) => existsSync(join(dir, f)))) return true;
  return dependsOnCore(readJsonSafe(join(dir, "package.json")));
}

// ---- workspace discovery ----

function declaresWorkspaces(dir) {
  if (existsSync(join(dir, WORKSPACE_FILE))) return true;
  return Boolean(readJsonSafe(join(dir, "package.json"))?.workspaces);
}

function isBoundary(dir) {
  return existsSync(join(dir, ".git")) || declaresWorkspaces(dir);
}

// The cwd and its ancestors up to the nearest repository or workspace root;
// only the cwd when no such root exists.
function ancestorDirs() {
  const dirs = [];
  for (let dir = cwd; ; dir = dirname(dir)) {
    dirs.push(dir);
    if (isBoundary(dir)) return dirs;
    if (dirname(dir) === dir) return [cwd];
  }
}

function pnpmWorkspaceGlobs(root) {
  const lines = readTextSafe(join(root, WORKSPACE_FILE)).split("\n");
  const start = lines.findIndex((line) => /^packages:\s*$/.test(line));
  if (start < 0) return [];
  const globs = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const match = line.match(/^\s*-\s*["']?([^"'#]+?)["']?\s*(#.*)?$/);
    if (match) globs.push(match[1]);
  }
  return globs;
}

function packageJsonWorkspaceGlobs(root) {
  const workspaces = readJsonSafe(join(root, "package.json"))?.workspaces;
  const globs = Array.isArray(workspaces) ? workspaces : workspaces?.packages;
  return Array.isArray(globs) ? globs.filter((g) => typeof g === "string") : [];
}

function childDirs(dir) {
  return readdirSafe(dir)
    .filter((entry) => !entry.startsWith(".") && entry !== "node_modules")
    .map((entry) => join(dir, entry))
    .filter(isDirectorySafe);
}

function descendantDirs(dir, depth) {
  if (depth === 0) return [];
  return childDirs(dir).flatMap((child) => [child, ...descendantDirs(child, depth - 1)]);
}

// Supports the glob forms workspaces use in practice: `dir`, `dir/*`, `dir/**`.
function expandWorkspaceGlob(root, glob) {
  if (glob.startsWith("!")) return [];
  const clean = glob.replace(/^\.\//, "").replace(/\/$/, "");
  if (clean.endsWith("/**")) return descendantDirs(join(root, clean.slice(0, -3)), RECURSIVE_GLOB_DEPTH);
  if (clean.endsWith("/*")) return childDirs(join(root, clean.slice(0, -2)));
  return [join(root, clean)];
}

function workspacePackageDirs(root) {
  const globs = [...pnpmWorkspaceGlobs(root), ...packageJsonWorkspaceGlobs(root)];
  return globs.flatMap((glob) => expandWorkspaceGlob(root, glob));
}

// ---- package discovery ----

// Direct children of a package root: <root>/<pkg> and <root>/@scope/<pkg>.
function packagesIn(base) {
  const dirs = [];
  for (const entry of readdirSafe(base)) {
    if (entry.startsWith(".")) continue;
    const path = join(base, entry);
    if (!entry.startsWith("@")) dirs.push(path);
    else dirs.push(...readdirSafe(path).filter((e) => !e.startsWith(".")).map((e) => join(path, e)));
  }
  return dirs;
}

function candidatePackages() {
  const ancestors = ancestorDirs();
  const root = ancestors[ancestors.length - 1];
  const workspace = [...ancestors, ...workspacePackageDirs(root)];
  const nodeModules = [...new Set([cwd, root])].flatMap((dir) => packagesIn(join(dir, "node_modules")));
  return [
    ...workspace.map((dir) => ({ dir, origin: ORIGIN.workspace })),
    ...nodeModules.map((dir) => ({ dir, origin: ORIGIN.nodeModules })),
    ...packagesIn(join(cwd, ".antelope", "cache")).map((dir) => ({ dir, origin: ORIGIN.cache })),
  ];
}

// Every skill declared by the discovered packages.
// Returns Map<entryName, { target, package, version, origin, skill }>.
function discoverSkills(warnings) {
  const skills = new Map();
  const seenPackages = new Set();
  for (const { dir, origin } of candidatePackages()) {
    const pkg = readJsonSafe(join(dir, "package.json"));
    if (typeof pkg?.name !== "string" || seenPackages.has(pkg.name)) continue;
    const declared = pkg.antelopeJs?.skills;
    if (!Array.isArray(declared) || !declared.length) continue;
    seenPackages.add(pkg.name);
    collectPackageSkills({ pkg, dir, origin }, declared, skills, warnings);
  }
  return skills;
}

function escapesPackage(pkgDir, dir) {
  const relToPkg = relative(pkgDir, dir);
  return relToPkg.startsWith("..") || isAbsolute(relToPkg);
}

function skillName(skillDir, fallback) {
  const frontmatter = readTextSafe(join(skillDir, "SKILL.md")).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const name = frontmatter?.[1].match(/^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m);
  return name ? name[1] : fallback;
}

function collectPackageSkills(source, declaredDirs, skills, warnings) {
  const { pkg, dir: pkgDir, origin } = source;
  const moduleShort = pkg.name.slice(pkg.name.lastIndexOf("/") + 1);
  for (const rel of declaredDirs.filter((d) => typeof d === "string")) {
    const dir = resolve(pkgDir, rel);
    if (escapesPackage(pkgDir, dir)) {
      warnings.push(`${pkg.name}: skills dir '${rel}' escapes the package — skipped.`);
      continue;
    }
    for (const sub of readdirSafe(dir)) {
      const skillDir = join(dir, sub);
      if (!isDirectorySafe(skillDir) || !existsSync(join(skillDir, "SKILL.md"))) continue;
      const entryName = `${moduleShort}--${sub}`;
      const existing = skills.get(entryName);
      if (existing && existing.package !== pkg.name) {
        warnings.push(`${entryName}: also provided by ${pkg.name} — keeping the one from ${existing.package}.`);
      }
      if (existing) continue;
      const skill = skillName(skillDir, sub);
      skills.set(entryName, { target: skillDir, package: pkg.name, version: pkg.version ?? null, origin, skill });
    }
  }
}

// ---- manifest ----

function loadManifest() {
  const data = readJsonSafe(MANIFEST_PATH);
  return Array.isArray(data?.entries) ? data.entries.filter((e) => typeof e === "string") : [];
}

function saveManifest(entries) {
  writeFileSync(MANIFEST_PATH, `${JSON.stringify({ entries: [...entries].sort() }, null, 2)}\n`);
}

function writeGitignore(entries) {
  const lines = [
    "# Managed by the antelopejs plugin (sync-skills) — do not edit.",
    ".gitignore",
    ".ajs-managed.json",
    ...[...entries].sort(),
  ];
  const content = `${lines.join("\n")}\n`;
  if (readTextSafe(GITIGNORE_PATH) === content) return;
  writeFileSync(GITIGNORE_PATH, content);
}

// ---- sync ----

function symlinkPointsTo(linkPath, target) {
  const st = lstatSafe(linkPath);
  if (!st?.isSymbolicLink()) return false;
  try {
    return resolve(dirname(linkPath), readlinkSync(linkPath)) === resolve(target);
  } catch {
    return false;
  }
}

// Drops managed entries that are no longer desired. A managed entry the user
// replaced with a real file or directory becomes theirs and leaves the manifest.
function pruneManaged(state) {
  const { desired, managed, removed, warnings } = state;
  for (const name of managed) {
    const linkPath = join(SKILLS_DIR, name);
    const wanted = desired.has(name);
    const st = lstatSafe(linkPath);
    if (wanted && st?.isSymbolicLink()) continue;
    if (st && !st.isSymbolicLink()) {
      if (!wanted) warnings.push(`${name}: managed entry is no longer a symlink — left in place, dropped from manifest.`);
      managed.delete(name);
      continue;
    }
    if (wanted) continue;
    if (st && !DRY_RUN) unlinkSync(linkPath);
    if (st) removed.push(name);
    managed.delete(name);
  }
}

function linkSkill(name, target, state) {
  const linkPath = join(SKILLS_DIR, name);
  const st = lstatSafe(linkPath);
  if (st && !state.managed.has(name)) {
    state.warnings.push(`${name}: already exists in .claude/skills and is not managed — skipped.`);
    return STATUS.skipped;
  }
  state.managed.add(name);
  if (symlinkPointsTo(linkPath, target)) return STATUS.linked;
  if (!DRY_RUN) {
    mkdirSync(SKILLS_DIR, { recursive: true });
    if (st) unlinkSync(linkPath);
    symlinkSync(relative(SKILLS_DIR, target), linkPath);
  }
  return STATUS.added;
}

function persist(managed) {
  if (DRY_RUN || (managed.size === 0 && !existsSync(MANIFEST_PATH))) return;
  mkdirSync(SKILLS_DIR, { recursive: true });
  saveManifest(managed);
  writeGitignore(managed);
}

function sync() {
  const warnings = [];
  const desired = discoverSkills(warnings);
  const state = { desired, managed: new Set(loadManifest()), removed: [], warnings };
  pruneManaged(state);
  const skills = [...desired].map(([name, info]) => ({ name, ...info, status: linkSkill(name, info.target, state) }));
  persist(state.managed);
  const named = (status) => skills.filter((s) => s.status === status).map((s) => s.name);
  return {
    added: named(STATUS.added),
    removed: state.removed,
    kept: named(STATUS.linked),
    warnings,
    skills,
  };
}

// ---- output ----

function listRow(skill) {
  const target = relative(cwd, skill.target);
  const pkg = skill.version ? `${skill.package}@${skill.version}` : skill.package;
  const status = DRY_RUN && skill.status === STATUS.added ? "not synced yet" : skill.status;
  return [skill.name, skill.skill, pkg, skill.origin, status, target];
}

function printTable(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
  for (const row of rows) log(row.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd());
}

function printList(result) {
  if (!result.skills.length) {
    log("No installed package ships skills (antelopeJs.skills) — nothing to sync.");
    return;
  }
  printTable([["ENTRY", "SKILL", "PACKAGE", "FROM", "STATUS", "SOURCE"], ...result.skills.map(listRow)]);
  for (const name of result.removed) log(`stale: .claude/skills/${name} (its package is gone; the next sync removes it)`);
}

function printChanges(result) {
  const verb = DRY_RUN ? "would add" : "add";
  const verbRm = DRY_RUN ? "would remove" : "remove";
  for (const name of result.added) log(`${verb}    .claude/skills/${name}`);
  for (const name of result.removed) log(`${verbRm} .claude/skills/${name}`);
  log(`${result.added.length} added, ${result.removed.length} removed, ${result.kept.length} up to date.`);
}

function printJson(result) {
  const skills = result.skills.map(({ target, ...rest }) => ({ ...rest, target: relative(cwd, target) }));
  console.log(JSON.stringify({ project: true, dryRun: DRY_RUN, ...result, skills }));
}

// ---- entry ----

if (!isAntelopeProject(cwd)) {
  log("Not an AntelopeJS project (no antelope.config.* and no @antelopejs/core dependency); nothing to do.");
  if (JSON_OUT) console.log(JSON.stringify({ project: false, added: [], removed: [], kept: [], skills: [] }));
  process.exit(0);
}

const result = sync();
for (const w of result.warnings) warn(w);
const printers = [
  [JSON_OUT, printJson],
  [LIST, printList],
  [true, printChanges],
];
printers.find(([applies]) => applies)[1](result);
