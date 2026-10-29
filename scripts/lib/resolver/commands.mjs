import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isText } from "../values.mjs";
import {
  candidateFullNames,
  candidateScopes,
  discoverDmsHosts,
  discoverInterfaces,
  findLocalInterface,
  findLocalPackage,
} from "./discovery.mjs";
import {
  listVersions,
  npm,
  npmErrText,
  resolvePackageEntry,
} from "./registry.mjs";
import {
  DMS_EXTRA_HOSTS,
  OFFLINE,
  PKG_PREFIX,
  SHORT_PREFIX,
  fail,
  readJson,
  shortName,
  splitSpec,
  warn,
} from "./support.mjs";
import { dmsGroups, exportedSymbols } from "./surface.mjs";
import { parseDmsSpec, resolveTarget } from "./targets.mjs";

function dmsHostsForListing() {
  const hosts = new Map(discoverDmsHosts());
  if (!OFFLINE) {
    for (const name of DMS_EXTRA_HOSTS) {
      if (hosts.has(name)) continue;
      try {
        hosts.set(name, resolvePackageEntry(name, undefined, findLocalPackage));
      } catch (e) {
        warn(`could not list host package ${name} (${npmErrText(e)}).`);
      }
    }
  }
  return hosts;
}

function localRows() {
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
  return byKey;
}

function addNpmRows(byKey, prefix) {
  for (const r of npm(["search", prefix])) {
    if (!isText(r.name) || !r.name.startsWith(prefix) || byKey.has(r.name))
      continue;
    byKey.set(r.name, {
      name: shortName(r.name),
      package: r.name,
      version: r.version ?? "",
      description: r.description ?? "",
      source: "npm",
    });
  }
}

/**
 * Adds the interface packages the registry lists for the public scope, then for
 * every discovered scope. The public search failing is warned about; a scope
 * whose registry does not support search is skipped, since local discovery is
 * then the only source.
 */
function addNpmListing(byKey) {
  try {
    addNpmRows(byKey, PKG_PREFIX);
  } catch (e) {
    if (!byKey.size) warn(`npm search failed (${npmErrText(e)}).`);
    else
      warn(
        `npm search failed (${npmErrText(e)}); interface-package list may be incomplete.`,
      );
  }
  for (const scope of candidateScopes().slice(1)) {
    try {
      addNpmRows(byKey, `${scope}/${SHORT_PREFIX}`);
    } catch {}
  }
}

function hostRows() {
  const dms = [];
  for (const [host, entry] of dmsHostsForListing()) {
    for (const g of dmsGroups(entry)) {
      dms.push({
        name: `${host}/${g.sub}`,
        package: host,
        version: entry.pkg.version,
        description: `host interface (${g.name})`,
        source: "dms",
      });
    }
  }
  return dms;
}

function printRows(rows, dms) {
  for (const r of rows) {
    console.log(
      `${r.name.padEnd(26)} ${(r.version ? `v${r.version}` : "").padEnd(9)} ${r.description}`,
    );
  }
  if (dms.length) {
    console.log("\nHost-package interfaces (import path):");
    for (const r of dms) console.log(`  ${r.name.padEnd(52)} ${r.description}`);
  }
}

export function cmdList(json) {
  const byKey = localRows();
  if (!OFFLINE) addNpmListing(byKey);
  const dms = hostRows();
  const rows = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  dms.sort((a, b) => a.name.localeCompare(b.name));
  if (json) return console.log(JSON.stringify([...rows, ...dms], null, 2));
  printRows(rows, dms);
}

/** Shows an interface; its version listing is best-effort and left empty when it fails. */
export function cmdShow(input, json) {
  const target = resolveTarget(input);
  const subs = target.parts.map((s) => ({
    ...s,
    symbols: exportedSymbols(s.dts),
  }));
  let versionInfo = { versions: [], latest: null };
  try {
    versionInfo = listVersions(
      target.versionsPkg,
      target.entry.remote ? null : target.entry,
    );
  } catch {}
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

  console.log(
    `${data.name}  (${data.package} v${data.version}${data.source === "npm" ? ", npm" : ""})`,
  );
  if (data.description) console.log(data.description);
  console.log(
    `${data.source === "npm" ? "cached" : "location"}: ${data.location}`,
  );
  if (data.latest) console.log(`latest: v${String(data.latest)}`);
  if (data.availableVersions.length) {
    console.log(
      `versions: ${data.availableVersions.map((v) => `v${String(v)}`).join(", ")}`,
    );
  }
  console.log("\nexport surface:");
  for (const s of data.subpaths) {
    console.log(`\n  import "${s.import}"`);
    for (const sym of s.symbols)
      console.log(`    ${sym.kind.padEnd(9)} ${sym.name}`);
    if (!s.symbols.length) console.log("    (no top-level declarations found)");
  }
  console.log(
    `\nFull signatures: resolve-interface.mjs contract ${input} [subpath]`,
  );
}

export function cmdContract(input, subpath) {
  const target = resolveTarget(input);
  const want = (subpath ?? target.defaultSubpath ?? ".").replace(/^\.\//, "");
  const match = target.parts.find((s) => s.subpath === want);
  if (!match) {
    const avail = target.parts.map((s) => s.subpath).join(", ");
    fail(`No subpath '${want}' for ${target.displayName}. Available: ${avail}`);
  }
  if (!match.dts)
    fail(
      `No .d.ts found for subpath '${want}' (is the package built/published?)`,
    );
  process.stdout.write(`// ${match.import}\n// ${match.dts}\n\n`);
  process.stdout.write(readFileSync(match.dts, "utf8"));
}

export function cmdVersions(input) {
  const dms = parseDmsSpec(input);
  let fullName;
  let localEntry;
  if (dms) {
    fullName = splitSpec(dms.pkgSpec).rawName;
    localEntry = findLocalPackage(fullName);
  } else {
    const { rawName } = splitSpec(input);
    localEntry = findLocalInterface(rawName);
    fullName = localEntry
      ? localEntry.pkg.name
      : candidateFullNames(rawName)[0];
    if (!localEntry) {
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
  console.log(
    info.versions.length
      ? info.versions.map((v) => `v${v}`).join("\n")
      : "(no versions found)",
  );
}

/** The registry manifest of an interface, from the `main` branch, else `master`; null when neither can be fetched. */
async function fetchRegistryManifest(name) {
  for (const branch of ["main", "master"]) {
    const url = `https://raw.githubusercontent.com/AntelopeJS/interfaces/${branch}/interfaces/${name}/manifest.json`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) return await res.json();
    } catch {}
  }
  return null;
}

export async function cmdImplementations(input) {
  if (parseDmsSpec(input)) {
    console.log(
      `'${input}' is a host-package interface (a subpath of a host package). Implementations are\n` +
        `not tracked in the AntelopeJS interfaces registry — a host interface is provided by its\n` +
        `host module directly (antelopeJs.implements in that module's package.json).`,
    );
    return;
  }
  const { rawName } = splitSpec(input);
  const local = findLocalInterface(rawName);
  if (!local) {
    for (const [, entry] of discoverDmsHosts()) {
      if (dmsGroups(entry).some((g) => g.name === rawName)) {
        console.log(
          `'${input}' is a host-package interface (a subpath of ${entry.pkg.name}). Implementations are\n` +
            `not tracked in the AntelopeJS interfaces registry — a host interface is provided by its\n` +
            `host module directly (antelopeJs.implements in that module's package.json).`,
        );
        return;
      }
    }
  }
  const name = shortName(local?.pkg.name ?? candidateFullNames(rawName)[0]);

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
