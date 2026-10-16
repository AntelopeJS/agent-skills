#!/usr/bin/env node
// Sync package-shipped agent skills into the current project.
//
// A package ships skills by declaring `antelopeJs.skills` in its package.json:
// an array of directories (relative to the package root) whose subdirectories
// each contain a SKILL.md. Every declared skill is linked, as a RELATIVE
// symlink named `<module-short-name>--<skill-dir-name>`, into each target:
//   claude — `.claude/skills/` (Claude Code)
//   codex  — `.agents/skills/` (OpenAI Codex)
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
// Only entries the script created are ever touched: each target directory
// tracks them in its own `.ajs-managed.json`, and a generated `.gitignore` there
// keeps them out of git. Managed entries whose package or skill disappeared are
// pruned.
//
// Flags:
//   --target claude|codex|all
//              Which skills directories to sync (default: all).
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

const args = process.argv.slice(2);
const argv = new Set(args);
const LIST = argv.has("--list");
const QUIET = argv.has("--quiet");
const JSON_OUT = argv.has("--json");
const DRY_RUN = argv.has("--dry-run") || LIST;

const cwd = process.cwd();
const MANIFEST_FILE = ".ajs-managed.json";
const GITIGNORE_FILE = ".gitignore";
const TARGET_FLAG = "--target";
const ALL_TARGETS = "all";
const USAGE_EXIT_CODE = 2;
const TARGETS = {
  claude: { name: "claude", label: ".claude/skills", dir: join(cwd, ".claude", "skills") },
  codex: { name: "codex", label: ".agents/skills", dir: join(cwd, ".agents", "skills") },
};
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

// ---- targets ----

function targetFlagValue() {
  const inline = args.find((arg) => arg.startsWith(`${TARGET_FLAG}=`));
  if (inline) return inline.slice(TARGET_FLAG.length + 1);
  const index = args.indexOf(TARGET_FLAG);
  return index < 0 ? ALL_TARGETS : args[index + 1];
}

function selectedTargets() {
  const value = targetFlagValue();
  if (value === ALL_TARGETS) return Object.values(TARGETS);
  if (Object.hasOwn(TARGETS, value ?? "")) return [TARGETS[value]];
  process.stderr.write(`error: ${TARGET_FLAG} expects one of ${[...Object.keys(TARGETS), ALL_TARGETS].join(", ")}.\n`);
  process.exit(USAGE_EXIT_CODE);
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

function loadManifest(target) {
  const data = readJsonSafe(join(target.dir, MANIFEST_FILE));
  return Array.isArray(data?.entries) ? data.entries.filter((e) => typeof e === "string") : [];
}

function saveManifest(target, entries) {
  writeFileSync(join(target.dir, MANIFEST_FILE), `${JSON.stringify({ entries: [...entries].sort() }, null, 2)}\n`);
}

function writeGitignore(target, entries) {
  const path = join(target.dir, GITIGNORE_FILE);
  const lines = [
    "# Managed by the antelopejs agent skills sync — do not edit.",
    GITIGNORE_FILE,
    MANIFEST_FILE,
    ...[...entries].sort(),
  ];
  const content = `${lines.join("\n")}\n`;
  if (readTextSafe(path) === content) return;
  writeFileSync(path, content);
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
  const { target, desired, managed, removed, warnings } = state;
  for (const name of managed) {
    const linkPath = join(target.dir, name);
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

function linkSkill(name, skillDir, state) {
  const { target } = state;
  const linkPath = join(target.dir, name);
  const st = lstatSafe(linkPath);
  if (st && !state.managed.has(name)) {
    state.warnings.push(`${name}: already exists in ${target.label} and is not managed — skipped.`);
    return STATUS.skipped;
  }
  state.managed.add(name);
  if (symlinkPointsTo(linkPath, skillDir)) return STATUS.linked;
  if (!DRY_RUN) {
    mkdirSync(target.dir, { recursive: true });
    if (st) unlinkSync(linkPath);
    symlinkSync(relative(target.dir, skillDir), linkPath);
  }
  return STATUS.added;
}

function persist(target, managed) {
  if (DRY_RUN || (managed.size === 0 && !existsSync(join(target.dir, MANIFEST_FILE)))) return;
  mkdirSync(target.dir, { recursive: true });
  saveManifest(target, managed);
  writeGitignore(target, managed);
}

function syncTarget(target, desired, warnings) {
  const state = { target, desired, managed: new Set(loadManifest(target)), removed: [], warnings };
  pruneManaged(state);
  const statuses = new Map([...desired].map(([name, info]) => [name, linkSkill(name, info.target, state)]));
  persist(target, state.managed);
  const named = (status) => [...statuses].filter(([, s]) => s === status).map(([name]) => name);
  return {
    target: target.name,
    dir: target.label,
    added: named(STATUS.added),
    removed: state.removed,
    kept: named(STATUS.linked),
    statuses,
  };
}

function sync(targets) {
  const warnings = [];
  const desired = discoverSkills(warnings);
  const results = targets.map((target) => syncTarget(target, desired, warnings));
  const statusOf = (name) => Object.fromEntries(results.map((r) => [r.target, r.statuses.get(name)]));
  const skills = [...desired].map(([name, info]) => ({ name, ...info, status: statusOf(name) }));
  return { targets: results.map(({ statuses, ...rest }) => rest), warnings, skills };
}

// ---- output ----

function listStatus(status) {
  return DRY_RUN && status === STATUS.added ? "not synced yet" : status;
}

function listRow(skill, targets) {
  const pkg = skill.version ? `${skill.package}@${skill.version}` : skill.package;
  const statuses = targets.map((t) => listStatus(skill.status[t.target]));
  return [skill.name, skill.skill, pkg, skill.origin, ...statuses, relative(cwd, skill.target)];
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
  const header = ["ENTRY", "SKILL", "PACKAGE", "FROM", ...result.targets.map((t) => t.target.toUpperCase()), "SOURCE"];
  printTable([header, ...result.skills.map((skill) => listRow(skill, result.targets))]);
  for (const { dir, removed } of result.targets) {
    for (const name of removed) log(`stale: ${dir}/${name} (its package is gone; the next sync removes it)`);
  }
}

function printChanges(result) {
  const verb = DRY_RUN ? "would add" : "add";
  const verbRm = DRY_RUN ? "would remove" : "remove";
  for (const { dir, added, removed, kept } of result.targets) {
    for (const name of added) log(`${verb}    ${dir}/${name}`);
    for (const name of removed) log(`${verbRm} ${dir}/${name}`);
    log(`${dir}: ${added.length} added, ${removed.length} removed, ${kept.length} up to date.`);
  }
}

function printJson(result) {
  const skills = result.skills.map(({ target, ...rest }) => ({ ...rest, target: relative(cwd, target) }));
  console.log(JSON.stringify({ project: true, dryRun: DRY_RUN, ...result, skills }));
}

// ---- entry ----

const targets = selectedTargets();
if (!isAntelopeProject(cwd)) {
  log("Not an AntelopeJS project (no antelope.config.* and no @antelopejs/core dependency); nothing to do.");
  if (JSON_OUT) console.log(JSON.stringify({ project: false, targets: [], warnings: [], skills: [] }));
  process.exit(0);
}

const result = sync(targets);
for (const w of result.warnings) warn(w);
const printers = [
  [JSON_OUT, printJson],
  [LIST, printList],
  [true, printChanges],
];
printers.find(([applies]) => applies)[1](result);
