import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { makeTempDir, removeDir, writeFile, writeJson } from "./helpers.mjs";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "check-plugin.mjs",
);
/** @type {string} */
let root;

/**
 * @param {string} rootVariable
 * @param {string} target
 */
function hooks(rootVariable, target) {
  const command = `node "${rootVariable}/scripts/sync-skills.mjs" --quiet ${target}`;
  return {
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command, timeout: 30 }] }],
      PostToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command, timeout: 30 }],
        },
      ],
    },
  };
}

/**
 * @param {string} name
 * @param {string} body
 * @param {string} [frontmatterName]
 */
function writeSkill(name, body, frontmatterName = name) {
  writeFile(
    join(root, "skills", name, "SKILL.md"),
    `---\nname: ${frontmatterName}\ndescription: Does ${name}.\n---\n${body}\n`,
  );
}

function check() {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    [SCRIPT, root],
    { encoding: "utf8" },
  );
  return { status, output: stdout + stderr };
}

beforeEach(() => {
  root = makeTempDir();
  writeJson(join(root, "package.json"), { name: "plugin", version: "1.0.0" });
  writeJson(join(root, ".claude-plugin", "plugin.json"), { version: "1.0.0" });
  writeJson(join(root, ".codex-plugin", "plugin.json"), {
    version: "1.0.0",
    hooks: "./hooks/codex-hooks.json",
  });
  writeJson(
    join(root, "hooks", "hooks.json"),
    hooks("${CLAUDE_PLUGIN_ROOT}", "--target claude"),
  );
  writeJson(join(root, "hooks", "codex-hooks.json"), {
    description: "Codex only",
    ...hooks("${PLUGIN_ROOT}", "--target codex"),
  });
  for (const name of [
    "eval-skills",
    "interface",
    "new-module",
    "skills",
    "sync-skills",
  ]) {
    writeSkill(
      name,
      "Run `node <skill-dir>/../../scripts/sync-skills.mjs --list`.",
    );
  }
});

afterEach(() => removeDir(root));

void test("passes a plugin whose hook files differ only in the root variable and target, silently", () => {
  assert.deepEqual(check(), { status: 0, output: "" });
});

void test("fails on a root plugin.json, which Codex reads before .codex-plugin", () => {
  writeJson(join(root, "plugin.json"), {
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  });
  const { status, output } = check();
  assert.equal(status, 1);
  assert.match(output, /^plugin\.json: /m);
});

void test("fails when the Codex manifest points at the Claude hooks", () => {
  writeJson(join(root, ".codex-plugin", "plugin.json"), {
    version: "1.0.0",
    hooks: "./hooks/hooks.json",
  });
  const { status, output } = check();
  assert.equal(status, 1);
  assert.match(output, /\.codex-plugin\/plugin\.json: "hooks"/);
});

void test("fails when one manifest version lags behind", () => {
  writeJson(join(root, ".codex-plugin", "plugin.json"), {
    version: "0.9.0",
    hooks: "./hooks/codex-hooks.json",
  });
  const { status, output } = check();
  assert.equal(status, 1);
  assert.match(output, /\.codex-plugin\/plugin\.json 0\.9\.0/);
});

void test("fails on a commands directory", () => {
  writeFile(join(root, "commands", "interface.md"), "Look up $ARGUMENTS.\n");
  const { status, output } = check();
  assert.equal(status, 1);
  assert.match(output, /^commands\/: /m);
});

for (const placeholder of ["$ARGUMENTS", "$1", "${CLAUDE_PLUGIN_ROOT}"]) {
  void test(`fails on a skill body that uses ${placeholder}`, () => {
    writeSkill("interface", `Run the resolver on ${placeholder}.`);
    const { status, output } = check();
    assert.equal(status, 1);
    assert.ok(output.includes(`"${placeholder}"`), output);
  });
}

void test("fails on a skill whose name differs from its directory", () => {
  writeSkill("sync-skills", "Sync.", "sync");
  const { status, output } = check();
  assert.equal(status, 1);
  assert.match(output, /sync-skills\/SKILL\.md: "name" must be "sync-skills"/);
});

void test("fails on a skill beyond the plugin's own, which would shadow a package-shipped one", () => {
  writeSkill("ajs-cli", "Drive the ajs CLI.");
  const { status, output } = check();
  assert.equal(status, 1);
  assert.match(output, /^skills\/ajs-cli: /m);
});

void test("fails when one of the plugin's skills is missing", () => {
  removeDir(join(root, "skills", "new-module"));
  const { status, output } = check();
  assert.equal(status, 1);
  assert.match(output, /new-module\/SKILL\.md: missing/);
});

void test("fails when the hook files differ in more than the tool-specific values", () => {
  const codex = hooks("${PLUGIN_ROOT}", "--target codex");
  codex.hooks.PostToolUse[0].matcher = "Edit";
  writeJson(join(root, "hooks", "codex-hooks.json"), codex);
  const { status, output } = check();
  assert.equal(status, 1);
  assert.match(output, /must run the same commands on the same events/);
});

void test("fails, naming the file, when a hook file is not shaped as hooks", () => {
  writeJson(join(root, "hooks", "codex-hooks.json"), {
    hooks: { SessionStart: "node sync" },
  });
  const { status, output } = check();
  assert.equal(status, 1);
  assert.match(output, /hooks\/codex-hooks\.json: not shaped as a hooks file/);
});
