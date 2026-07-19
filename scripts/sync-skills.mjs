#!/usr/bin/env node
// Sync package-shipped Claude Code skills into the current project.
//
// AntelopeJS packages may ship skills alongside their code: a package declares
// `antelopeJs.skills` in its package.json — an array of directories (relative
// to the package root) whose subdirectories each contain a SKILL.md. This
// script finds those packages in the project's installed dependencies
// (node_modules) and in the CLI's module cache (.antelope/cache), and
// materializes every declared skill into `.claude/skills/` as a RELATIVE
// symlink named `<module-short-name>--<skill-dir-name>`.
//
// The script is idempotent and safe to run as a hook:
//   - Outside an AntelopeJS project (no antelope.config.*) it exits 0 silently.
//   - It only ever touches entries it created itself, tracked in
//     `.claude/skills/.ajs-managed.json`. Anything else in .claude/skills/ is
//     the user's and is never modified (collisions are skipped with a warning).
//   - Managed entries whose source package or skill directory disappeared are
//     pruned on the next run.
//   - `.claude/skills/.gitignore` is kept in sync so the managed symlinks, the
//     manifest, and the .gitignore itself never dirty the user's repo.
//
// Flags:
//   --quiet    No output unless an error occurs (hook mode).
//   --json     Machine-readable summary on stdout.
//   --dry-run  Report what would change without touching the filesystem.
// Default output: one line per add/remove plus a summary count.

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
const QUIET = argv.has("--quiet");
const JSON_OUT = argv.has("--json");
const DRY_RUN = argv.has("--dry-run");

const cwd = process.cwd();
const SKILLS_DIR = join(cwd, ".claude", "skills");
const MANIFEST_PATH = join(SKILLS_DIR, ".ajs-managed.json");
const GITIGNORE_PATH = join(SKILLS_DIR, ".gitignore");
const CONFIG_VARIANTS = ["antelope.config.ts", "antelope.config.js", "antelope.config.mjs", "antelope.config.cjs", "antelope.config.json"];

function log(msg) {
  if (!QUIET && !JSON_OUT) console.log(msg);
}

function warn(msg) {
  process.stderr.write(`warning: ${msg}\n`);
}

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// lstat/stat guarded — a dangling symlink or permission error must not abort a hook.
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

// ---- package discovery ----

// Roots whose direct children are packages: node_modules/<pkg>, node_modules/@scope/<pkg>,
// .antelope/cache/<pkg>, .antelope/cache/@scope/<pkg>. Dot-dirs (.bin, .pnpm, …) are skipped.
function packageRoots() {
  const roots = [];
  for (const base of [join(cwd, "node_modules"), join(cwd, ".antelope", "cache")]) {
    if (!isDirectorySafe(base)) continue;
    roots.push(base);
    for (const entry of readdirSafe(base)) {
      if (entry.startsWith("@") && isDirectorySafe(join(base, entry))) roots.push(join(base, entry));
    }
  }
  return roots;
}

// Every skill declared by installed/cached packages, deduplicated by package
// name (first hit wins — node_modules before .antelope/cache).
// Returns Map<entryName, { target, package }>.
function discoverSkills() {
  const skills = new Map();
  const seenPackages = new Set();
  for (const root of packageRoots()) {
    for (const entry of readdirSafe(root)) {
      if (entry.startsWith(".") || entry.startsWith("@")) continue;
      const pkgDir = join(root, entry);
      const pkg = readJsonSafe(join(pkgDir, "package.json"));
      if (!pkg || typeof pkg.name !== "string" || seenPackages.has(pkg.name)) continue;
      const declared = pkg.antelopeJs?.skills;
      if (!Array.isArray(declared) || !declared.length) continue;
      seenPackages.add(pkg.name);
      collectPackageSkills(pkg, pkgDir, declared, skills);
    }
  }
  return skills;
}

function collectPackageSkills(pkg, pkgDir, declaredDirs, skills) {
  const moduleShort = pkg.name.slice(pkg.name.lastIndexOf("/") + 1);
  for (const rel of declaredDirs) {
    if (typeof rel !== "string") continue;
    const dir = resolve(pkgDir, rel);
    // Directory-boundary-aware containment check: a plain prefix test would let
    // `../foo-bar` pass for a package installed at `.../foo`.
    const relToPkg = relative(pkgDir, dir);
    if (relToPkg.startsWith("..") || isAbsolute(relToPkg)) {
      warn(`${pkg.name}: skills dir '${rel}' escapes the package — skipped.`);
      continue;
    }
    for (const sub of readdirSafe(dir)) {
      const skillDir = join(dir, sub);
      if (!isDirectorySafe(skillDir) || !existsSync(join(skillDir, "SKILL.md"))) continue;
      const entryName = `${moduleShort}--${sub}`;
      const existing = skills.get(entryName);
      if (existing) {
        if (existing.package !== pkg.name) {
          warn(`${entryName}: also provided by ${pkg.name} — keeping the one from ${existing.package}.`);
        }
        continue;
      }
      skills.set(entryName, { target: skillDir, package: pkg.name });
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
  try {
    if (readFileSync(GITIGNORE_PATH, "utf8") === content) return;
  } catch {
    /* absent or unreadable — (re)write it */
  }
  writeFileSync(GITIGNORE_PATH, content);
}

// ---- sync ----

// True when the existing entry is a symlink already pointing at `target`.
function symlinkPointsTo(linkPath, target) {
  const st = lstatSafe(linkPath);
  if (!st?.isSymbolicLink()) return false;
  try {
    return resolve(dirname(linkPath), readlinkSync(linkPath)) === resolve(target);
  } catch {
    return false;
  }
}

function sync() {
  const desired = discoverSkills();
  const managed = new Set(loadManifest());
  const added = [];
  const removed = [];
  const kept = [];
  const warnings = [];

  // Prune managed entries that are no longer desired (package removed) or
  // whose target vanished. Entries the user replaced with real files are left alone.
  for (const name of managed) {
    const linkPath = join(SKILLS_DIR, name);
    const still = desired.get(name);
    const st = lstatSafe(linkPath);
    if (still && st?.isSymbolicLink() && existsSync(linkPath)) continue; // handled below
    if (st && !st.isSymbolicLink()) {
      // The user replaced a managed symlink with a real entry — it's theirs now.
      if (!still) warnings.push(`${name}: managed entry is no longer a symlink — left in place, dropped from manifest.`);
      managed.delete(name);
      continue;
    }
    if (!still || (st?.isSymbolicLink() && !existsSync(linkPath))) {
      if (st && !DRY_RUN) unlinkSync(linkPath);
      if (st) removed.push(name);
      managed.delete(name);
    }
  }

  // Create/refresh a symlink per desired skill.
  for (const [name, { target, package: pkgName }] of desired) {
    const linkPath = join(SKILLS_DIR, name);
    const st = lstatSafe(linkPath);
    if (st && !managed.has(name)) {
      warnings.push(`${name}: already exists in .claude/skills and is not managed — skipped (from ${pkgName}).`);
      continue;
    }
    if (symlinkPointsTo(linkPath, target)) {
      managed.add(name);
      kept.push(name);
      continue;
    }
    if (!DRY_RUN) {
      mkdirSync(SKILLS_DIR, { recursive: true });
      if (st) unlinkSync(linkPath); // managed but stale — relink
      symlinkSync(relative(SKILLS_DIR, target), linkPath);
    }
    managed.add(name);
    added.push(name);
  }

  // Persist state — but never create .claude/skills in a project with nothing to manage.
  if (!DRY_RUN && (managed.size > 0 || existsSync(MANIFEST_PATH))) {
    mkdirSync(SKILLS_DIR, { recursive: true });
    saveManifest(managed);
    writeGitignore(managed);
  }

  return { added, removed, kept, warnings };
}

// ---- entry ----

// Only act inside an AntelopeJS project — this makes the script a safe
// unconditional hook (SessionStart / PostToolUse) in any directory.
if (!CONFIG_VARIANTS.some((f) => existsSync(join(cwd, f)))) {
  log("Not an AntelopeJS project (no antelope.config.*); nothing to do.");
  if (JSON_OUT) console.log(JSON.stringify({ project: false, added: [], removed: [], kept: [] }));
  process.exit(0);
}

const result = sync();
for (const w of result.warnings) warn(w);

if (JSON_OUT) {
  console.log(JSON.stringify({ project: true, dryRun: DRY_RUN, ...result }));
} else if (!QUIET) {
  const verb = DRY_RUN ? "would add" : "add";
  const verbRm = DRY_RUN ? "would remove" : "remove";
  for (const name of result.added) log(`${verb}    .claude/skills/${name}`);
  for (const name of result.removed) log(`${verbRm} .claude/skills/${name}`);
  log(
    `${result.added.length} added, ${result.removed.length} removed, ${result.kept.length} up to date.`,
  );
}
