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

const SCRIPTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
);

export function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "ajs-plugin-test-"));
}

export function removeDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}

export function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function writeJson(path, value) {
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function link(target, path) {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(relative(dirname(path), target), path);
}

/** Writes a package declaring `antelopeJs.skills` with one SKILL.md per skill name. */
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

export function writeAntelopeConfig(dir) {
  writeFile(join(dir, "antelope.config.ts"), "export default {};\n");
}

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

export function runJson(script, cwd, args = []) {
  return JSON.parse(runScript(script, cwd, [...args, "--json"]));
}

/** A corpus skill as `loadCorpus` returns it. */
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

/** A trigger case expecting `skills`. */
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
