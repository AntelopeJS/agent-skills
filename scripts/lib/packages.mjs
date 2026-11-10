/**
 * Fetches a published package (tarball only, no dependencies) into a local
 * cache, the way the interface resolver does, so an eval can read the skills
 * it ships without installing it.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { isRecord, isText } from "../../plugin/scripts/lib/values.mjs";

const NPM_TIMEOUT_MS = 90_000;
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const execFileAsync = promisify(execFile);

/**
 * @returns {string}
 */
export function packageCacheRoot() {
  return (
    process.env.AJS_EVALS_CACHE ||
    join(homedir(), ".cache", "ajs-agent-skills-evals")
  );
}

/**
 * @param {string[]} args
 * @returns {Promise<unknown>}
 */
async function npmJson(args) {
  const { stdout } = await execFileAsync("npm", [...args, "--json"], {
    encoding: "utf8",
    timeout: NPM_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER_BYTES,
  });
  return JSON.parse(stdout || "null");
}

/**
 * @param {string} spec
 * @returns {Promise<string>}
 */
async function resolveVersion(spec) {
  const output = await npmJson(["view", spec, "version"]);
  const version = [output].flat().at(-1);
  if (!isText(version)) throw new Error(`npm view gave no version for ${spec}`);
  return version;
}

/**
 * @param {string} spec
 * @returns {string}
 */
function packageName(spec) {
  const at = spec.indexOf("@", 1);
  return at > 0 ? spec.slice(0, at) : spec;
}

/**
 * Returns the extracted `package/` directory of `spec` (e.g. `@antelopejs/dms@latest`).
 * @param {string} spec
 * @param {string} [cacheRoot]
 * @returns {Promise<string>}
 */
export async function fetchPackage(spec, cacheRoot = packageCacheRoot()) {
  const name = packageName(spec);
  const version = await resolveVersion(spec);
  const dest = join(
    cacheRoot,
    name.replace(/^@/, "").replace(/\//g, "__"),
    version,
  );
  const dir = join(dest, "package");
  if (existsSync(join(dir, "package.json"))) return dir;
  mkdirSync(dest, { recursive: true });
  const work = mkdtempSync(join(dest, ".fetch-"));
  try {
    const packed = await npmJson([
      "pack",
      `${name}@${version}`,
      "--pack-destination",
      work,
    ]);
    const packedFile = [packed].flat()[0];
    const filename = isRecord(packedFile) ? packedFile.filename : undefined;
    if (!isText(filename) || !filename)
      throw new Error(`npm pack gave no file for ${name}@${version}`);
    await execFileAsync("tar", ["-xzf", join(work, filename), "-C", work]);
    if (!existsSync(join(dir, "package.json")))
      rmSync(dir, { recursive: true, force: true });
    try {
      renameSync(join(work, "package"), dir);
    } catch (error) {
      if (!existsSync(join(dir, "package.json"))) throw error;
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return dir;
}
