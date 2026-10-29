import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isText } from "../values.mjs";
import {
  DMS_DIRS,
  INTERFACE_PKG_RE,
  PUBLIC_SCOPE,
  SHORT_PREFIX,
  isDirectorySafe,
  readJson,
  readJsonSafe,
} from "./support.mjs";

/** The project's own dependencies + optionalDependencies (empty outside a project). */
function projectDependencyNames() {
  const pkg = readJsonSafe(join(process.cwd(), "package.json"));
  if (!pkg) return [];
  return Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies });
}

function normalizeScope(raw) {
  const s = raw.trim().replace(/^@/, "");
  return s ? `@${s}` : null;
}

/**
 * npm scopes that bare interface names resolve against. The framework's public
 * scope is always first; the rest are discovered from the current project's
 * dependencies (a project depending on `@acme/interface-x` evidently resolves
 * `@acme` through its .npmrc), plus AJS_INTERFACE_SCOPES (comma-separated,
 * with or without the leading @).
 */
let scopeCache = null;
export function candidateScopes() {
  if (scopeCache) return scopeCache;
  const scopes = [PUBLIC_SCOPE];
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

function isInterfacePackage(dir) {
  const pkg = readJsonSafe(join(dir, "package.json"));
  return isText(pkg?.name) && INTERFACE_PKG_RE.test(pkg.name);
}

let interfaceCache = null;
export function discoverInterfaces() {
  if (interfaceCache) return interfaceCache;
  const found = new Map();
  for (const root of discoveryRoots()) {
    for (const entry of readdirSync(root)) {
      const dir = join(root, entry);
      if (!isDirectorySafe(dir) || !isInterfacePackage(dir)) continue;
      const pkg = readJson(join(dir, "package.json"));
      if (!found.has(pkg.name)) found.set(pkg.name, { dir, pkg });
    }
  }
  interfaceCache = found;
  return found;
}

/**
 * Full package names a raw name may refer to. A fully-scoped input is taken as
 * is; a bare/short name is tried as `interface-<name>` in the public scope
 * first, then in every discovered scope.
 */
export function candidateFullNames(rawName) {
  if (rawName.startsWith("@")) return [rawName];
  const short = rawName.startsWith(SHORT_PREFIX)
    ? rawName.slice(SHORT_PREFIX.length)
    : rawName;
  return candidateScopes().map((scope) => `${scope}/${SHORT_PREFIX}${short}`);
}

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
 */
function isDmsHost(pkg) {
  if (!pkg) return false;
  if (pkg.antelopeJs?.dms) return true;
  return Object.keys(pkg.exports ?? {}).some(
    (k) => k === "./interface" || k.startsWith("./interfaces/"),
  );
}

/**
 * A package by name as installed in the current project: node_modules first,
 * then the CLI's `.antelope/cache` (modules from antelope.config live there).
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
    if (pkg) return { dir, pkg };
  }
  return null;
}

let dmsHostCache = null;
/**
 * The host packages found in the project's dependencies, in the modules the CLI
 * cached for antelope.config, and in the source checkouts under AJS_DMS_DIR and
 * the cwd, by package name.
 */
export function discoverDmsHosts() {
  if (dmsHostCache) return dmsHostCache;
  const found = new Map();
  const consider = (entry) => {
    if (
      entry &&
      isDmsHost(entry.pkg) &&
      entry.pkg.name &&
      !found.has(entry.pkg.name)
    ) {
      found.set(entry.pkg.name, entry);
    }
  };

  for (const dep of projectDependencyNames())
    consider(installedPackageEntry(dep));

  for (const root of cacheScopeRoots()) {
    for (const entry of readdirSync(root)) {
      const dir = join(root, entry);
      if (!isDirectorySafe(dir)) continue;
      const pkg = readJsonSafe(join(dir, "package.json"));
      if (pkg) consider({ dir, pkg });
    }
  }

  const skip = new Set(["node_modules", "dist", ".git"]);
  const walk = (dir, depth) => {
    if (depth < 0 || !isDirectorySafe(dir)) return;
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = readJsonSafe(pkgPath);
      consider({ dir, pkg });
      if (isDmsHost(pkg)) return;
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

export function findLocalPackage(pkgName) {
  return (
    installedPackageEntry(pkgName) ?? discoverDmsHosts().get(pkgName) ?? null
  );
}
