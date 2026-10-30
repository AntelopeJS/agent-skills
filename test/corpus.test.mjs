import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { parseFrontmatter } from "../scripts/lib/frontmatter.mjs";
import { loadCorpus } from "../scripts/lib/corpus.mjs";
import { compareText } from "../scripts/lib/values.mjs";
import {
  makeTempDir,
  removeDir,
  writeFile,
  writeSkillPackage,
  writeAntelopeConfig,
  link,
} from "./helpers.mjs";

let root;

beforeEach(() => {
  root = makeTempDir();
});

afterEach(() => {
  removeDir(root);
});

function writeSkill(dir, frontmatter, body = "Body.\n") {
  writeFile(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n${body}`);
}

void test("frontmatter keeps plain, quoted, folded and list values", () => {
  const text = [
    "---",
    "name: dms-pages",
    'description: "Declares pages: forms, tables."',
    "summary: >-",
    "  First line",
    "  second line",
    "tags: [pages, blocks]",
    "---",
    "# Body",
  ].join("\n");

  const { data, body } = parseFrontmatter(text);

  assert.equal(data.name, "dms-pages");
  assert.equal(data.description, "Declares pages: forms, tables.");
  assert.equal(data.summary, "First line second line");
  assert.deepEqual(data.tags, ["pages", "blocks"]);
  assert.equal(body, "# Body");
});

void test("a file without frontmatter yields no data", () => {
  assert.deepEqual(parseFrontmatter("# Title\n").data, {});
});

void test("loads every SKILL.md under explicit directories, a skill dir or a parent of skill dirs", () => {
  writeSkill(
    join(root, "pack", "skills", "dms-pages"),
    "name: dms-pages\ndescription: Builds pages.",
  );
  writeSkill(
    join(root, "pack", "skills", "dms-auth"),
    "name: dms-auth\ndescription: Wires auth.",
  );
  writeSkill(join(root, "single"), "name: lone\ndescription: Alone.");

  const corpus = loadCorpus({
    dirs: [join(root, "pack"), join(root, "single")],
  });

  assert.deepEqual(corpus.skills.map((s) => s.name).sort(compareText), [
    "dms-auth",
    "dms-pages",
    "lone",
  ]);
  const pages = corpus.skills.find((s) => s.name === "dms-pages");
  assert.equal(pages.description, "Builds pages.");
  assert.match(pages.content, /Body\./);
});

void test("falls back to the directory name when the frontmatter has no name", () => {
  writeSkill(join(root, "skills", "unnamed"), "description: No name.");

  const corpus = loadCorpus({ dirs: [join(root, "skills")] });

  assert.equal(corpus.skills[0].name, "unnamed");
});

void test("keeps the first skill of a name and reports the duplicate", () => {
  writeSkill(join(root, "a", "dms"), "name: dms\ndescription: First.");
  writeSkill(join(root, "b", "dms"), "name: dms\ndescription: Second.");

  const corpus = loadCorpus({ dirs: [join(root, "a"), join(root, "b")] });

  assert.equal(corpus.skills.length, 1);
  assert.equal(corpus.skills[0].description, "First.");
  assert.equal(corpus.duplicates.length, 1);
});

void test("discovers package-shipped skills of a project like the sync does", () => {
  writeAntelopeConfig(root);
  const store = join(
    root,
    "node_modules",
    ".pnpm",
    "dms",
    "node_modules",
    "@antelopejs",
    "dms",
  );
  writeSkillPackage(store, "@antelopejs/dms", ["dms", "dms-pages"]);
  link(store, join(root, "node_modules", "@antelopejs", "dms"));
  writeSkillPackage(
    join(root, ".antelope", "cache", "@antelopejs", "dms-mailing"),
    "@antelopejs/dms-mailing",
    ["dms-mailing"],
  );

  const corpus = loadCorpus({ project: root });

  assert.deepEqual(corpus.skills.map((s) => s.name).sort(compareText), [
    "dms",
    "dms-mailing",
    "dms-pages",
  ]);
  assert.equal(
    corpus.skills.find((s) => s.name === "dms").source,
    "@antelopejs/dms",
  );
});

void test("a directory that is not an AntelopeJS project contributes nothing", () => {
  const corpus = loadCorpus({ project: root });

  assert.deepEqual(corpus.skills, []);
});

void test("reads the skills a fetched package declares", () => {
  const fetched = join(root, "fetched", "package");
  writeSkillPackage(fetched, "@antelopejs/dms-media", ["dms-media"]);
  const requested = [];

  const corpus = loadCorpus({
    packages: ["@antelopejs/dms-media@latest"],
    fetch: (spec) => {
      requested.push(spec);
      return fetched;
    },
  });

  assert.deepEqual(requested, ["@antelopejs/dms-media@latest"]);
  assert.deepEqual(
    corpus.skills.map((s) => [s.name, s.source]),
    [["dms-media", "@antelopejs/dms-media"]],
  );
});
