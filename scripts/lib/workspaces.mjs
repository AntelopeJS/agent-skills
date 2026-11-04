/**
 * The directories a repository root declares as workspace packages, through
 * its pnpm-workspace.yaml or the `workspaces` of its package.json.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  fieldOf,
  isDirectorySafe,
  readJsonSafe,
  readTextSafe,
  readdirSafe,
} from "./safe-read.mjs";
import { isText } from "./values.mjs";

const WORKSPACE_FILE = "pnpm-workspace.yaml";
const RECURSIVE_GLOB_DEPTH = 3;

/**
 * @param {string} dir
 * @returns {boolean}
 */
export function declaresWorkspaces(dir) {
  if (existsSync(join(dir, WORKSPACE_FILE))) return true;
  return Boolean(
    fieldOf(readJsonSafe(join(dir, "package.json")), "workspaces"),
  );
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function pnpmWorkspaceGlobs(root) {
  const lines = readTextSafe(join(root, WORKSPACE_FILE)).split("\n");
  const start = lines.findIndex((line) => /^packages:\s*$/.test(line));
  if (start < 0) return [];
  /** @type {string[]} */
  const globs = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const match = line.match(/^\s*-\s*["']?([^"'#]+?)["']?\s*(#.*)?$/);
    if (match) globs.push(match[1]);
  }
  return globs;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function packageJsonWorkspaceGlobs(root) {
  const workspaces = fieldOf(
    readJsonSafe(join(root, "package.json")),
    "workspaces",
  );
  const globs = Array.isArray(workspaces)
    ? workspaces
    : fieldOf(workspaces, "packages");
  return Array.isArray(globs) ? globs.filter(isText) : [];
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function childDirs(dir) {
  return readdirSafe(dir)
    .filter((entry) => !entry.startsWith(".") && entry !== "node_modules")
    .map((entry) => join(dir, entry))
    .filter(isDirectorySafe);
}

/**
 * @param {string} dir
 * @param {number} depth
 * @returns {string[]}
 */
function descendantDirs(dir, depth) {
  if (depth === 0) return [];
  return childDirs(dir).flatMap((child) => [
    child,
    ...descendantDirs(child, depth - 1),
  ]);
}

/**
 * Supports the glob forms workspaces use in practice: `dir`, `dir/*`, `dir/**`.
 * @param {string} root
 * @param {string} glob
 * @returns {string[]}
 */
function expandWorkspaceGlob(root, glob) {
  if (glob.startsWith("!")) return [];
  const clean = glob.replace(/^\.\//, "").replace(/\/$/, "");
  if (clean.endsWith("/**"))
    return descendantDirs(join(root, clean.slice(0, -3)), RECURSIVE_GLOB_DEPTH);
  if (clean.endsWith("/*")) return childDirs(join(root, clean.slice(0, -2)));
  return [join(root, clean)];
}

/**
 * @param {string} root
 * @returns {string[]}
 */
export function workspacePackageDirs(root) {
  const globs = [
    ...pnpmWorkspaceGlobs(root),
    ...packageJsonWorkspaceGlobs(root),
  ];
  return globs.flatMap((glob) => expandWorkspaceGlob(root, glob));
}
