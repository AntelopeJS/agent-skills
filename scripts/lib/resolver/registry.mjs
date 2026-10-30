import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parseJson } from "../json.mjs";
import { isRecord, isText } from "../values.mjs";
import {
  CACHE_ROOT,
  FORCE_REMOTE,
  OFFLINE,
  readManifest,
  versionOf,
  warn,
} from "./support.mjs";

/**
 * @typedef {import("./support.mjs").PackageEntry} PackageEntry
 */

/**
 * Run npm and parse its --json output. Throws on non-zero exit. npm honours the
 * user's .npmrc (registry, scope, auth, proxy), so private registries work.
 * @param {string[]} args
 * @returns {unknown}
 */
export function npm(args) {
  const out = execFileSync("npm", [...args, "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
    timeout: 90_000,
  });
  return parseJson(out || "null");
}

/**
 * The cause of an npm failure: its first real `npm error` line, not the
 * trailing "complete log" pointer.
 * @param {unknown} e
 * @returns {string | undefined}
 */
export function npmErrText(e) {
  const detail = isRecord(e) ? e.stderr || e.message : undefined;
  const lines = (
    isText(detail) ? detail : Buffer.isBuffer(detail) ? detail.toString() : ""
  )
    .trim()
    .split("\n");
  const informative = lines.find(
    (l) => l.startsWith("npm error") && !l.includes("A complete log"),
  );
  return (
    informative ||
    lines.filter((l) => !l.includes("A complete log")).pop() ||
    lines.pop()
  );
}

/**
 * @param {string} fullName
 * @returns {string[]}
 */
function remoteVersions(fullName) {
  const v = npm(["view", fullName, "versions"]);
  return Array.isArray(v) ? v.filter(isText) : isText(v) ? [v] : [];
}

/**
 * @param {string} fullName
 * @returns {string | null}
 */
function remoteLatest(fullName) {
  try {
    const tags = npm(["view", fullName, "dist-tags"]);
    const latest = isRecord(tags) ? tags.latest : undefined;
    return isText(latest) ? latest : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} fullName
 * @param {string | undefined} wanted
 * @returns {string}
 */
export function resolveRemoteVersion(fullName, wanted) {
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

/**
 * Download `<pkg>@<version>` and extract it under the cache. Returns the extracted
 * `package/` dir (a drop-in for a local package dir). Cached across runs. The
 * tarball stays in the cache when it cannot be removed.
 * @param {string} fullName
 * @param {string} version
 * @returns {string}
 */
export function fetchToCache(fullName, version) {
  const safe = fullName.replace(/^@/, "").replace(/\//g, "__");
  const dest = join(CACHE_ROOT, safe, version);
  const pkgDir = join(dest, "package");
  if (existsSync(join(pkgDir, "package.json"))) return pkgDir;

  mkdirSync(dest, { recursive: true });
  const packed = npm([
    "pack",
    `${fullName}@${version}`,
    "--pack-destination",
    dest,
  ]);
  const filename = Array.isArray(packed)
    ? isRecord(packed[0])
      ? packed[0].filename
      : undefined
    : isRecord(packed)
      ? packed.filename
      : undefined;
  if (!isText(filename) || !filename)
    throw new Error(`npm pack gave no filename for ${fullName}@${version}`);

  execFileSync("tar", ["-xzf", join(dest, filename), "-C", dest], {
    stdio: "ignore",
  });
  try {
    rmSync(join(dest, filename));
  } catch {}
  if (!existsSync(join(pkgDir, "package.json"))) {
    throw new Error(
      `extracted tarball has no package/package.json at ${pkgDir}`,
    );
  }
  return pkgDir;
}

/**
 * Resolve any package (interface or host) by full name to a { dir, pkg } entry:
 * local copy when present and no version pinned / --remote off, else npm. Throws.
 * @param {string} fullName
 * @param {string | undefined} wanted
 * @param {(name: string) => PackageEntry | null} localLookup
 * @returns {PackageEntry}
 */
export function resolvePackageEntry(fullName, wanted, localLookup) {
  if (!FORCE_REMOTE && !wanted) {
    const hit = localLookup(fullName);
    if (hit) return hit;
  }
  if (OFFLINE) {
    const hit = localLookup(fullName);
    if (hit) {
      if (
        wanted &&
        wanted !== "latest" &&
        versionOf(hit.pkg) !== wanted.replace(/^v/, "")
      ) {
        throw new Error(
          `${fullName}@${wanted} is not available locally (offline); local copy is v${String(versionOf(hit.pkg))}`,
        );
      }
      return hit;
    }
    throw new Error(`${fullName} is not available locally (offline)`);
  }
  try {
    const version = resolveRemoteVersion(fullName, wanted);
    const dir = fetchToCache(fullName, version);
    return { dir, pkg: readManifest(join(dir, "package.json")), remote: true };
  } catch (e) {
    if (!wanted) {
      const hit = localLookup(fullName);
      if (hit) {
        warn(
          `could not fetch ${fullName} from npm (${npmErrText(e)}); using local copy.`,
        );
        return hit;
      }
    }
    throw e;
  }
}

/**
 * Published versions (newest-first) + dist-tag latest. Falls back to a local
 * clone's git tags when offline or the registry is unreachable.
 * @param {string} fullName
 * @param {PackageEntry | null} localEntry
 * @returns {{ versions: string[], latest: string | null }}
 */
export function listVersions(fullName, localEntry) {
  if (!OFFLINE) {
    try {
      return {
        versions: remoteVersions(fullName).slice().reverse(),
        latest: remoteLatest(fullName),
      };
    } catch (e) {
      if (!localEntry) throw e;
      warn(
        `registry lookup failed for ${fullName} (${npmErrText(e)}); using local git tags.`,
      );
    }
  }
  const tags = localEntry
    ? gitTags(localEntry.dir).map((t) => t.replace(/^v/, ""))
    : [];
  return { versions: tags, latest: null };
}

/**
 * The tags of a checkout's own repository; none for a copy under node_modules,
 * where `git tag` would walk up to the enclosing project's repo.
 * @param {string} dir
 * @returns {string[]}
 */
function gitTags(dir) {
  if (!existsSync(join(dir, ".git"))) return [];
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
