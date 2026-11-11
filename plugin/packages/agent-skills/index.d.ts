/** Where a skill-shipping package was found. */
export type SkillPackageKind =
  | "module"
  | "dependency"
  | "project"
  | "installed";

/** A package that ships agent skills. */
export interface SkillPackage {
  /** The `name` of its `package.json`, or the fallback name the caller or the dependency list gave it. */
  name: string;
  /** The `version` of its `package.json`, or `null` when it has none. */
  version: string | null;
  /** The package root. */
  dir: string;
  /** Absolute directories declared in `antelopeJs.skills`, each inside {@link SkillPackage.dir}. Never empty. */
  skillDirs: string[];
  /**
   * `module` for a module itself, `dependency` for a dependency of a module,
   * `project` for a dependency of the project root, `installed` for a
   * directory listed in {@link CollectSkillPackagesInput.installed}.
   */
  kind: SkillPackageKind;
}

/** A module the runtime loads. */
export interface ModuleRef {
  /** The module's package root. */
  dir: string;
  /** The name to use when its `package.json` has none. */
  id?: string;
}

export interface CollectSkillPackagesInput {
  /** Loaded modules, in priority order. Each reserves its package name even when it ships no skills. */
  modules: readonly ModuleRef[];
  /** The project root; its `dependencies`, `optionalDependencies` and `devDependencies` are read. */
  project?: string;
  /**
   * Extra package directories, lowest priority. One whose `package.json` sets
   * `antelopeJs.implements` is a module the runtime can load, so it also counts
   * as a module, after {@link CollectSkillPackagesInput.modules}.
   */
  installed?: readonly string[];
  /** Called with a message for each skill directory dropped because it escapes its package. */
  onWarning?: (message: string) => void;
}

/**
 * Collects the packages that ship agent skills, in priority order, one per
 * package name: modules (installed interface implementations included), then
 * their dependencies, then the project's dependencies, then `installed`. The
 * first candidate to carry a name keeps it.
 * Only packages with at least one skill directory are returned.
 */
export function collectSkillPackages(
  input: CollectSkillPackagesInput,
): SkillPackage[];

/**
 * Absolute path of the DMS workflow skills (`dms-pages`, `dms-builder-mcp`,
 * `dms-mockup`, …) of the `antelopejs` plugin, copied into the published
 * package: one directory per skill, each holding a `SKILL.md`. A caller loads
 * them like the skills of {@link collectSkillPackages}. A source checkout has
 * no such directory until the package is packed.
 */
export declare const workflowSkillsDir: string;
