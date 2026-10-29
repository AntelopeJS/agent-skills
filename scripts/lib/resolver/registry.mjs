import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  CACHE_ROOT,
  FORCE_REMOTE,
  OFFLINE,
  readJson,
  warn,
} from "./support.mjs";

/**
 * Run npm and parse its --json output. Throws on non-zero exit. npm honours the
 * user's .npmrc (registry, scope, auth, proxy), so private registries work.
 */
export function npm(args) {
  const out = execFileSync("npm", [...args, "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
    timeout: 90_000,
  });
  return JSON.parse(out || "null");
}

/**
 * The cause of an npm failure: its first real `npm error` line, not the
 * trailing "complete log" pointer.
 */
export function npmErrText(e) {
  const lines = ((e && (e.stderr || e.message)) || "")
    .toString()
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
 * `package/` dir (a drop-in for a local package dir). Cached across runs.
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
    ? packed[0]?.filename
    : packed?.filename;
  if (!filename)
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
        hit.pkg.version !== wanted.replace(/^v/, "")
      ) {
        throw new Error(
          `${fullName}@${wanted} is not available locally (offline); local copy is v${hit.pkg.version}`,
        );
      }
      return hit;
    }
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
