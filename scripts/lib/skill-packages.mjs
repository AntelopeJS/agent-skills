import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { collectSkillPackages } from "../../packages/agent-skills/index.mjs";
import { fieldOf, readJsonSafe, readdirSafe } from "./safe-read.mjs";
import { declaresWorkspaces, workspacePackageDirs } from "./workspaces.mjs";

/**
 * @typedef {import("../../packages/agent-skills/index.js").SkillPackage} SkillPackage
 */

/**
 * @typedef {SkillPackage & { origin: string }} OriginSkillPackage
 */

const ORIGIN = {
  workspace: "workspace",
  nodeModules: "node_modules",
  cache: "antelope-cache",
  dependency: "dependency",
};

/**
 * @param {string} dir
 * @returns {boolean}
 */
function isBoundary(dir) {
  return existsSync(join(dir, ".git")) || declaresWorkspaces(dir);
}

/**
 * The cwd and its ancestors up to the nearest repository or workspace root;
 * only the cwd when no such root exists.
 * @param {string} cwd
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

/**
 * Direct children of a package root: <root>/<pkg> and <root>/@scope/<pkg>.
 * @param {string} base
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
 * @param {SkillPackage} skillPackage
 * @param {Set<string>} workspace
 * @param {Set<string>} cache
 * @returns {string}
 */
function originOf(skillPackage, workspace, cache) {
  if (skillPackage.kind === "dependency") return ORIGIN.dependency;
  if (workspace.has(skillPackage.dir)) return ORIGIN.workspace;
  return cache.has(skillPackage.dir) ? ORIGIN.cache : ORIGIN.nodeModules;
}

/**
 * An installed package that implements an interface is a module `ajs` can run.
 * @param {string} dir
 * @returns {boolean}
 */
function isInstalledModule(dir) {
  return Boolean(
    fieldOf(
      fieldOf(readJsonSafe(join(dir, "package.json")), "antelopeJs"),
      "implements",
    ),
  );
}

/**
 * The packages shipping skills that a project can see, in priority order: the
 * workspace and the modules `ajs` cached, their dependencies, then whatever
 * `node_modules` holds.
 * @param {string} cwd
 * @param {(message: string) => void} onWarning
 * @returns {OriginSkillPackage[]}
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
  const cacheDirs = new Set(cache);
  return collectSkillPackages({
    modules: [
      ...workspace,
      ...cache,
      ...installed.filter(isInstalledModule),
    ].map((dir) => ({ dir })),
    installed,
    onWarning,
  }).map((skillPackage) => ({
    ...skillPackage,
    origin: originOf(skillPackage, workspaceDirs, cacheDirs),
  }));
}
