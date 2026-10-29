/**
 * Fetches a published package (tarball only, no dependencies) into a local
 * cache, the way the interface resolver does, so an eval can read the skills
 * it ships without installing it.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

const NPM_TIMEOUT_MS = 90_000;
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

export function packageCacheRoot() {
  return (
    process.env.AJS_EVALS_CACHE ||
    join(homedir(), ".cache", "ajs-agent-skills-evals")
  );
}

function npmJson(args) {
  const output = execFileSync("npm", [...args, "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: NPM_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER_BYTES,
  });
  return JSON.parse(output || "null");
}

function resolveVersion(spec) {
  const version = npmJson(["view", spec, "version"]);
  return Array.isArray(version) ? version[version.length - 1] : version;
}

function packageName(spec) {
  const at = spec.indexOf("@", 1);
  return at > 0 ? spec.slice(0, at) : spec;
}

/** Returns the extracted `package/` directory of `spec` (e.g. `@antelopejs/dms@latest`). */
export function fetchPackage(spec, cacheRoot = packageCacheRoot()) {
  const name = packageName(spec);
  const version = resolveVersion(spec);
  const dest = join(
    cacheRoot,
    name.replace(/^@/, "").replace(/\//g, "__"),
    version,
  );
  const dir = join(dest, "package");
  if (existsSync(join(dir, "package.json"))) return dir;
  mkdirSync(dest, { recursive: true });
  const packed = npmJson([
    "pack",
    `${name}@${version}`,
    "--pack-destination",
    dest,
  ]);
  const filename = (Array.isArray(packed) ? packed[0] : packed)?.filename;
  if (!filename)
    throw new Error(`npm pack gave no file for ${name}@${version}`);
  const archive = join(dest, filename);
  execFileSync("tar", ["-xzf", archive, "-C", dest], { stdio: "ignore" });
  rmSync(archive, { force: true });
  return dir;
}
