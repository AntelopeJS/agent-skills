import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { collectSkillPackages } from "../../packages/agent-skills/index.mjs";
import { isText } from "./values.mjs";

const WORKSPACE_FILE = "pnpm-workspace.yaml";
const RECURSIVE_GLOB_DEPTH = 3;
const ORIGIN = {
  workspace: "workspace",
  nodeModules: "node_modules",
  cache: "antelope-cache",
  dependency: "dependency",
};

export function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** @returns {string} */
export function readTextSafe(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** @returns {boolean} */
export function isDirectorySafe(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** @returns {string[]} */
export function readdirSafe(path) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function declaresWorkspaces(dir) {
  if (existsSync(join(dir, WORKSPACE_FILE))) return true;
  return Boolean(readJsonSafe(join(dir, "package.json"))?.workspaces);
}

function isBoundary(dir) {
  return existsSync(join(dir, ".git")) || declaresWorkspaces(dir);
}

/**
 * The cwd and its ancestors up to the nearest repository or workspace root;
 * only the cwd when no such root exists.
 * @returns {string[]}
 */
function ancestorDirs(cwd) {
  /** @type {string[]} */
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
  return Array.isArray(globs) ? globs.filter(isText) : [];
}

function childDirs(dir) {
  return readdirSafe(dir)
    .filter((entry) => !entry.startsWith(".") && entry !== "node_modules")
    .map((entry) => join(dir, entry))
    .filter(isDirectorySafe);
}

function descendantDirs(dir, depth) {
  if (depth === 0) return [];
  return childDirs(dir).flatMap((child) => [
    child,
    ...descendantDirs(child, depth - 1),
  ]);
}

/** Supports the glob forms workspaces use in practice: `dir`, `dir/*`, `dir/**`. */
function expandWorkspaceGlob(root, glob) {
  if (glob.startsWith("!")) return [];
  const clean = glob.replace(/^\.\//, "").replace(/\/$/, "");
  if (clean.endsWith("/**"))
    return descendantDirs(join(root, clean.slice(0, -3)), RECURSIVE_GLOB_DEPTH);
  if (clean.endsWith("/*")) return childDirs(join(root, clean.slice(0, -2)));
  return [join(root, clean)];
}

function workspacePackageDirs(root) {
  const globs = [
    ...pnpmWorkspaceGlobs(root),
    ...packageJsonWorkspaceGlobs(root),
  ];
  return globs.flatMap((glob) => expandWorkspaceGlob(root, glob));
}

/**
 * Direct children of a package root: <root>/<pkg> and <root>/@scope/<pkg>.
 * @returns {string[]}
 */
function packagesIn(base) {
  /** @type {string[]} */
  const dirs = [];
  for (const entry of readdirSafe(base)) {
    if (entry.startsWith(".")) continue;
    const path = join(base, entry);
    if (!entry.startsWith("@")) dirs.push(path);
    else
      dirs.push(
        ...readdirSafe(path)
          .filter((e) => !e.startsWith("."))
          .map((e) => join(path, e)),
      );
  }
  return dirs;
}

/**
 * Where a skill package was found, in the words the plugin's output uses: a
 * module is a workspace package unless it came from `.antelope/cache`.
 */
function originOf(skillPackage, workspace) {
  if (skillPackage.kind === "dependency") return ORIGIN.dependency;
  if (skillPackage.kind === "installed") return ORIGIN.nodeModules;
  return workspace.has(skillPackage.dir) ? ORIGIN.workspace : ORIGIN.cache;
}

/**
 * The packages shipping skills that a project can see, in priority order: the
 * workspace and the modules `ajs` cached, their dependencies, then whatever
 * `node_modules` holds.
 */
export function candidatePackages(cwd, onWarning) {
  const ancestors = ancestorDirs(cwd);
  const root = ancestors[ancestors.length - 1];
  const workspace = [...ancestors, ...workspacePackageDirs(root)];
  const cache = packagesIn(join(cwd, ".antelope", "cache"));
  const installed = [...new Set([cwd, root])].flatMap((dir) =>
    packagesIn(join(dir, "node_modules")),
  );
  const workspaceDirs = new Set(workspace);
  return collectSkillPackages({
    modules: [...workspace, ...cache].map((dir) => ({ dir })),
    installed,
    onWarning,
  }).map((skillPackage) => ({
    ...skillPackage,
    origin: originOf(skillPackage, workspaceDirs),
  }));
}
