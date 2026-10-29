/**
 * Resolves what a module specifier really exports, from the `.d.ts` files of
 * the installed package: `exports` map (conditions and `*` patterns), or the
 * legacy `types` field, following `export *` chains across files and packages.
 * Interface packages that are not installed are fetched through the contract
 * resolver (scripts/resolve-interface.mjs), which reads them from npm.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { isBuiltin } from "node:module";
import { fileURLToPath } from "node:url";

import { isRecord, isText } from "./values.mjs";

const RESOLVER_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "resolve-interface.mjs",
);
const INTERFACE_PACKAGE_RE = /^@[^/]+\/interface-/;
const RESOLVER_TIMEOUT_MS = 120_000;
const PATTERN_SCAN_DEPTH = 6;
const TYPE_CONDITIONS = ["types", "import", "require", "node", "default"];
const DTS_RE = /\.d\.[mc]?ts$/;
const COMMENT_RE = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const DECLARATION_RE =
  /\bexport\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:const\s+enum|class|interface|type|enum|const|function\*?|namespace|module|let|var)\s+([A-Za-z_$][\w$]*)/g;
const NAMED_EXPORT_RE = /\bexport\s+(?:type\s+)?\{([^}]*)\}/g;
const STAR_AS_RE = /\bexport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from/g;
const STAR_RE = /\bexport\s+\*\s+from\s*["']([^"']+)["']/g;
const DEFAULT_RE = /\bexport\s+default\b/;
const EXPORT_ASSIGNMENT_RE = /\bexport\s*=/;

export const STATUS = {
  ok: "ok",
  builtin: "builtin",
  untyped: "untyped",
  missingPackage: "missing-package",
  missingSubpath: "missing-subpath",
};

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function splitSpecifier(specifier) {
  const parts = specifier.split("/");
  const size = specifier.startsWith("@") ? 2 : 1;
  return {
    name: parts.slice(0, size).join("/"),
    subpath: parts.slice(size).join("/"),
  };
}

function ancestors(dir) {
  const parent = dirname(dir);
  return parent === dir ? [dir] : [dir, ...ancestors(parent)];
}

function localPackageDir(project, name) {
  const candidates = ancestors(resolve(project)).flatMap((dir) => [
    join(dir, "node_modules", name),
    join(dir, ".antelope", "cache", name),
  ]);
  return (
    candidates.find((dir) => existsSync(join(dir, "package.json"))) ?? null
  );
}

function resolverPackageDir(context, name) {
  if (!INTERFACE_PACKAGE_RE.test(name)) return null;
  const args = [
    RESOLVER_SCRIPT,
    "show",
    name,
    "--json",
    ...(context.offline ? ["--offline"] : []),
  ];
  try {
    const output = execFileSync(process.execPath, args, {
      cwd: context.project,
      env: context.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: RESOLVER_TIMEOUT_MS,
    });
    return JSON.parse(output).location ?? null;
  } catch {
    return null;
  }
}

function typesTarget(target) {
  if (isText(target) || target === null) return target;
  if (Array.isArray(target))
    return target.map(typesTarget).find(isText) ?? null;
  if (!isRecord(target)) return null;
  const condition = TYPE_CONDITIONS.find((key) => target[key] !== undefined);
  return condition ? typesTarget(target[condition]) : null;
}

function exportsMap(exports) {
  const isSubpathMap =
    (exports === null || isRecord(exports)) &&
    !Array.isArray(exports) &&
    Object.keys(exports).every((key) => key.startsWith("."));
  return isSubpathMap ? exports : { ".": exports };
}

function matchPattern(map, key) {
  for (const [pattern, target] of Object.entries(map)) {
    const star = pattern.indexOf("*");
    if (star < 0) continue;
    const [prefix, suffix] = [pattern.slice(0, star), pattern.slice(star + 1)];
    if (
      !key.startsWith(prefix) ||
      !key.endsWith(suffix) ||
      key.length < pattern.length - 1
    )
      continue;
    const captured = key.slice(prefix.length, key.length - suffix.length);
    const types = typesTarget(target);
    return isText(types) ? types.replaceAll("*", captured) : null;
  }
  return undefined;
}

function dtsCandidates(path) {
  if (DTS_RE.test(path)) return [path];
  const base = path.replace(/\.[mc]?[jt]s$/, "");
  return [
    `${base}.d.ts`,
    `${base}.d.mts`,
    `${base}.d.cts`,
    join(base, "index.d.ts"),
  ];
}

function firstExisting(paths) {
  return paths.find((path) => existsSync(path)) ?? null;
}

function legacyEntry(dir, pkg, subpath) {
  if (subpath) {
    const mapped = typesTarget(pkg.typesVersions?.["*"]?.[subpath]);
    return firstExisting([
      ...(mapped ? dtsCandidates(join(dir, mapped)) : []),
      ...dtsCandidates(join(dir, subpath)),
    ]);
  }
  const declared = pkg.types ?? pkg.typings ?? pkg.main ?? "index.js";
  return firstExisting(dtsCandidates(join(dir, declared)));
}

function filesUnder(dir, depth = PATTERN_SCAN_DEPTH) {
  if (depth === 0 || !existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.name !== "node_modules")
    .flatMap((entry) =>
      entry.isDirectory()
        ? filesUnder(join(dir, entry.name), depth - 1)
        : [join(dir, entry.name)],
    );
}

function withDotSlash(path) {
  return path.startsWith("./") ? path : `./${path}`;
}

function expandPattern(dir, key, target) {
  if (!isText(target) || !target.includes("*")) return [];
  const [targetPrefix, targetSuffix] = withDotSlash(target).split("*");
  const [keyPrefix, keySuffix] = key.split("*");
  const root = join(dir, targetPrefix);
  return filesUnder(targetPrefix.endsWith("/") ? root : dirname(root))
    .map((file) => withDotSlash(relative(dir, file)))
    .filter(
      (file) => file.startsWith(targetPrefix) && file.endsWith(targetSuffix),
    )
    .map(
      (file) =>
        `${keyPrefix}${file.slice(targetPrefix.length, file.length - targetSuffix.length)}${keySuffix}`,
    );
}

/** `{ dts }` for the subpath, `{ dts: null }` when untyped, `{ missing: true }` when not exported. */
export function entryDts(dir, pkg, subpath) {
  if (pkg.exports === undefined) return { dts: legacyEntry(dir, pkg, subpath) };
  const map = exportsMap(pkg.exports);
  const key = subpath ? `./${subpath}` : ".";
  const target = Object.hasOwn(map, key)
    ? typesTarget(map[key])
    : matchPattern(map, key);
  if (target === undefined || target === null) return { missing: true };
  return { dts: firstExisting(dtsCandidates(join(dir, target))) };
}

function exportedNames(text) {
  const named = [...text.matchAll(NAMED_EXPORT_RE)].flatMap((match) =>
    match[1]
      .split(",")
      .map((token) => token.trim().replace(/^type\s+/, ""))
      .filter(Boolean)
      .map((token) =>
        token
          .split(/\s+as\s+/)
          .pop()
          .trim(),
      ),
  );
  return [
    ...[...text.matchAll(DECLARATION_RE)].map((match) => match[1]),
    ...[...text.matchAll(STAR_AS_RE)].map((match) => match[1]),
    ...named,
    ...(DEFAULT_RE.test(text) ? ["default"] : []),
  ];
}

const EMPTY = { names: new Set(), permissive: false };

/** Resolves module specifiers against one project, with its own caches. */
export class ModuleResolver {
  #context;
  #packages = new Map();
  #files = new Map();
  #visiting = new Set();
  #modules = new Map();

  constructor({ project, offline = false, env = process.env }) {
    this.#context = { project: resolve(project), offline, env };
  }

  get project() {
    return this.#context.project;
  }

  #packageEntry(name) {
    if (!this.#packages.has(name)) {
      const local = localPackageDir(this.project, name);
      const dir = local ?? resolverPackageDir(this.#context, name);
      this.#packages.set(
        name,
        dir
          ? {
              dir,
              pkg: readJson(join(dir, "package.json")),
              source: local ? "local" : "resolver",
            }
          : null,
      );
    }
    return this.#packages.get(name);
  }

  async #starNames(specifier, fromFile) {
    if (!specifier.startsWith("."))
      return (
        (await this.resolveModule(specifier)).names ?? {
          names: new Set(),
          permissive: true,
        }
      );
    const target = firstExisting(
      dtsCandidates(resolve(dirname(fromFile), specifier)),
    );
    return target && !this.#visiting.has(target)
      ? this.#fileNames(target)
      : EMPTY;
  }

  #fileNames(file) {
    if (!this.#files.has(file))
      this.#files.set(file, this.#readFileNames(file));
    return this.#files.get(file);
  }

  async #readFileNames(file) {
    this.#visiting.add(file);
    const text = readFileSync(file, "utf8").replace(COMMENT_RE, "");
    const names = new Set(exportedNames(text));
    let permissive = EXPORT_ASSIGNMENT_RE.test(text);
    for (const match of text.matchAll(STAR_RE)) {
      const nested = await this.#starNames(match[1], file);
      for (const name of nested.names) if (name !== "default") names.add(name);
      permissive ||= nested.permissive;
    }
    this.#visiting.delete(file);
    return { names, permissive };
  }

  async #builtinModule(specifier) {
    const runtime = await import(specifier);
    return {
      specifier,
      status: STATUS.builtin,
      source: "node",
      names: { names: new Set(Object.keys(runtime)), permissive: false },
    };
  }

  async #packageModule(specifier) {
    const { name, subpath } = splitSpecifier(specifier);
    const entry = this.#packageEntry(name);
    if (!entry) return { specifier, status: STATUS.missingPackage };
    const { dts, missing } = entryDts(entry.dir, entry.pkg, subpath);
    if (missing)
      return { specifier, status: STATUS.missingSubpath, source: entry.source };
    if (!dts)
      return { specifier, status: STATUS.untyped, source: entry.source };
    return {
      specifier,
      status: STATUS.ok,
      source: entry.source,
      names: await this.#fileNames(dts),
    };
  }

  /** `{ specifier, status, source?, names?: { names: Set, permissive } }` */
  resolveModule(specifier) {
    if (!this.#modules.has(specifier)) {
      this.#modules.set(
        specifier,
        isBuiltin(specifier)
          ? this.#builtinModule(specifier)
          : this.#packageModule(specifier),
      );
    }
    return this.#modules.get(specifier);
  }

  /** Every public subpath of an installed package, as specifiers; `*` patterns expanded from disk. */
  packageSpecifiers(name) {
    const entry = this.#packageEntry(name);
    if (!entry) return [];
    if (entry.pkg.exports === undefined) return [name];
    return Object.entries(exportsMap(entry.pkg.exports))
      .filter(([key]) => key !== "./package.json")
      .flatMap(([key, target]) =>
        key.includes("*")
          ? expandPattern(entry.dir, key, typesTarget(target))
          : [key],
      )
      .map((key) => (key === "." ? name : `${name}/${key.slice(2)}`));
  }
}
