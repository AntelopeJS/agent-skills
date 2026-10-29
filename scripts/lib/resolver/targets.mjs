import { join } from "node:path";
import {
  candidateFullNames,
  discoverDmsHosts,
  discoverInterfaces,
  findLocalInterface,
  findLocalPackage,
} from "./discovery.mjs";
import {
  fetchToCache,
  npmErrText,
  resolvePackageEntry,
  resolveRemoteVersion,
} from "./registry.mjs";
import {
  DMS_EXTRA_HOSTS,
  FORCE_REMOTE,
  OFFLINE,
  fail,
  readJson,
  shortModuleName,
  shortName,
  splitSpec,
} from "./support.mjs";
import { dmsGroupParts, dmsGroups, subpaths } from "./surface.mjs";

/**
 * A resolved target: `{ entry, displayName, versionsPkg, parts, defaultSubpath }`,
 * where `parts` is the uniform `[{subpath, import, dts}]` list both show and
 * contract consume.
 */
function pkgTarget(entry) {
  return {
    entry,
    displayName: shortName(entry.pkg.name),
    versionsPkg: entry.pkg.name,
    parts: subpaths(entry),
    defaultSubpath: ".",
  };
}

function dmsTarget(entry, group, focusSub) {
  const parts = dmsGroupParts(entry, group.sub);
  const rel =
    focusSub && focusSub !== group.sub
      ? focusSub.slice(group.sub.length + 1)
      : ".";
  return {
    entry,
    displayName: `${entry.pkg.name}/${group.sub}`,
    versionsPkg: entry.pkg.name,
    parts,
    defaultSubpath: rel,
  };
}

/**
 * The full name of a discovered (or env-named) host whose short module name
 * (the part after the last /) equals `alias` — e.g. alias `dms-host` matches
 * `@acme/dms-host`.
 */
function hostForAlias(alias) {
  for (const name of discoverDmsHosts().keys()) {
    if (shortModuleName(name) === alias) return name;
  }
  for (const name of DMS_EXTRA_HOSTS) {
    if (shortModuleName(name) === alias) return name;
  }
  return null;
}

/**
 * Parse a host-style spec into { pkgSpec, interfaceSub } or null. Handles the
 * `<alias>:<group>` shorthand (alias = a host's short module name), full
 * `…/interfaces/<group>[/part]` specifiers, and the singular `…/interface`.
 */
export function parseDmsSpec(input) {
  let spec = input;
  const aliased = spec.match(/^([^/@:]+):(.+)$/);
  if (aliased) {
    const host = hostForAlias(aliased[1]);
    if (!host) {
      fail(
        `no known host package matches alias '${aliased[1]}'. Hosts are discovered from the ` +
          `current project (dependencies, .antelope/cache, AJS_DMS_DIR) — run from a project ` +
          `that depends on the host, or name it via AJS_DMS_PACKAGES (comma-separated).`,
      );
    }
    const { rawName: group, version } = splitSpec(aliased[2]);
    spec = `${host}${version ? `@${version}` : ""}/interfaces/${group}`;
  }
  const at = spec.indexOf("/interfaces/");
  if (at > 0) {
    const { rawName: sub, version } = splitSpec(spec.slice(at + 1));
    return {
      pkgSpec: `${spec.slice(0, at)}${version ? `@${version}` : ""}`,
      interfaceSub: sub,
    };
  }
  const singular = spec.match(/^(.+)\/interface(@[^/@]+)?$/);
  if (singular) {
    return {
      pkgSpec: `${singular[1]}${singular[2] ?? ""}`,
      interfaceSub: "interface",
    };
  }
  return null;
}

function groupForSub(entry, interfaceSub) {
  if (interfaceSub === "interface")
    return { name: shortModuleName(entry.pkg.name), sub: "interface" };
  const name = interfaceSub.split("/")[1];
  return { name, sub: `interfaces/${name}` };
}

/**
 * A host interface by bare group name, resolved against discovered host
 * packages (plus any named via AJS_DMS_PACKAGES). No host name is guessed.
 */
function resolveDmsBare(name, version) {
  if (!version) {
    for (const [, entry] of discoverDmsHosts()) {
      const g = dmsGroups(entry).find((g) => g.name === name);
      if (g) return dmsTarget(entry, g);
    }
  }
  const hosts = [...discoverDmsHosts().keys(), ...DMS_EXTRA_HOSTS];
  for (const host of hosts) {
    try {
      const entry = resolvePackageEntry(host, version, findLocalPackage);
      const g = dmsGroups(entry).find((g) => g.name === name);
      if (g) return dmsTarget(entry, g);
    } catch {}
  }
  return null;
}

export function resolveTarget(input) {
  const dms = parseDmsSpec(input);
  if (dms) {
    const { rawName: pkg, version } = splitSpec(dms.pkgSpec);
    let entry;
    try {
      entry = resolvePackageEntry(pkg, version, findLocalPackage);
    } catch (e) {
      fail(`could not resolve host package '${pkg}': ${npmErrText(e)}`);
    }
    return dmsTarget(
      entry,
      groupForSub(entry, dms.interfaceSub),
      dms.interfaceSub,
    );
  }

  const { rawName, version } = splitSpec(input);

  if (!FORCE_REMOTE && !version) {
    const local = findLocalInterface(rawName);
    if (local) return pkgTarget(local);
    for (const [, entry] of discoverDmsHosts()) {
      const g = dmsGroups(entry).find((g) => g.name === rawName);
      if (g) return dmsTarget(entry, g);
    }
  }

  if (OFFLINE) {
    const local = findLocalInterface(rawName);
    if (local) {
      const pinned =
        version && version !== "latest" ? version.replace(/^v/, "") : null;
      if (!pinned || local.pkg.version === pinned) return pkgTarget(local);
      fail(
        `'${input}' is not available locally (offline); local copy is v${local.pkg.version}.`,
      );
    }
    const dmsHit = resolveDmsBare(rawName, version);
    if (dmsHit) return dmsHit;
    const known = [...discoverInterfaces().keys()].map(shortName).join(", ");
    fail(
      `'${input}' is not available locally (offline). Locally present: ${known || "(none)"}.`,
    );
  }

  let interfaceErr;
  for (const fullName of candidateFullNames(rawName)) {
    try {
      const version2 = resolveRemoteVersion(fullName, version);
      const dir = fetchToCache(fullName, version2);
      return pkgTarget({
        dir,
        pkg: readJson(join(dir, "package.json")),
        remote: true,
      });
    } catch (e) {
      interfaceErr ??= e;
    }
  }
  const dmsHit = resolveDmsBare(rawName, version);
  if (dmsHit) return dmsHit;
  fail(`could not resolve '${input}': ${npmErrText(interfaceErr)}`);
}
