import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isRecord, isText } from "../values.mjs";
import {
  baseUrlOf,
  entriesOf,
  isDirectorySafe,
  nameOf,
  shortModuleName,
  typesTarget,
} from "./support.mjs";

/**
 * @typedef {import("./support.mjs").PackageEntry} PackageEntry
 */

/**
 * @typedef {object} InterfacePart One importable `.d.ts` of an interface.
 * @property {string} subpath
 * @property {string} import
 * @property {string} dts
 */

/**
 * Resolve a `.d.ts` from an exports target (object/string) or a typesVersions
 * value (array of paths).
 * @param {string} dir
 * @param {unknown} target
 * @returns {string | null}
 */
function dtsForTarget(dir, target) {
  /** @type {unknown} */
  let rel = null;
  if (Array.isArray(target)) rel = target[0];
  else if (isRecord(target)) rel = target.types;
  else if (isText(target)) rel = target;
  if (!rel) return null;
  const resolved = join(dir, rel);
  return existsSync(resolved) ? resolved : null;
}

/**
 * All importable subpaths of an interface PACKAGE (kind 1), each mapped to the
 * .d.ts it resolves to. Merges explicit `exports`, `typesVersions`, and — when a
 * `./*` wildcard is present — the actual .d.ts files in its target directory.
 * @param {PackageEntry} entry
 * @returns {InterfacePart[]}
 */
export function subpaths(entry) {
  const dir = entry.dir;
  /** @type {Map<string, string>} */
  const found = new Map();
  /**
   * @param {string} sub
   * @param {string | null} dts
   */
  const add = (sub, dts) => {
    const key = sub === "." ? "." : sub.replace(/^\.\//, "");
    if (dts && !found.has(key)) found.set(key, dts);
  };

  /** @type {string | null} */
  let wildcardTypes = null;
  for (const [sub, target] of entriesOf(entry.pkg.exports)) {
    if (sub === "./package.json") continue;
    if (sub.includes("*")) {
      if (isRecord(target) && target.types)
        wildcardTypes = typesTarget(target.types);
      continue;
    }
    add(sub, dtsForTarget(dir, target));
  }

  const typesVersions = entry.pkg.typesVersions;
  for (const [sub, target] of entriesOf(
    isRecord(typesVersions) ? typesVersions["*"] : undefined,
  )) {
    if (sub.includes("*")) continue;
    add(sub, dtsForTarget(dir, target));
  }

  if (wildcardTypes) {
    const distDir = join(
      dir,
      wildcardTypes.replace(/\/[^/]*\*[^/]*$/, "").replace(/^\.\//, ""),
    );
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
      import:
        subpath === "." ? nameOf(entry.pkg) : `${nameOf(entry.pkg)}/${subpath}`,
      dts,
    }))
    .sort((a, b) =>
      a.subpath === "."
        ? -1
        : b.subpath === "."
          ? 1
          : a.subpath.localeCompare(b.subpath),
    );
}

/**
 * The interface "groups" a host package exposes: a directory under
 * `<baseUrl>/interfaces/<group>` (or the singular `<baseUrl>/interface`). Returns
 * [{ name, sub }] where `sub` is the import subpath of the group's entry point.
 * @param {PackageEntry} entry
 * @returns {{ name: string, sub: string }[]}
 */
export function dmsGroups(entry) {
  /** @type {Map<string, string>} */
  const groups = new Map();
  const keys = entriesOf(entry.pkg.exports).map(([key]) => key);
  for (const key of keys) {
    if (key === "." || key === "./package.json") continue;
    const sub = key.replace(/^\.\//, "");
    if (sub === "interface") {
      groups.set(shortModuleName(nameOf(entry.pkg)), "interface");
      continue;
    }
    const m = sub.match(/^interfaces\/([^/*]+)/);
    if (m && !groups.has(m[1])) groups.set(m[1], `interfaces/${m[1]}`);
  }
  if (keys.some((k) => k.startsWith("./interfaces/") && k.includes("*"))) {
    const dir = join(entry.dir, baseUrlOf(entry.pkg), "interfaces");
    if (isDirectorySafe(dir)) {
      for (const e of readdirSync(dir)) {
        if (isDirectorySafe(join(dir, e)) && !groups.has(e))
          groups.set(e, `interfaces/${e}`);
      }
    }
  }
  return [...groups].map(([name, sub]) => ({ name, sub }));
}

/**
 * The importable parts of one host interface group: every .d.ts under its dir
 * (depth-limited), as { subpath, import, dts } with the index folded to '.'.
 * @param {PackageEntry} entry
 * @param {string} groupSub
 * @returns {InterfacePart[]}
 */
export function dmsGroupParts(entry, groupSub) {
  const base = baseUrlOf(entry.pkg);
  const root = join(entry.dir, base, groupSub);
  /** @type {InterfacePart[]} */
  const parts = [];
  /**
   * @param {string} dir
   * @param {string} rel
   * @param {number} depth
   * @returns {void}
   */
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
        import:
          subpath === "."
            ? `${nameOf(entry.pkg)}/${groupSub}`
            : `${nameOf(entry.pkg)}/${groupSub}/${subpath}`,
        dts: full,
      });
    }
  };
  walk(root, "", 2);
  return parts.sort((a, b) =>
    a.subpath === "."
      ? -1
      : b.subpath === "."
        ? 1
        : a.subpath.localeCompare(b.subpath),
  );
}

const DECL_RE =
  /^export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(class|interface|type|enum|const|function|namespace|let|var)\s+([A-Za-z0-9_]+)/;
const DEFAULT_RE = /^export\s+default\s+([A-Za-z0-9_]+)\s*;/;
const REEXPORT_RE = /^export\s*\{([^}]*)\}\s*(?:from\b|;)/;
/**
 * `export * from "./form"` / `export * as NS from "./x"` — barrel index files
 * (e.g. a group's index) aggregate their parts this way; surface the source so
 * the index isn't reported as empty.
 */
const REEXPORT_STAR_RE =
  /^export\s+\*\s+(?:as\s+([A-Za-z0-9_]+)\s+)?from\s*["']([^"']+)["']/;

/**
 * @param {string} token
 * @returns {string}
 */
function reexportName(token) {
  const aliased = token.match(/\bas\s+([A-Za-z0-9_]+)/);
  if (aliased) return aliased[1];
  return token.replace(/^type\s+/, "").trim();
}

/**
 * Lightweight symbol extraction from a .d.ts (no TS dependency).
 * @param {string} dtsPath
 * @returns {{ kind: string, name: string }[]}
 */
export function exportedSymbols(dtsPath) {
  if (!dtsPath || !existsSync(dtsPath)) return [];
  /** @type {{ kind: string, name: string }[]} */
  const out = [];
  /** @type {Set<string>} */
  const seen = new Set();
  /**
   * @param {string} kind
   * @param {string} name
   */
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
    if (star)
      push(
        "re-export",
        star[1] ? `${star[1]} (* from ${star[2]})` : `* from ${star[2]}`,
      );
  }
  return out;
}
