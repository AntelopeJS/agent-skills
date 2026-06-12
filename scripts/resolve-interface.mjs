#!/usr/bin/env node
// Layer 3 resolver for the AntelopeJS knowledge plugin.
//
// Interface contracts are *data*, not prose: they live in the versioned packages
// that ship them. This script reads that source of truth on demand so the skills
// never hand-maintain (and never stale) per-interface docs.
//
// Two shapes of interface are supported:
//   1. Dedicated interface packages — `@antelopejs/interface-<name>`. The whole
//      package is one interface; its `exports` subpaths are its parts.
//   2. CMS-style interfaces — exposed as SUBPATHS of a host package, e.g.
//      `@antelopejs-private/cms/interfaces/cms-base`, a module's
//      `@antelopejs-private/cms-automation/interfaces/cms-automation`, or
//      cms-audit's singular `@antelopejs-private/cms-audit/interface`. One host
//      package hosts many interface "groups" under `dist/interfaces/<group>/`.
//
// Source of truth is the registry (npm) — no local checkout required. Published
// tarballs ship the built `.d.ts`, so the script fetches `<pkg>@<version>` on
// demand, caches the extracted tarball, and reads it. `npm` honours the user's
// `.npmrc`, so private scopes (e.g. `@antelopejs-private`) resolve too. A locally
// present copy is used as an offline fast-path when available, never required.
//
// Naming the interface:
//   database | interface-database | @antelopejs/interface-database     (kind 1)
//   @antelopejs-private/cms/interfaces/cms-base                         (kind 2, full)
//   @antelopejs-private/cms/interfaces/cms-base/form                    (kind 2, a part)
//   @antelopejs-private/cms-audit/interface                            (kind 2, singular)
//   cms:cms-base   ==  @antelopejs-private/cms/interfaces/cms-base      (shorthand)
//   cms-base       (bare — resolved against known CMS host packages)
// Any of the above may carry `@<version>` on the package (default: dist-tag latest).
//
// Flags: --remote (force a fresh npm fetch), --offline (local only, no network),
//        --json (machine output for list/show).
// Env: AJS_INTERFACES_DIR (extra local interface-package roots, colon-sep),
//      AJS_CMS_PACKAGES (extra CMS host package names, comma-sep),
//      AJS_CMS_DIR (local CMS source roots to scan, colon-sep),
//      AJS_RESOLVER_CACHE (tarball cache dir), AJS_RESOLVER_OFFLINE=1 (= --offline).
//
// Usage:
//   resolve-interface.mjs list                       Interfaces on npm + any local (incl. CMS)
//   resolve-interface.mjs show <name>[@version]      Metadata + export subpaths + exported symbols
//   resolve-interface.mjs contract <name>[@version] [subpath]   Print the raw .d.ts for a part ('.' default)
//   resolve-interface.mjs versions <name>            Published versions + dist-tag latest
//   resolve-interface.mjs implementations <name>     Known implementations (registry manifest; n/a for CMS)

import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

const PKG_PREFIX = "@antelopejs/interface-";
const SHORT_PREFIX = "interface-";
const CACHE_ROOT =
  process.env.AJS_RESOLVER_CACHE || join(homedir(), ".cache", "ajs-interface-resolver");

// CMS host packages: the default backend, plus any named via env, plus any found
// locally (a package whose package.json carries `antelopeJs.cms`).
const CMS_DEFAULT_HOST = "@antelopejs-private/cms";
const CMS_HOST_SCOPE = "@antelopejs-private/";
const CMS_EXTRA_HOSTS = (process.env.AJS_CMS_PACKAGES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
// Local CMS source roots to scan for host packages: $AJS_CMS_DIR (colon-separated) plus the
// current directory. Defaults to just the cwd — point AJS_CMS_DIR at a CMS checkout to scan it.
const CMS_DIRS = (process.env.AJS_CMS_DIR || "")
  .split(":")
  .filter(Boolean)
  .concat(process.cwd());

// statSync follows symlinks and throws on a dangling one — guard every probe so
// a single broken entry (common in pnpm node_modules) can't crash discovery.
function isDirectorySafe(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function warn(msg) {
  process.stderr.write(`warning: ${msg}\n`);
}

// Split a `name@version` spec. The leading `@` of a scope is at index 0, so a
// version suffix is only present when `@` appears later (e.g. `core@0.0.4`,
// `@antelopejs/interface-core@0.0.4`).
function splitSpec(input) {
  const at = input.lastIndexOf("@");
  if (at > 0) return { rawName: input.slice(0, at), version: input.slice(at + 1) };
  return { rawName: input, version: undefined };
}

function shortName(fullName) {
  return fullName.replace(PKG_PREFIX, "");
}

function shortModuleName(pkgName) {
  return pkgName.slice(pkgName.lastIndexOf("/") + 1);
}

function baseUrlOf(pkg) {
  return pkg.antelopeJs?.baseUrl || "dist";
}

// ---- local discovery (interface packages) ----

function discoveryRoots() {
  const roots = [];
  if (process.env.AJS_INTERFACES_DIR) {
    roots.push(...process.env.AJS_INTERFACES_DIR.split(":").filter(Boolean));
  }
  roots.push(join(process.cwd(), "node_modules", "@antelopejs"));
  // Point AJS_INTERFACES_DIR at a local interfaces checkout for an offline fast-path.
  return roots.filter(isDirectorySafe);
}

function isInterfacePackage(dir) {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    return readJson(pkgPath).name?.startsWith(PKG_PREFIX) === true;
  } catch {
    return false;
  }
}

let interfaceCache = null;
function discoverInterfaces() {
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

function normalizeName(input) {
  let name = input;
  if (name.startsWith(PKG_PREFIX)) name = name.slice(PKG_PREFIX.length);
  else if (name.startsWith(SHORT_PREFIX)) name = name.slice(SHORT_PREFIX.length);
  return `${PKG_PREFIX}${name}`;
}

// ---- local discovery (CMS host packages) ----

function isCmsHost(pkg) {
  return !!(
    pkg &&
    (pkg.antelopeJs?.cms ||
      (typeof pkg.name === "string" && pkg.name.startsWith(`${CMS_HOST_SCOPE}cms`)))
  );
}

let cmsHostCache = null;
function discoverCmsHosts() {
  if (cmsHostCache) return cmsHostCache;
  const found = new Map();
  const skip = new Set(["node_modules", "dist", ".git"]);
  const walk = (dir, depth) => {
    if (depth < 0 || !isDirectorySafe(dir)) return;
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = readJson(pkgPath);
        if (isCmsHost(pkg) && !found.has(pkg.name)) found.set(pkg.name, { dir, pkg });
      } catch {
        /* unreadable package.json — ignore */
      }
      return; // a package root doesn't nest other CMS hosts — stop descending
    }
    let entries;
    try {
      entries = readdirSync(dir); // unreadable dir (EACCES on a system path, etc.) — skip it
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip.has(e) || e.startsWith(".")) continue;
      walk(join(dir, e), depth - 1);
    }
  };
  for (const root of CMS_DIRS) walk(root, 4);
  cmsHostCache = found;
  return found;
}

function findLocalPackage(pkgName) {
  const dir = join(process.cwd(), "node_modules", ...pkgName.split("/"));
  if (existsSync(join(dir, "package.json"))) return { dir, pkg: readJson(join(dir, "package.json")) };
  return discoverCmsHosts().get(pkgName) ?? null;
}

// ---- npm registry layer ----

// Run npm and parse its --json output. Throws on non-zero exit. npm honours the
// user's .npmrc (registry, scope, auth, proxy), so private registries work.
function npm(args) {
  const out = execFileSync("npm", [...args, "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
    timeout: 90_000,
  });
  return JSON.parse(out || "null");
}

function npmErrText(e) {
  return ((e && (e.stderr || e.message)) || "").toString().trim().split("\n").pop();
}

function remoteVersions(fullName) {
  const v = npm(["view", fullName, "versions"]);
  return Array.isArray(v) ? v : v ? [v] : [];
}

function remoteLatest(fullName) {
  try {
    return npm(["view", fullName, "dist-tags"])?.latest ?? null;
  } catch {
    return null;
  }
}

function resolveRemoteVersion(fullName, wanted) {
  if (wanted && wanted !== "latest") {
    const want = wanted.replace(/^v/, "");
    const vs = remoteVersions(fullName);
    if (!vs.includes(want)) {
      throw new Error(
        `version '${wanted}' not published for ${fullName}. Available: ${vs.join(", ") || "(none)"}`,
      );
    }
    return want;
  }
  const latest = remoteLatest(fullName);
  if (latest) return latest;
  const vs = remoteVersions(fullName);
  if (!vs.length) throw new Error(`no published versions for ${fullName}`);
  return vs[vs.length - 1];
}

// Download `<pkg>@<version>` and extract it under the cache. Returns the extracted
// `package/` dir (a drop-in for a local package dir). Cached across runs.
function fetchToCache(fullName, version) {
  const safe = fullName.replace(/^@/, "").replace(/\//g, "__");
  const dest = join(CACHE_ROOT, safe, version);
  const pkgDir = join(dest, "package");
  if (existsSync(join(pkgDir, "package.json"))) return pkgDir;

  mkdirSync(dest, { recursive: true });
  const packed = npm(["pack", `${fullName}@${version}`, "--pack-destination", dest]);
  const filename = Array.isArray(packed) ? packed[0]?.filename : packed?.filename;
  if (!filename) throw new Error(`npm pack gave no filename for ${fullName}@${version}`);

  execFileSync("tar", ["-xzf", join(dest, filename), "-C", dest], { stdio: "ignore" });
  try {
    rmSync(join(dest, filename));
  } catch {
    /* keep the tarball if it can't be removed — harmless */
  }
  if (!existsSync(join(pkgDir, "package.json"))) {
    throw new Error(`extracted tarball has no package/package.json at ${pkgDir}`);
  }
  return pkgDir;
}

// Resolve any package (interface or CMS host) by full name to a { dir, pkg } entry:
// local copy when present and no version pinned / --remote off, else npm. Throws.
function resolvePackageEntry(fullName, wanted, localLookup) {
  if (!FORCE_REMOTE && !wanted) {
    const hit = localLookup(fullName);
    if (hit) return hit;
  }
  if (OFFLINE) {
    const hit = localLookup(fullName);
    if (hit) return hit;
    throw new Error(`${fullName} is not available locally (offline)`);
  }
  try {
    const version = resolveRemoteVersion(fullName, wanted);
    const dir = fetchToCache(fullName, version);
    return { dir, pkg: readJson(join(dir, "package.json")), remote: true };
  } catch (e) {
    if (!wanted) {
      const hit = localLookup(fullName);
      if (hit) {
        warn(`could not fetch ${fullName} from npm (${npmErrText(e)}); using local copy.`);
        return hit;
      }
    }
    throw e;
  }
}

// Published versions (newest-first) + dist-tag latest. Falls back to a local
// clone's git tags when offline or the registry is unreachable.
function listVersions(fullName, localEntry) {
  if (!OFFLINE) {
    try {
      return { versions: remoteVersions(fullName).slice().reverse(), latest: remoteLatest(fullName) };
    } catch (e) {
      if (!localEntry) throw e;
      warn(`registry lookup failed for ${fullName} (${npmErrText(e)}); using local git tags.`);
    }
  }
  const tags = localEntry ? gitTags(localEntry.dir).map((t) => t.replace(/^v/, "")) : [];
  return { versions: tags, latest: null };
}

// ---- .d.ts surface extraction ----

// Resolve a `.d.ts` from an exports target (object/string) or a typesVersions
// value (array of paths).
function dtsForTarget(dir, target) {
  let rel = null;
  if (Array.isArray(target)) rel = target[0];
  else if (target && typeof target === "object") rel = target.types;
  else if (typeof target === "string") rel = target;
  if (!rel) return null;
  const resolved = join(dir, rel);
  return existsSync(resolved) ? resolved : null;
}

// All importable subpaths of an interface PACKAGE (kind 1), each mapped to the
// .d.ts it resolves to. Merges explicit `exports`, `typesVersions`, and — when a
// `./*` wildcard is present — the actual .d.ts files in its target directory.
function subpaths(entry) {
  const dir = entry.dir;
  const found = new Map(); // subpath -> dts
  const add = (sub, dts) => {
    const key = sub === "." ? "." : sub.replace(/^\.\//, "");
    if (dts && !found.has(key)) found.set(key, dts);
  };

  let wildcardTypes = null;
  for (const [sub, target] of Object.entries(entry.pkg.exports ?? {})) {
    if (sub === "./package.json") continue;
    if (sub.includes("*")) {
      if (target && typeof target === "object" && target.types) wildcardTypes = target.types;
      continue;
    }
    add(sub, dtsForTarget(dir, target));
  }

  for (const [sub, target] of Object.entries(entry.pkg.typesVersions?.["*"] ?? {})) {
    if (sub.includes("*")) continue;
    add(sub, dtsForTarget(dir, target));
  }

  if (wildcardTypes) {
    const distDir = join(dir, wildcardTypes.replace(/\/[^/]*\*[^/]*$/, "").replace(/^\.\//, ""));
    if (isDirectorySafe(distDir)) {
      for (const file of readdirSync(distDir)) {
        if (!file.endsWith(".d.ts")) continue;
        const name = file.slice(0, -".d.ts".length);
        if (name === "index" || name.includes(".test")) continue;
        add(name, join(distDir, file));
      }
    }
  }

  return [...found.entries()]
    .map(([subpath, dts]) => ({
      subpath,
      import: subpath === "." ? entry.pkg.name : `${entry.pkg.name}/${subpath}`,
      dts,
    }))
    .sort((a, b) =>
      a.subpath === "." ? -1 : b.subpath === "." ? 1 : a.subpath.localeCompare(b.subpath),
    );
}

// The interface "groups" a CMS host package exposes: a directory under
// `<baseUrl>/interfaces/<group>` (or the singular `<baseUrl>/interface`). Returns
// [{ name, sub }] where `sub` is the import subpath of the group's entry point.
function cmsGroups(entry) {
  const groups = new Map();
  for (const key of Object.keys(entry.pkg.exports ?? {})) {
    if (key === "." || key === "./package.json") continue;
    const sub = key.replace(/^\.\//, "");
    if (sub === "interface") {
      groups.set(shortModuleName(entry.pkg.name), "interface");
      continue;
    }
    const m = sub.match(/^interfaces\/([^/*]+)/);
    if (m && !groups.has(m[1])) groups.set(m[1], `interfaces/${m[1]}`);
  }
  // A `./interfaces/*` wildcard means undeclared groups exist as dist subdirs.
  if (Object.keys(entry.pkg.exports ?? {}).some((k) => k.startsWith("./interfaces/") && k.includes("*"))) {
    const dir = join(entry.dir, baseUrlOf(entry.pkg), "interfaces");
    if (isDirectorySafe(dir)) {
      for (const e of readdirSync(dir)) {
        if (isDirectorySafe(join(dir, e)) && !groups.has(e)) groups.set(e, `interfaces/${e}`);
      }
    }
  }
  return [...groups].map(([name, sub]) => ({ name, sub }));
}

// The importable parts of one CMS interface group: every .d.ts under its dir
// (depth-limited), as { subpath, import, dts } with the index folded to '.'.
function cmsGroupParts(entry, groupSub) {
  const base = baseUrlOf(entry.pkg);
  const root = join(entry.dir, base, groupSub);
  const parts = [];
  const walk = (dir, rel, depth) => {
    if (!isDirectorySafe(dir)) return;
    for (const f of readdirSync(dir).sort()) {
      const full = join(dir, f);
      if (isDirectorySafe(full)) {
        if (depth > 0) walk(full, rel ? `${rel}/${f}` : f, depth - 1);
        continue;
      }
      if (!f.endsWith(".d.ts") || f.includes(".test")) continue;
      const name = f.slice(0, -".d.ts".length);
      const relPart = name === "index" ? rel : rel ? `${rel}/${name}` : name;
      const subpath = relPart || ".";
      parts.push({
        subpath,
        import: subpath === "." ? `${entry.pkg.name}/${groupSub}` : `${entry.pkg.name}/${groupSub}/${subpath}`,
        dts: full,
      });
    }
  };
  walk(root, "", 2);
  return parts.sort((a, b) =>
    a.subpath === "." ? -1 : b.subpath === "." ? 1 : a.subpath.localeCompare(b.subpath),
  );
}

// Lightweight symbol extraction from a .d.ts (no TS dependency).
const DECL_RE =
  /^export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(class|interface|type|enum|const|function|namespace|let|var)\s+([A-Za-z0-9_]+)/;
const DEFAULT_RE = /^export\s+default\s+([A-Za-z0-9_]+)\s*;/;
const REEXPORT_RE = /^export\s*\{([^}]*)\}\s*(?:from\b|;)/;
// `export * from "./form"` / `export * as NS from "./x"` — barrel index files
// (e.g. cms-base/index) aggregate their parts this way; surface the source so
// the index isn't reported as empty.
const REEXPORT_STAR_RE = /^export\s+\*\s+(?:as\s+([A-Za-z0-9_]+)\s+)?from\s*["']([^"']+)["']/;

function reexportName(token) {
  const aliased = token.match(/\bas\s+([A-Za-z0-9_]+)/);
  if (aliased) return aliased[1];
  return token.replace(/^type\s+/, "").trim();
}

function exportedSymbols(dtsPath) {
  if (!dtsPath || !existsSync(dtsPath)) return [];
  const out = [];
  const seen = new Set();
  const push = (kind, name) => {
    if (!name) return;
    const key = `${kind} ${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, name });
  };
  for (const line of readFileSync(dtsPath, "utf8").split("\n")) {
    const decl = line.match(DECL_RE);
    if (decl) {
      push(decl[1], decl[2]);
      continue;
    }
    const def = line.match(DEFAULT_RE);
    if (def) {
      push("default", def[1]);
      continue;
    }
    const re = line.match(REEXPORT_RE);
    if (re) {
      for (const token of re[1].split(",")) {
        const name = reexportName(token);
        if (name) push("re-export", name);
      }
      continue;
    }
    const star = line.match(REEXPORT_STAR_RE);
    if (star) push("re-export", star[1] ? `${star[1]} (* from ${star[2]})` : `* from ${star[2]}`);
  }
  return out;
}

function gitTags(dir) {
  try {
    return execFileSync("git", ["tag", "--sort=-v:refname"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---- target resolution (interface package OR CMS subpath) ----

// A resolved target: { entry, displayName, versionsPkg, parts, defaultSubpath }.
// `parts` is the uniform [{subpath, import, dts}] list both show/contract consume.

function pkgTarget(entry) {
  return {
    entry,
    displayName: shortName(entry.pkg.name),
    versionsPkg: entry.pkg.name,
    parts: subpaths(entry),
    defaultSubpath: ".",
  };
}

function cmsTarget(entry, group, focusSub) {
  const parts = cmsGroupParts(entry, group.sub);
  const rel = focusSub && focusSub !== group.sub ? focusSub.slice(group.sub.length + 1) : ".";
  return {
    entry,
    displayName: `${entry.pkg.name}/${group.sub}`,
    versionsPkg: entry.pkg.name,
    parts,
    defaultSubpath: rel,
  };
}

// Parse a CMS-style spec into { pkgSpec, interfaceSub } or null. Handles the
// `cms:` shorthand, full `…/interfaces/<group>[/part]` specifiers, and the
// singular `…/interface`.
function parseCmsSpec(input) {
  let spec = input;
  if (spec.startsWith("cms:")) spec = `${CMS_DEFAULT_HOST}/interfaces/${spec.slice(4)}`;
  const at = spec.indexOf("/interfaces/");
  if (at > 0) return { pkgSpec: spec.slice(0, at), interfaceSub: spec.slice(at + 1) };
  if (spec.endsWith("/interface")) {
    return { pkgSpec: spec.slice(0, -"/interface".length), interfaceSub: "interface" };
  }
  return null;
}

function groupForSub(entry, interfaceSub) {
  if (interfaceSub === "interface") return { name: shortModuleName(entry.pkg.name), sub: "interface" };
  const name = interfaceSub.split("/")[1];
  return { name, sub: `interfaces/${name}` };
}

// CMS interface by bare name, resolved against known host packages. Local hosts
// first (offline-friendly), then the default host + `@antelopejs-private/<name>`.
function resolveCmsBare(name) {
  for (const [, entry] of discoverCmsHosts()) {
    const g = cmsGroups(entry).find((g) => g.name === name);
    if (g) return cmsTarget(entry, g);
  }
  const hosts = [CMS_DEFAULT_HOST, `${CMS_HOST_SCOPE}${name}`, ...CMS_EXTRA_HOSTS];
  for (const host of hosts) {
    try {
      const entry = resolvePackageEntry(host, undefined, findLocalPackage);
      const g = cmsGroups(entry).find((g) => g.name === name);
      if (g) return cmsTarget(entry, g);
    } catch {
      /* host not resolvable / no such group — try the next */
    }
  }
  return null;
}

function resolveTarget(input) {
  // Explicit CMS specifier (full path or cms: shorthand).
  const cms = parseCmsSpec(input);
  if (cms) {
    const { rawName: pkg, version } = splitSpec(cms.pkgSpec);
    let entry;
    try {
      entry = resolvePackageEntry(pkg, version, findLocalPackage);
    } catch (e) {
      fail(`could not resolve host package '${pkg}': ${npmErrText(e)}`);
    }
    return cmsTarget(entry, groupForSub(entry, cms.interfaceSub), cms.interfaceSub);
  }

  const { rawName, version } = splitSpec(input);
  const fullName = normalizeName(rawName);

  // Local interface package (no network).
  if (!FORCE_REMOTE && !version) {
    const local = discoverInterfaces().get(fullName);
    if (local) return pkgTarget(local);
    // Local CMS host with a matching group (no network) before reaching out.
    for (const [, entry] of discoverCmsHosts()) {
      const g = cmsGroups(entry).find((g) => g.name === rawName);
      if (g) return cmsTarget(entry, g);
    }
  }

  if (OFFLINE) {
    const local = discoverInterfaces().get(fullName);
    if (local) return pkgTarget(local);
    const cmsHit = resolveCmsBare(rawName);
    if (cmsHit) return cmsHit;
    const known = [...discoverInterfaces().keys()].map(shortName).join(", ");
    fail(`'${input}' is not available locally (offline). Locally present: ${known || "(none)"}.`);
  }

  // Remote interface package.
  try {
    const version2 = resolveRemoteVersion(fullName, version);
    const dir = fetchToCache(fullName, version2);
    return pkgTarget({ dir, pkg: readJson(join(dir, "package.json")), remote: true });
  } catch (interfaceErr) {
    // Not a published interface package — try CMS host resolution by bare name.
    const cmsHit = resolveCmsBare(rawName);
    if (cmsHit) return cmsHit;
    fail(`could not resolve '${input}': ${npmErrText(interfaceErr)}`);
  }
}

// ---- commands ----

function cmsHostsForListing() {
  const hosts = new Map(discoverCmsHosts());
  if (!OFFLINE) {
    for (const name of [CMS_DEFAULT_HOST, ...CMS_EXTRA_HOSTS]) {
      if (hosts.has(name)) continue;
      try {
        hosts.set(name, resolvePackageEntry(name, undefined, findLocalPackage));
      } catch (e) {
        warn(`could not list CMS host ${name} (${npmErrText(e)}).`);
      }
    }
  }
  return hosts;
}

function cmdList(json) {
  const byKey = new Map();
  for (const { pkg } of discoverInterfaces().values()) {
    byKey.set(pkg.name, {
      name: shortName(pkg.name),
      package: pkg.name,
      version: pkg.version,
      description: pkg.description ?? "",
      source: "local",
    });
  }

  if (!OFFLINE) {
    try {
      for (const r of npm(["search", PKG_PREFIX])) {
        if (typeof r.name !== "string" || !r.name.startsWith(PKG_PREFIX) || byKey.has(r.name)) continue;
        byKey.set(r.name, {
          name: shortName(r.name),
          package: r.name,
          version: r.version ?? "",
          description: r.description ?? "",
          source: "npm",
        });
      }
    } catch (e) {
      if (!byKey.size) warn(`npm search failed (${npmErrText(e)}).`);
      else warn(`npm search failed (${npmErrText(e)}); interface-package list may be incomplete.`);
    }
  }

  const cms = [];
  for (const [host, entry] of cmsHostsForListing()) {
    for (const g of cmsGroups(entry)) {
      cms.push({
        name: `${host}/${g.sub}`,
        package: host,
        version: entry.pkg.version,
        description: `CMS interface (${g.name})`,
        source: "cms",
      });
    }
  }

  const rows = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  cms.sort((a, b) => a.name.localeCompare(b.name));
  if (json) return console.log(JSON.stringify([...rows, ...cms], null, 2));

  for (const r of rows) {
    console.log(`${r.name.padEnd(26)} ${(r.version ? `v${r.version}` : "").padEnd(9)} ${r.description}`);
  }
  if (cms.length) {
    console.log("\nCMS interfaces (import path):");
    for (const r of cms) console.log(`  ${r.name.padEnd(52)} ${r.description}`);
  }
}

function cmdShow(input, json) {
  const target = resolveTarget(input);
  const subs = target.parts.map((s) => ({ ...s, symbols: exportedSymbols(s.dts) }));
  let versionInfo = { versions: [], latest: null };
  try {
    versionInfo = listVersions(target.versionsPkg, target.entry.remote ? null : target.entry);
  } catch {
    /* version listing is best-effort */
  }
  const data = {
    name: target.displayName,
    package: target.entry.pkg.name,
    version: target.entry.pkg.version,
    description: target.entry.pkg.description ?? "",
    source: target.entry.remote ? "npm" : "local",
    location: target.entry.dir,
    latest: versionInfo.latest,
    availableVersions: versionInfo.versions,
    subpaths: subs.map((s) => ({ import: s.import, symbols: s.symbols })),
  };
  if (json) return console.log(JSON.stringify(data, null, 2));

  console.log(`${data.name}  (${data.package} v${data.version}${data.source === "npm" ? ", npm" : ""})`);
  if (data.description) console.log(data.description);
  console.log(`${data.source === "npm" ? "cached" : "location"}: ${data.location}`);
  if (data.latest) console.log(`latest: v${data.latest}`);
  if (data.availableVersions.length) {
    console.log(`versions: ${data.availableVersions.map((v) => `v${v}`).join(", ")}`);
  }
  console.log("\nexport surface:");
  for (const s of data.subpaths) {
    console.log(`\n  import "${s.import}"`);
    for (const sym of s.symbols) console.log(`    ${sym.kind.padEnd(9)} ${sym.name}`);
    if (!s.symbols.length) console.log("    (no top-level declarations found)");
  }
  console.log(`\nFull signatures: resolve-interface.mjs contract ${input} [subpath]`);
}

function cmdContract(input, subpath) {
  const target = resolveTarget(input);
  const want = (subpath ?? target.defaultSubpath ?? ".").replace(/^\.\//, "");
  const match = target.parts.find((s) => s.subpath === want);
  if (!match) {
    const avail = target.parts.map((s) => s.subpath).join(", ");
    fail(`No subpath '${want}' for ${target.displayName}. Available: ${avail}`);
  }
  if (!match.dts) fail(`No .d.ts found for subpath '${want}' (is the package built/published?)`);
  process.stdout.write(`// ${match.import}\n// ${match.dts}\n\n`);
  process.stdout.write(readFileSync(match.dts, "utf8"));
}

function cmdVersions(input) {
  // Resolve to a target only to learn the package the versions belong to, but
  // avoid fetching a tarball when we can derive the package name cheaply.
  const cms = parseCmsSpec(input);
  let fullName;
  let localEntry;
  if (cms) {
    fullName = splitSpec(cms.pkgSpec).rawName;
    localEntry = findLocalPackage(fullName);
  } else {
    const { rawName } = splitSpec(input);
    fullName = normalizeName(rawName);
    localEntry = discoverInterfaces().get(fullName);
    if (!localEntry && !discoverInterfaces().has(fullName)) {
      // Could be a bare CMS interface — resolve its host package name.
      const t = resolveTarget(input);
      fullName = t.versionsPkg;
      localEntry = t.entry.remote ? null : t.entry;
    }
  }
  let info;
  try {
    info = listVersions(fullName, localEntry);
  } catch (e) {
    fail(`could not list versions for ${fullName}: ${npmErrText(e)}`);
  }
  if (localEntry) console.log(`installed: v${localEntry.pkg.version}`);
  if (info.latest) console.log(`latest:    v${info.latest}`);
  console.log(info.versions.length ? info.versions.map((v) => `v${v}`).join("\n") : "(no versions found)");
}

async function fetchRegistryManifest(name) {
  for (const branch of ["main", "master"]) {
    const url = `https://raw.githubusercontent.com/AntelopeJS/interfaces/${branch}/interfaces/${name}/manifest.json`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) return await res.json();
    } catch {
      /* try next branch */
    }
  }
  return null;
}

async function cmdImplementations(input) {
  if (parseCmsSpec(input)) {
    console.log(
      `'${input}' is a CMS interface (a subpath of a host package). Implementations are not\n` +
        `tracked in the AntelopeJS interfaces registry — a CMS interface is provided by its\n` +
        `host module directly (antelopeJs.implements in that module's package.json).`,
    );
    return;
  }
  const { rawName } = splitSpec(input);
  const fullName = normalizeName(rawName);
  const name = shortName(fullName);

  const local = discoverInterfaces().get(fullName);
  if (local) {
    const manifest = join(local.dir, "manifest.json");
    if (existsSync(manifest)) {
      const m = readJson(manifest);
      return console.log(JSON.stringify(m.modules ?? m, null, 2));
    }
  }
  if (!OFFLINE) {
    const m = await fetchRegistryManifest(name);
    if (m) return console.log(JSON.stringify(m.modules ?? m, null, 2));
  }
  console.log(
    `No manifest found for ${name}. Implementing modules are listed in the registry at\n` +
      `  AntelopeJS/interfaces.git -> interfaces/${name}/manifest.json\n` +
      `Resolve unresolved imports (and pick a provider) with: ajs project modules install`,
  );
}

// ---- entry ----

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = new Set(argv.slice(1).filter((a) => a.startsWith("--")));
const positional = argv.slice(1).filter((a) => !a.startsWith("--"));
const json = flags.has("--json");
const FORCE_REMOTE = flags.has("--remote");
const OFFLINE =
  flags.has("--offline") || flags.has("--no-remote") || !!process.env.AJS_RESOLVER_OFFLINE;

const COMMANDS = {
  list: () => cmdList(json),
  show: () => cmdShow(positional[0], json),
  contract: () => cmdContract(positional[0], positional[1]),
  versions: () => cmdVersions(positional[0]),
  implementations: () => cmdImplementations(positional[0]),
};

const handler = COMMANDS[cmd];
if (!handler) {
  fail(`unknown command '${cmd ?? ""}'. One of: ${Object.keys(COMMANDS).join(", ")}`);
}
if (cmd !== "list" && !positional[0]) fail(`'${cmd}' requires an interface name`);
await handler();
