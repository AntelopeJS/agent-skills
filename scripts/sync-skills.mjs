#!/usr/bin/env node
/**
 * Sync package-shipped agent skills into the current project.
 *
 * A package ships skills by declaring `antelopeJs.skills` in its package.json:
 * an array of directories (relative to the package root) whose subdirectories
 * each contain a SKILL.md. Every declared skill is linked, as a RELATIVE
 * symlink named `<module-short-name>--<skill-dir-name>`, into each target:
 *   claude — `.claude/skills/` (Claude Code)
 *   codex  — `.agents/skills/` (OpenAI Codex)
 *
 * Packages are discovered, first hit per package name wins, in:
 *   1. workspace  — the cwd, its ancestors up to the repository/workspace root,
 *                   and the packages listed by that root's pnpm-workspace.yaml
 *                   or package.json `workspaces` (source checkouts, playgrounds).
 *   2. node_modules — `node_modules` of the cwd and of that root (direct and
 *                   hoisted dependencies). pnpm symlinks into `.pnpm` are
 *                   followed; the link keeps the `node_modules/<pkg>` path so
 *                   it survives version bumps.
 *   3. antelope-cache — `.antelope/cache`, where `ajs` installs project modules.
 *
 * A directory is an AntelopeJS project when it holds `antelope.config.*`, or
 * when its package.json depends on `@antelopejs/core` (embedded runtime, e.g.
 * the AdonisJS template). Anywhere else the script exits 0 and does nothing.
 *
 * Only entries the script created are ever touched: each target directory
 * tracks them in its own `.ajs-managed.json`, and a generated `.gitignore` there
 * keeps them out of git. Managed entries whose package or skill disappeared are
 * pruned.
 *
 * Flags:
 *   --target claude|codex|all
 *              Which skills directories to sync (default: all).
 *   --quiet    No output, warnings included (hook mode).
 *   --json     Machine-readable summary on stdout.
 *   --dry-run  Report what would change without touching the filesystem.
 *   --list     Show every package-shipped skill, its source and its status;
 *              changes nothing.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  readlinkSync,
} from "node:fs";
import { join, relative, resolve, dirname, isAbsolute } from "node:path";

import {
  candidatePackages,
  isDirectorySafe,
  readJsonSafe,
  readTextSafe,
  readdirSafe,
} from "./lib/skill-packages.mjs";
import { compareText, isText } from "./lib/values.mjs";

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
  claude: {
    name: "claude",
    label: ".claude/skills",
    dir: join(cwd, ".claude", "skills"),
  },
  codex: {
    name: "codex",
    label: ".agents/skills",
    dir: join(cwd, ".agents", "skills"),
  },
};
const CONFIG_VARIANTS = [
  "antelope.config.ts",
  "antelope.config.js",
  "antelope.config.mjs",
  "antelope.config.cjs",
  "antelope.config.json",
];
const CORE_PACKAGE = "@antelopejs/core";
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
];
const STATUS = { linked: "linked", added: "added", skipped: "skipped" };

function log(msg) {
  if (!QUIET && !JSON_OUT) console.log(msg);
}

function warn(msg) {
  if (!QUIET) process.stderr.write(`warning: ${msg}\n`);
}

function lstatSafe(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

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
  process.stderr.write(
    `error: ${TARGET_FLAG} expects one of ${[...Object.keys(TARGETS), ALL_TARGETS].join(", ")}.\n`,
  );
  process.exit(USAGE_EXIT_CODE);
}

function dependsOnCore(pkg) {
  return DEPENDENCY_FIELDS.some((field) => pkg?.[field]?.[CORE_PACKAGE]);
}

function isAntelopeProject(dir) {
  if (CONFIG_VARIANTS.some((f) => existsSync(join(dir, f)))) return true;
  return dependsOnCore(readJsonSafe(join(dir, "package.json")));
}

/**
 * Every skill declared by the discovered packages.
 * Returns Map<entryName, { target, package, version, origin, skill }>.
 */
function discoverSkills(warnings) {
  const skills = new Map();
  const seenPackages = new Set();
  for (const { dir, origin } of candidatePackages(cwd)) {
    const pkg = readJsonSafe(join(dir, "package.json"));
    if (!isText(pkg?.name) || seenPackages.has(pkg.name)) continue;
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
  const frontmatter = readTextSafe(join(skillDir, "SKILL.md")).match(
    /^---\r?\n([\s\S]*?)\r?\n---/,
  );
  const name = frontmatter?.[1].match(/^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m);
  return name ? name[1] : fallback;
}

function collectPackageSkills(source, declaredDirs, skills, warnings) {
  const { pkg, dir: pkgDir, origin } = source;
  const moduleShort = pkg.name.slice(pkg.name.lastIndexOf("/") + 1);
  for (const rel of declaredDirs.filter(isText)) {
    const dir = resolve(pkgDir, rel);
    if (escapesPackage(pkgDir, dir)) {
      warnings.push(
        `${pkg.name}: skills dir '${rel}' escapes the package — skipped.`,
      );
      continue;
    }
    for (const sub of readdirSafe(dir)) {
      const skillDir = join(dir, sub);
      if (!isDirectorySafe(skillDir) || !existsSync(join(skillDir, "SKILL.md")))
        continue;
      const entryName = `${moduleShort}--${sub}`;
      const existing = skills.get(entryName);
      if (existing && existing.package !== pkg.name) {
        warnings.push(
          `${entryName}: also provided by ${pkg.name} — keeping the one from ${existing.package}.`,
        );
      }
      if (existing) continue;
      const skill = skillName(skillDir, sub);
      skills.set(entryName, {
        target: skillDir,
        package: pkg.name,
        version: pkg.version ?? null,
        origin,
        skill,
      });
    }
  }
}

function loadManifest(target) {
  const data = readJsonSafe(join(target.dir, MANIFEST_FILE));
  return Array.isArray(data?.entries) ? data.entries.filter(isText) : [];
}

function saveManifest(target, entries) {
  writeFileSync(
    join(target.dir, MANIFEST_FILE),
    `${JSON.stringify({ entries: [...entries].sort(compareText) }, null, 2)}\n`,
  );
}

function writeGitignore(target, entries) {
  const path = join(target.dir, GITIGNORE_FILE);
  const lines = [
    "# Managed by the antelopejs agent skills sync — do not edit.",
    GITIGNORE_FILE,
    MANIFEST_FILE,
    ...[...entries].sort(compareText),
  ];
  const content = `${lines.join("\n")}\n`;
  if (readTextSafe(path) === content) return;
  writeFileSync(path, content);
}

function symlinkPointsTo(linkPath, target) {
  const st = lstatSafe(linkPath);
  if (!st?.isSymbolicLink()) return false;
  try {
    return (
      resolve(dirname(linkPath), readlinkSync(linkPath)) === resolve(target)
    );
  } catch {
    return false;
  }
}

/**
 * Drops managed entries that are no longer desired. A managed entry the user
 * replaced with a real file or directory becomes theirs and leaves the manifest.
 */
function pruneManaged(state) {
  const { target, desired, managed, removed, warnings } = state;
  for (const name of managed) {
    const linkPath = join(target.dir, name);
    const wanted = desired.has(name);
    const st = lstatSafe(linkPath);
    if (wanted && st?.isSymbolicLink()) continue;
    if (st && !st.isSymbolicLink()) {
      if (!wanted)
        warnings.push(
          `${name}: managed entry is no longer a symlink — left in place, dropped from manifest.`,
        );
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
    state.warnings.push(
      `${name}: already exists in ${target.label} and is not managed — skipped.`,
    );
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
  if (
    DRY_RUN ||
    (managed.size === 0 && !existsSync(join(target.dir, MANIFEST_FILE)))
  )
    return;
  mkdirSync(target.dir, { recursive: true });
  saveManifest(target, managed);
  writeGitignore(target, managed);
}

function syncTarget(target, desired, warnings) {
  const state = {
    target,
    desired,
    managed: new Set(loadManifest(target)),
    removed: [],
    warnings,
  };
  pruneManaged(state);
  const statuses = new Map(
    [...desired].map(([name, info]) => [
      name,
      linkSkill(name, info.target, state),
    ]),
  );
  persist(target, state.managed);
  const named = (status) =>
    [...statuses].filter(([, s]) => s === status).map(([name]) => name);
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
  const results = targets.map((target) =>
    syncTarget(target, desired, warnings),
  );
  const statusOf = (name) =>
    Object.fromEntries(results.map((r) => [r.target, r.statuses.get(name)]));
  const skills = [...desired].map(([name, info]) => ({
    name,
    ...info,
    status: statusOf(name),
  }));
  return {
    targets: results.map(({ statuses, ...rest }) => rest),
    warnings,
    skills,
  };
}

function listStatus(status) {
  return DRY_RUN && status === STATUS.added ? "not synced yet" : status;
}

function listRow(skill, targets) {
  const pkg = skill.version
    ? `${skill.package}@${skill.version}`
    : skill.package;
  const statuses = targets.map((t) => listStatus(skill.status[t.target]));
  return [
    skill.name,
    skill.skill,
    pkg,
    skill.origin,
    ...statuses,
    relative(cwd, skill.target),
  ];
}

function printTable(rows) {
  const widths = rows[0].map((_, i) =>
    Math.max(...rows.map((row) => row[i].length)),
  );
  for (const row of rows)
    log(
      row
        .map((cell, i) => cell.padEnd(widths[i]))
        .join("  ")
        .trimEnd(),
    );
}

function printList(result) {
  if (!result.skills.length) {
    log(
      "No installed package ships skills (antelopeJs.skills) — nothing to sync.",
    );
    return;
  }
  const header = [
    "ENTRY",
    "SKILL",
    "PACKAGE",
    "FROM",
    ...result.targets.map((t) => t.target.toUpperCase()),
    "SOURCE",
  ];
  printTable([
    header,
    ...result.skills.map((skill) => listRow(skill, result.targets)),
  ]);
  for (const { dir, removed } of result.targets) {
    for (const name of removed)
      log(
        `stale: ${dir}/${name} (its package is gone; the next sync removes it)`,
      );
  }
}

function printChanges(result) {
  const verb = DRY_RUN ? "would add" : "add";
  const verbRm = DRY_RUN ? "would remove" : "remove";
  for (const { dir, added, removed, kept } of result.targets) {
    for (const name of added) log(`${verb}    ${dir}/${name}`);
    for (const name of removed) log(`${verbRm} ${dir}/${name}`);
    log(
      `${dir}: ${added.length} added, ${removed.length} removed, ${kept.length} up to date.`,
    );
  }
}

function printJson(result) {
  const skills = result.skills.map(({ target, ...rest }) => ({
    ...rest,
    target: relative(cwd, target),
  }));
  console.log(
    JSON.stringify({ project: true, dryRun: DRY_RUN, ...result, skills }),
  );
}

const targets = selectedTargets();
if (!isAntelopeProject(cwd)) {
  log(
    "Not an AntelopeJS project (no antelope.config.* and no @antelopejs/core dependency); nothing to do.",
  );
  if (JSON_OUT)
    console.log(
      JSON.stringify({ project: false, targets: [], warnings: [], skills: [] }),
    );
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
