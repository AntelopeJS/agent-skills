import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readJsonSafe } from "../safe-read.mjs";
import { isRecord, isText } from "../values.mjs";
import {
  DMS_DIRS,
  INTERFACE_PKG_RE,
  PUBLIC_SCOPE,
  SHORT_PREFIX,
  entriesOf,
  isDirectorySafe,
  nameOf,
  readManifest,
} from "./support.mjs";

/**
 * @typedef {import("./support.mjs").PackageEntry} PackageEntry
 */

/**
 * The project's own dependencies + optionalDependencies (empty outside a project).
 * @returns {string[]}
 */
function projectDependencyNames() {
  const pkg = readJsonSafe(join(process.cwd(), "package.json"));
  if (!isRecord(pkg)) return [];
  return Object.keys({
    ...(isRecord(pkg.dependencies) ? pkg.dependencies : null),
    ...(isRecord(pkg.optionalDependencies) ? pkg.optionalDependencies : null),
  });
}

/**
 * @param {string} raw
 * @returns {string | null}
 */
function normalizeScope(raw) {
  const s = raw.trim().replace(/^@/, "");
  return s ? `@${s}` : null;
}

/** @type {string[] | null} */
let scopeCache = null;
/**
 * npm scopes that bare interface names resolve against. The framework's public
 * scope is always first; the rest are discovered from the current project's
 * dependencies (a project depending on `@acme/interface-x` evidently resolves
 * `@acme` through its .npmrc), plus AJS_INTERFACE_SCOPES (comma-separated,
 * with or without the leading @).
 * @returns {string[]}
 */
export function candidateScopes() {
  if (scopeCache) return scopeCache;
  const scopes = [PUBLIC_SCOPE];
  /** @param {string | null} scope */
  const add = (scope) => {
    if (scope && !scopes.includes(scope)) scopes.push(scope);
  };
  for (const dep of projectDependencyNames()) {
    if (INTERFACE_PKG_RE.test(dep)) add(dep.slice(0, dep.indexOf("/")));
  }
  for (const s of (process.env.AJS_INTERFACE_SCOPES || "").split(",")) {
    if (s.trim()) add(normalizeScope(s));
  }
  scopeCache = scopes;
  return scopes;
}

/**
 * Scope directories under the CLI's module cache (`.antelope/cache/@scope/pkg`),
 * plus the cache root itself for non-scoped entries (`.antelope/cache/pkg`).
 * @returns {string[]}
 */
function cacheScopeRoots() {
  const cache = join(process.cwd(), ".antelope", "cache");
  if (!isDirectorySafe(cache)) return [];
  const roots = [cache];
  for (const entry of readdirSync(cache)) {
    if (entry.startsWith("@") && isDirectorySafe(join(cache, entry)))
      roots.push(join(cache, entry));
  }
  return roots;
}

/**
 * @returns {string[]}
 */
function discoveryRoots() {
  const roots = [];
  if (process.env.AJS_INTERFACES_DIR) {
    roots.push(...process.env.AJS_INTERFACES_DIR.split(":").filter(Boolean));
  }
  for (const scope of candidateScopes()) {
    roots.push(join(process.cwd(), "node_modules", scope));
  }
  roots.push(...cacheScopeRoots());
  return roots.filter(isDirectorySafe);
}

/**
 * @param {string} dir
 * @returns {boolean}
 */
function isInterfacePackage(dir) {
  const pkg = readJsonSafe(join(dir, "package.json"));
  return isRecord(pkg) && isText(pkg.name) && INTERFACE_PKG_RE.test(pkg.name);
}

/** @type {Map<string, PackageEntry> | null} */
let interfaceCache = null;
/**
 * @returns {Map<string, PackageEntry>} The interface packages found on disk, by package name.
 */
export function discoverInterfaces() {
  if (interfaceCache) return interfaceCache;
  /** @type {Map<string, PackageEntry>} */
  const found = new Map();
  for (const root of discoveryRoots()) {
    for (const entry of readdirSync(root)) {
      const dir = join(root, entry);
      if (!isDirectorySafe(dir) || !isInterfacePackage(dir)) continue;
      const pkg = readManifest(join(dir, "package.json"));
      const name = nameOf(pkg);
      if (!found.has(name)) found.set(name, { dir, pkg });
    }
  }
  interfaceCache = found;
  return found;
}

/**
 * Full package names a raw name may refer to. A fully-scoped input is taken as
 * is; a bare/short name is tried as `interface-<name>` in the public scope
 * first, then in every discovered scope.
 * @param {string} rawName
 * @returns {string[]}
 */
export function candidateFullNames(rawName) {
  if (rawName.startsWith("@")) return [rawName];
  const short = rawName.startsWith(SHORT_PREFIX)
    ? rawName.slice(SHORT_PREFIX.length)
    : rawName;
  return candidateScopes().map((scope) => `${scope}/${SHORT_PREFIX}${short}`);
}

/**
 * @param {string} rawName
 * @returns {PackageEntry | null}
 */
export function findLocalInterface(rawName) {
  for (const c of candidateFullNames(rawName)) {
    const hit = discoverInterfaces().get(c);
    if (hit) return hit;
  }
  return null;
}

/**
 * A host package exposes interfaces as export subpaths instead of being one
 * interface itself. It marks itself with a truthy `antelopeJs.dms`, exports
 * `./interfaces/<group>` entry points, or a module's singular `./interface`.
 * @param {import("./support.mjs").PackageManifest} pkg
 * @returns {boolean}
 */
function isDmsHost(pkg) {
  const antelopeJs = pkg.antelopeJs;
  if (isRecord(antelopeJs) && antelopeJs.dms) return true;
  return entriesOf(pkg.exports).some(
    ([k]) => k === "./interface" || k.startsWith("./interfaces/"),
  );
}

/**
 * A package by name as installed in the current project: node_modules first,
 * then the CLI's `.antelope/cache` (modules from antelope.config live there).
 * @param {string} pkgName
 * @returns {PackageEntry | null}
 */
function installedPackageEntry(pkgName) {
  const parts = pkgName.split("/");
  const bases = [
    join(process.cwd(), "node_modules"),
    join(process.cwd(), ".antelope", "cache"),
  ];
  for (const base of bases) {
    const dir = join(base, ...parts);
    const pkg = readJsonSafe(join(dir, "package.json"));
    if (isRecord(pkg)) return { dir, pkg };
  }
  return null;
}

/** @type {Map<string, PackageEntry> | null} */
let dmsHostCache = null;
/**
 * The host packages found in the project's dependencies, in the modules the CLI
 * cached for antelope.config, and in the source checkouts under AJS_DMS_DIR and
 * the cwd, by package name.
 * @returns {Map<string, PackageEntry>}
 */
export function discoverDmsHosts() {
  if (dmsHostCache) return dmsHostCache;
  /** @type {Map<string, PackageEntry>} */
  const found = new Map();
  /** @param {PackageEntry | null} entry */
  const consider = (entry) => {
    const name = entry ? nameOf(entry.pkg) : "";
    if (entry && isDmsHost(entry.pkg) && name && !found.has(name)) {
      found.set(name, entry);
    }
  };

  for (const dep of projectDependencyNames())
    consider(installedPackageEntry(dep));

  for (const root of cacheScopeRoots()) {
    for (const entry of readdirSync(root)) {
      const dir = join(root, entry);
      if (!isDirectorySafe(dir)) continue;
      const pkg = readJsonSafe(join(dir, "package.json"));
      if (isRecord(pkg)) consider({ dir, pkg });
    }
  }

  const skip = new Set(["node_modules", "dist", ".git"]);
  /**
   * @param {string} dir
   * @param {number} depth
   * @returns {void}
   */
  const walk = (dir, depth) => {
    if (depth < 0 || !isDirectorySafe(dir)) return;
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = readJsonSafe(pkgPath);
      if (isRecord(pkg)) {
        consider({ dir, pkg });
        if (isDmsHost(pkg)) return;
      }
    }
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip.has(e) || e.startsWith(".")) continue;
      walk(join(dir, e), depth - 1);
    }
  };
  for (const root of DMS_DIRS) walk(root, 4);
  dmsHostCache = found;
  return found;
}

/**
 * @param {string} pkgName
 * @returns {PackageEntry | null}
 */
export function findLocalPackage(pkgName) {
  return (
    installedPackageEntry(pkgName) ?? discoverDmsHosts().get(pkgName) ?? null
  );
}
