import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { isRecord, isText } from "../values.mjs";

/**
 * @typedef {Record<string, unknown>} PackageManifest The parsed `package.json` of a package.
 */

/**
 * @typedef {object} PackageEntry A package found on disk, or fetched into the cache.
 * @property {string} dir
 * @property {PackageManifest} pkg
 * @property {boolean} [remote] Whether it was fetched from the registry.
 */

export const PUBLIC_SCOPE = "@antelopejs";
export const PKG_PREFIX = `${PUBLIC_SCOPE}/interface-`;
export const SHORT_PREFIX = "interface-";
export const INTERFACE_PKG_RE = /^@[^/]+\/interface-/;
export const CACHE_ROOT =
  process.env.AJS_RESOLVER_CACHE ||
  join(homedir(), ".cache", "ajs-interface-resolver");

/**
 * Host packages named explicitly via env — package names whose interface
 * subpaths should resolve even when the host is not discoverable from the
 * current project.
 */
export const DMS_EXTRA_HOSTS = (process.env.AJS_DMS_PACKAGES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
/**
 * Local host source roots to scan for host packages: $AJS_DMS_DIR (colon-separated) plus the
 * current directory. Defaults to just the cwd — point AJS_DMS_DIR at a host checkout to scan it.
 */
export const DMS_DIRS = (process.env.AJS_DMS_DIR || "")
  .split(":")
  .filter(Boolean)
  .concat(process.cwd());

/**
 * statSync follows symlinks and throws on a dangling one — guard every probe so
 * a single broken entry (common in pnpm node_modules) can't crash discovery.
 * @param {string} path
 * @returns {boolean}
 */
export function isDirectorySafe(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * @param {string} text
 * @returns {unknown}
 */
export function parseJson(text) {
  return JSON.parse(text);
}

/**
 * @param {string} path
 * @returns {unknown}
 */
export function readJson(path) {
  return parseJson(readFileSync(path, "utf8"));
}

/**
 * @param {string} path
 * @returns {PackageManifest} The parsed `package.json`, empty when its root is not an object.
 */
export function readManifest(path) {
  const parsed = readJson(path);
  return isRecord(parsed) ? parsed : {};
}

/**
 * @param {string} path
 * @returns {unknown} The parsed JSON, or `null` when the file cannot be read or parsed.
 */
export function readJsonSafe(path) {
  try {
    return readJson(path);
  } catch {
    return null;
  }
}

/**
 * @param {string} msg
 * @returns {never}
 */
export function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

/**
 * @param {string} msg
 * @returns {void}
 */
export function warn(msg) {
  process.stderr.write(`warning: ${msg}\n`);
}

/**
 * Split a `name@version` spec. The leading `@` of a scope is at index 0, so a
 * version suffix is only present when `@` appears later (e.g. `core@0.0.4`,
 * `@antelopejs/interface-core@0.0.4`).
 * @param {string} input
 * @returns {{ rawName: string, version: string | undefined }}
 */
export function splitSpec(input) {
  const at = input.lastIndexOf("@");
  if (at > 0)
    return { rawName: input.slice(0, at), version: input.slice(at + 1) };
  return { rawName: input, version: undefined };
}

/**
 * @param {string} fullName
 * @returns {string}
 */
export function shortName(fullName) {
  return fullName.replace(INTERFACE_PKG_RE, "");
}

/**
 * @param {string} pkgName
 * @returns {string}
 */
export function shortModuleName(pkgName) {
  return pkgName.slice(pkgName.lastIndexOf("/") + 1);
}

/**
 * @param {PackageManifest} pkg
 * @returns {string} The manifest's `name`, empty when it is not text.
 */
export function nameOf(pkg) {
  return isText(pkg.name) ? pkg.name : "";
}

/**
 * @param {PackageManifest} pkg
 * @returns {string | undefined} The manifest's `version`, `undefined` when it is not text.
 */
export function versionOf(pkg) {
  return isText(pkg.version) ? pkg.version : undefined;
}

/**
 * @param {unknown} value
 * @returns {Array<[string, unknown]>} The own enumerable entries of an object, array or string; none for any other value.
 */
export function entriesOf(value) {
  return isRecord(value) || isText(value) ? Object.entries(value) : [];
}

/**
 * @param {PackageManifest} pkg
 * @returns {unknown} The manifest's `antelopeJs.baseUrl`, `"dist"` when it has none.
 */
export function baseUrlOf(pkg) {
  const antelopeJs = pkg.antelopeJs;
  return (isRecord(antelopeJs) ? antelopeJs.baseUrl : undefined) || "dist";
}

export const flags = new Set(
  process.argv.slice(3).filter((a) => a.startsWith("--")),
);
export const FORCE_REMOTE = flags.has("--remote");
export const OFFLINE =
  flags.has("--offline") ||
  flags.has("--no-remote") ||
  !!process.env.AJS_RESOLVER_OFFLINE;
