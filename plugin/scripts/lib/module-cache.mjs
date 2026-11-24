import { join } from "node:path";

import { isDirectorySafe, readdirSafe } from "./safe-read.mjs";

/**
 * @typedef {object} CachedModule
 * @property {string} name The package name, scope included.
 * @property {string | null} version The version in the folder name, null for an unversioned folder.
 * @property {string} dir
 */

/**
 * @param {string} entry A folder name: `pkg` or `pkg@version`.
 * @returns {{ base: string, version: string | null }}
 */
function splitEntry(entry) {
  const at = entry.lastIndexOf("@");
  return at > 0
    ? { base: entry.slice(0, at), version: entry.slice(at + 1) }
    : { base: entry, version: null };
}

/**
 * Every module in `<root>/.antelope/cache`, the only place that knows the
 * layout: `<pkg>` or `<pkg>@<version>` (written by ajs since core 1.23.1),
 * under `@scope/` for a scoped package.
 * @param {string} root
 * @returns {CachedModule[]}
 */
export function cachedModules(root) {
  const cache = join(root, ".antelope", "cache");
  /** @type {CachedModule[]} */
  const modules = [];
  for (const entry of readdirSafe(cache)) {
    if (entry.startsWith(".")) continue;
    const path = join(cache, entry);
    if (!isDirectorySafe(path)) continue;
    if (!entry.startsWith("@")) {
      const { base, version } = splitEntry(entry);
      modules.push({ name: base, version, dir: path });
      continue;
    }
    for (const child of readdirSafe(path)) {
      if (child.startsWith(".")) continue;
      const dir = join(path, child);
      if (!isDirectorySafe(dir)) continue;
      const { base, version } = splitEntry(child);
      modules.push({ name: `${entry}/${base}`, version, dir });
    }
  }
  return modules;
}

/**
 * The cached folders of one module: the wanted version first, then the others
 * from the highest down, then an unversioned folder.
 * @param {string} root
 * @param {string} name
 * @param {string} [version]
 * @returns {string[]}
 */
export function cachedModuleDirs(root, name, version) {
  const pinned = version?.replace(/^v/, "");
  /** @param {CachedModule} m */
  const rank = (m) => (m.version === null ? 2 : m.version === pinned ? 0 : 1);
  return cachedModules(root)
    .filter((m) => m.name === name)
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (b.version ?? "").localeCompare(a.version ?? "", "en", {
          numeric: true,
        }),
    )
    .map((m) => m.dir);
}
