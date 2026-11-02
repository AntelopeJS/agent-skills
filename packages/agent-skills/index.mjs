import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MANIFEST_FILE = "package.json";
const NODE_MODULES_DIR = "node_modules";
/** @type {{ [K in import("./index.js").SkillPackageKind]: K }} */
const KIND = {
  module: "module",
  dependency: "dependency",
  project: "project",
  installed: "installed",
};

/**
 * What discovery reads of a `package.json`.
 * @typedef {object} Manifest
 * @property {string | undefined} name
 * @property {string | null} version
 * @property {string[]} skills Declared `antelopeJs.skills` entries.
 * @property {string[]} dependencies Names under `dependencies`.
 * @property {string[]} optionalDependencies Names under `optionalDependencies`.
 * @property {string[]} devDependencies Names under `devDependencies`.
 */

/**
 * A package directory to consider, and the name to use when it has none.
 * @typedef {object} Candidate
 * @property {string} dir
 * @property {import("./index.js").SkillPackageKind} kind
 * @property {string | undefined} fallbackName
 */

/**
 * Whether `value` is a string.
 * @param {unknown} value
 * @returns {value is string}
 */
function isText(value) {
  return String(value) === value;
}

/**
 * Whether `value` is a JSON object: not null, not an array, not a primitive.
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Object(value) === value && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function nonEmptyText(value) {
  return isText(value) && value.length > 0 ? value : undefined;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function nonEmptyTexts(value) {
  return Array.isArray(value)
    ? value.flatMap((entry) => nonEmptyText(entry) ?? [])
    : [];
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function dependencyNames(value) {
  return isRecord(value) ? Object.keys(value) : [];
}

/**
 * A manifest of any other form reads as absent: no name, no skills, no
 * dependencies.
 * @param {unknown} raw
 * @returns {Manifest | null}
 */
function parseManifest(raw) {
  if (!isRecord(raw)) return null;
  const antelopeJs = raw.antelopeJs;
  return {
    name: nonEmptyText(raw.name),
    version: isText(raw.version) ? raw.version : null,
    skills: nonEmptyTexts(isRecord(antelopeJs) ? antelopeJs.skills : undefined),
    dependencies: dependencyNames(raw.dependencies),
    optionalDependencies: dependencyNames(raw.optionalDependencies),
    devDependencies: dependencyNames(raw.devDependencies),
  };
}

/**
 * @param {string} dir
 * @returns {Manifest | null}
 */
function readManifest(dir) {
  try {
    /** @type {unknown} */
    const raw = JSON.parse(readFileSync(join(dir, MANIFEST_FILE), "utf8"));
    return parseManifest(raw);
  } catch {
    return null;
  }
}

/**
 * @param {string} path
 * @returns {string}
 */
function realpathOrSelf(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Finds `node_modules/<dep>` from the real path of `fromDir` up its ancestors,
 * which is how Node resolves a dependency and how pnpm's symlinked layout is
 * entered from inside the store.
 * @param {string} fromDir
 * @param {string} dep
 * @returns {string | null}
 */
function resolveDependencyDir(fromDir, dep) {
  for (let dir = realpathOrSelf(fromDir); ; dir = dirname(dir)) {
    const candidate = join(dir, NODE_MODULES_DIR, dep);
    if (readManifest(candidate) !== null) return candidate;
    if (dirname(dir) === dir) return null;
  }
}

/**
 * @param {string} packageDir
 * @param {string} dir
 * @returns {boolean}
 */
function escapesPackage(packageDir, dir) {
  const from = relative(packageDir, dir);
  return from === ".." || from.startsWith(`..${sep}`) || isAbsolute(from);
}

/**
 * @param {{ name: string, dir: string, manifest: Manifest }} source
 * @param {(message: string) => void} onWarning
 * @returns {string[]}
 */
function skillDirsOf({ name, dir, manifest }, onWarning) {
  /** @type {Set<string>} */
  const dirs = new Set();
  for (const declared of manifest.skills) {
    const skillDir = resolve(dir, declared);
    if (escapesPackage(dir, skillDir)) {
      onWarning(
        `${name}: skills dir '${declared}' escapes the package — skipped.`,
      );
    } else {
      dirs.add(skillDir);
    }
  }
  return [...dirs];
}

/**
 * @param {string} root
 * @param {string[]} names
 * @param {import("./index.js").SkillPackageKind} kind
 * @returns {Candidate[]}
 */
function dependencyCandidates(root, names, kind) {
  return names.flatMap((dep) => {
    const dir = resolveDependencyDir(root, dep);
    return dir === null ? [] : [{ dir, kind, fallbackName: dep }];
  });
}

/**
 * @param {import("./index.js").CollectSkillPackagesInput} input
 * @param {(dir: string) => Manifest | null} manifestOf
 * @returns {Candidate[]}
 */
function candidatesOf({ modules, project, installed = [] }, manifestOf) {
  const own = modules.map((entry) => ({
    dir: entry.dir,
    kind: KIND.module,
    fallbackName: entry.id,
  }));
  const moduleDependencies = modules.flatMap((entry) => {
    const manifest = manifestOf(entry.dir);
    const names = manifest
      ? [...manifest.dependencies, ...manifest.optionalDependencies]
      : [];
    return dependencyCandidates(entry.dir, names, KIND.dependency);
  });
  const projectManifest = project === undefined ? null : manifestOf(project);
  const projectDependencies =
    project === undefined || projectManifest === null
      ? []
      : dependencyCandidates(
          project,
          [
            ...projectManifest.dependencies,
            ...projectManifest.optionalDependencies,
            ...projectManifest.devDependencies,
          ],
          KIND.project,
        );
  const installedDirs = installed.map((dir) => ({
    dir,
    kind: KIND.installed,
    fallbackName: undefined,
  }));
  return [
    ...own,
    ...moduleDependencies,
    ...projectDependencies,
    ...installedDirs,
  ];
}

/**
 * Collects the packages that ship agent skills, in priority order, one per
 * package name: the first candidate to carry a name keeps it.
 *
 * The candidates, in order: the modules themselves; the dependencies and
 * optional dependencies of every module; the dependencies, optional
 * dependencies and dev dependencies of `project`; the `installed` package
 * directories. A candidate with a readable manifest and a name reserves that
 * name even when it declares no skills, so the copy a runtime runs always hides
 * an installed copy of the same package. A candidate without a usable name
 * falls back to the module `id`, or to the dependency's own name, and is
 * skipped when it has neither.
 *
 * Only packages with at least one skill directory are returned. A skill
 * directory outside its package is dropped and reported through `onWarning`.
 * Nothing here throws on a missing or malformed manifest.
 * @param {import("./index.js").CollectSkillPackagesInput} input
 * @returns {import("./index.js").SkillPackage[]}
 */
export function collectSkillPackages(input) {
  const { onWarning = () => {} } = input;
  /** @type {Map<string, Manifest | null>} */
  const manifests = new Map();
  /** @type {(dir: string) => Manifest | null} */
  const manifestOf = (dir) => {
    const known = manifests.get(dir);
    if (known !== undefined) return known;
    const read = readManifest(dir);
    manifests.set(dir, read);
    return read;
  };
  /** @type {Set<string>} */
  const claimed = new Set();
  /** @type {import("./index.js").SkillPackage[]} */
  const found = [];
  for (const { dir, kind, fallbackName } of candidatesOf(input, manifestOf)) {
    const manifest = manifestOf(dir);
    const name = manifest?.name ?? nonEmptyText(fallbackName);
    if (manifest === null || name === undefined || claimed.has(name)) continue;
    claimed.add(name);
    const skillDirs = skillDirsOf({ name, dir, manifest }, onWarning);
    if (skillDirs.length > 0)
      found.push({ name, version: manifest.version, dir, skillDirs, kind });
  }
  return found;
}
