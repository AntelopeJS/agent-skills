import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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
 */
export function isDirectorySafe(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readJsonSafe(path) {
  try {
    return readJson(path);
  } catch {
    return null;
  }
}

export function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

export function warn(msg) {
  process.stderr.write(`warning: ${msg}\n`);
}

/**
 * Split a `name@version` spec. The leading `@` of a scope is at index 0, so a
 * version suffix is only present when `@` appears later (e.g. `core@0.0.4`,
 * `@antelopejs/interface-core@0.0.4`).
 */
export function splitSpec(input) {
  const at = input.lastIndexOf("@");
  if (at > 0)
    return { rawName: input.slice(0, at), version: input.slice(at + 1) };
  return { rawName: input, version: undefined };
}

export function shortName(fullName) {
  return fullName.replace(INTERFACE_PKG_RE, "");
}

export function shortModuleName(pkgName) {
  return pkgName.slice(pkgName.lastIndexOf("/") + 1);
}

export function baseUrlOf(pkg) {
  return pkg.antelopeJs?.baseUrl || "dist";
}

export const flags = new Set(
  process.argv.slice(3).filter((a) => a.startsWith("--")),
);
export const FORCE_REMOTE = flags.has("--remote");
export const OFFLINE =
  flags.has("--offline") ||
  flags.has("--no-remote") ||
  !!process.env.AJS_RESOLVER_OFFLINE;
