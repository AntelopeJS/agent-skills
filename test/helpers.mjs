import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** @typedef {import("../scripts/lib/dataset.mjs").EvalCase} EvalCase */
/** @typedef {import("../scripts/lib/dataset.mjs").EvalExpect} EvalExpect */
/** @typedef {import("../scripts/lib/requests.mjs").RunSkill} RunSkill */

/**
 * What `caseOf` lets a test change: the fields of a case besides its id and
 * skills, with `expect` merged over `{ skills }`.
 * @typedef {object} CaseOverrides
 * @property {EvalCase["area"]} [area]
 * @property {EvalCase["style"]} [style]
 * @property {string} [prompt]
 * @property {EvalCase["origin"]} [origin]
 * @property {Partial<EvalExpect>} [expect]
 */

/**
 * What `skillOf` lets a test change in a corpus skill.
 * @typedef {object} SkillOverrides
 * @property {string} [description]
 * @property {string} [content]
 * @property {string} [dir]
 * @property {string} [source]
 */

const SCRIPTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
);

/**
 * @returns {string}
 */
export function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "ajs-plugin-test-"));
}

/**
 * @param {string} dir
 * @returns {void}
 */
export function removeDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * @param {string} path
 * @param {string} content
 * @returns {void}
 */
export function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/**
 * @param {string} path
 * @param {unknown} value
 * @returns {void}
 */
export function writeJson(path, value) {
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * @param {string} target
 * @param {string} path
 * @returns {void}
 */
export function link(target, path) {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(relative(dirname(path), target), path);
}

/**
 * Writes a package declaring `antelopeJs.skills` with one SKILL.md per skill name.
 * @param {string} dir
 * @param {string} name
 * @param {string[]} skills
 * @param {string} [version]
 * @returns {void}
 */
export function writeSkillPackage(dir, name, skills, version = "1.0.0") {
  writeJson(join(dir, "package.json"), {
    name,
    version,
    antelopeJs: { skills: ["./skills"] },
  });
  for (const skill of skills) {
    writeFile(
      join(dir, "skills", skill, "SKILL.md"),
      `---\nname: ${skill}\ndescription: test\n---\n`,
    );
  }
}

/**
 * @param {string} dir
 * @returns {void}
 */
export function writeAntelopeConfig(dir) {
  writeFile(join(dir, "antelope.config.ts"), "export default {};\n");
}

/**
 * @param {string} script
 * @param {string} cwd
 * @param {string[]} [args]
 * @returns {string}
 */
export function runScript(script, cwd, args = []) {
  const stdout = execFileSync(
    process.execPath,
    [join(SCRIPTS_DIR, script), ...args],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return stdout;
}

/**
 * @param {string} script
 * @param {string} cwd
 * @param {string[]} [args]
 * @returns {unknown}
 */
export function runJson(script, cwd, args = []) {
  return JSON.parse(runScript(script, cwd, [...args, "--json"]));
}

/**
 * A corpus skill as `loadCorpus` returns it.
 * @param {string} name
 * @param {SkillOverrides} [extra]
 * @returns {RunSkill & { dir: string }}
 */
export function skillOf(name, extra = {}) {
  return {
    name,
    description: `${name} description`,
    content: `Body of ${name}.`,
    dir: "/nowhere",
    source: "test",
    ...extra,
  };
}

/**
 * A trigger case expecting `skills`.
 * @param {string} id
 * @param {string[]} skills
 * @param {CaseOverrides} [extra]
 * @returns {EvalCase}
 */
export function caseOf(id, skills, extra = {}) {
  const { expect = {}, ...rest } = extra;
  return {
    id,
    area: "dms",
    style: "clean",
    prompt: `prompt of ${id}`,
    expect: { skills, ...expect },
    ...rest,
  };
}
