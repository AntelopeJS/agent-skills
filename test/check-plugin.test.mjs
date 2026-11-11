import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
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
const SYNC =
  'node "${PLUGIN_ROOT}/scripts/sync-skills.mjs" --quiet --target codex';
const EXACT_RULE =
  'Bash(node "${CLAUDE_SKILL_DIR}/../../scripts/sync-skills.mjs" --target claude)';
/** @type {string} */
let root;
/** @type {string} */
let plugin;

/**
 * @param {string} name
 * @param {string} body
 * @param {{ frontmatterName?: string, allowedTools?: string }} [options]
 */
function writeSkill(name, body, options = {}) {
  const { frontmatterName = name, allowedTools = `\n  - '${EXACT_RULE}'` } =
    options;
  writeFile(
    join(plugin, "skills", name, "SKILL.md"),
    `---\nname: ${frontmatterName}\ndescription: Does ${name}.\nallowed-tools: ${allowedTools}\n---\n${body}\n`,
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

/** @param {string} pattern */
function assertFails(pattern) {
  const { status, output } = check();
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(pattern, "m"));
}

beforeEach(() => {
  root = makeTempDir();
  plugin = join(root, "plugin");
  writeJson(join(root, "package.json"), { name: "plugin", version: "1.0.0" });
  writeJson(join(root, ".claude-plugin", "marketplace.json"), {
    plugins: [{ name: "antelopejs", source: "./plugin" }],
  });
  writeJson(join(root, ".agents", "plugins", "marketplace.json"), {
    plugins: [
      { name: "antelopejs", source: { source: "local", path: "./plugin" } },
    ],
  });
  writeFile(join(root, "CLAUDE.md"), "@AGENTS.md\n");
  writeJson(join(plugin, ".claude-plugin", "plugin.json"), {
    version: "1.0.0",
  });
  writeJson(join(plugin, ".codex-plugin", "plugin.json"), {
    version: "1.0.0",
    hooks: "./hooks/codex-hooks.json",
  });
  writeFile(join(plugin, "scripts", "sync-skills.mjs"), "export {};\n");
  writeJson(join(plugin, "hooks", "codex-hooks.json"), {
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: SYNC }] }],
    },
  });
  for (const name of [
    "dms-best-practices",
    "dms-builder-mcp",
    "dms-external-database",
    "dms-mockup",
    "dms-mockup-build",
    "dms-page-design",
    "dms-pages",
    "interface",
    "new-module",
    "skills",
    "sync-skills",
  ])
    writeSkill(
      name,
      "Run `node <skill-dir>/../../scripts/sync-skills.mjs --list`.",
    );
});

afterEach(() => removeDir(root));

void test("passes a plugin folder the marketplaces point at, with exact allowed-tools, silently", () => {
  assert.deepEqual(check(), { status: 0, output: "" });
});

void test("fails on a plugin.json at the repository or plugin root, which Codex reads before .codex-plugin", () => {
  writeJson(join(plugin, "plugin.json"), {
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  });
  assertFails("^plugin/plugin\\.json: ");
});

void test("fails when the Codex manifest points at other hooks", () => {
  writeJson(join(plugin, ".codex-plugin", "plugin.json"), {
    version: "1.0.0",
    hooks: "./hooks/hooks.json",
  });
  assertFails('\\.codex-plugin/plugin\\.json: "hooks"');
});

void test("fails when one manifest version lags behind", () => {
  writeJson(join(plugin, ".codex-plugin", "plugin.json"), {
    version: "0.9.0",
    hooks: "./hooks/codex-hooks.json",
  });
  assertFails("\\.codex-plugin/plugin\\.json 0\\.9\\.0");
});

for (const { file, source } of [
  {
    file: ".claude-plugin/marketplace.json",
    source: { name: "antelopejs", source: "./" },
  },
  {
    file: ".agents/plugins/marketplace.json",
    source: { name: "antelopejs", source: { source: "local", path: "./" } },
  },
]) {
  void test(`fails when ${file} lists the repository root as the plugin`, () => {
    writeJson(join(root, ...file.split("/")), { plugins: [source] });
    assertFails(`^${file.replaceAll(".", "\\.")}: a plugin source`);
  });
}

void test("fails on Claude hooks, which run a script the plugin directory cannot follow", () => {
  writeJson(join(plugin, "hooks", "hooks.json"), { hooks: {} });
  assertFails("^plugin/hooks/hooks\\.json: ");
});

void test("fails on a hooks field in the Claude manifest", () => {
  writeJson(join(plugin, ".claude-plugin", "plugin.json"), {
    version: "1.0.0",
    hooks: "./hooks/codex-hooks.json",
  });
  assertFails('\\.claude-plugin/plugin\\.json: "hooks" must be absent');
});

void test("fails on a commands directory", () => {
  writeFile(join(plugin, "commands", "interface.md"), "Look up the name.\n");
  assertFails("^plugin/commands/: ");
});

for (const placeholder of ["$ARGUMENTS", "$1", "${CLAUDE_PLUGIN_ROOT}"]) {
  void test(`fails on a skill body that uses ${placeholder}`, () => {
    writeSkill("interface", `Run the resolver on ${placeholder}.`);
    const { status, output } = check();
    assert.equal(status, 1);
    assert.ok(output.includes(`"${placeholder}"`), output);
  });
}

/** @param {string} rule */
const list = (rule) => `\n  - '${rule}'`;

for (const rule of [
  "Bash(node:*)",
  "Bash(pnpm *)",
  "Bash(*)",
  "Bash(node -e *)",
  "Bash(node * *)",
  "Bash(sh -c *)",
  "Bash(pnpm add *)",
  'Bash(node "${CLAUDE_SKILL_DIR}/../../scripts/../../x.mjs" *)',
  'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/missing.mjs" *)',
  'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/sync-skills.mjs"; rm -rf *)',
  "Bash(sudo sh *)",
  "Bash(busybox sh *)",
  "Bash(nice bash *)",
  "Bash(nohup node *)",
  "Bash(find src *)",
]) {
  void test(`fails on allowed-tools ${rule}, which pre-approves more than one command`, () => {
    writeSkill("interface", "Resolve.", { allowedTools: list(rule) });
    assertFails("interface/SKILL\\.md: allowed-tools .* pre-approves");
  });
}

for (const [name, allowedTools] of Object.entries({
  "an inline list": " ['Bash(node:*)']",
  "a trailing comment": "\n  - Bash(node:*) # debug",
  "a comment line":
    "\n  - Bash(ajs module init *)\n  # debug\n  - Bash(node:*)",
  "a blank line": "\n  - Bash(ajs module init *)\n\n  - Bash(node:*)",
  "a tag": "\n  - !!str Bash(*)",
  "an anchor": "\n  - &a Bash(*)",
  "another tool": "\n  - PowerShell(*)",
  "a bare Bash": "\n  - Bash",
})) {
  void test(`fails on allowed-tools written with ${name}, where a YAML parser could read a rule this check skips`, () => {
    writeSkill("interface", "Resolve.", { allowedTools });
    assertFails("interface/SKILL\\.md: frontmatter line .* is not a");
  });
}

void test("fails on allowed-tools behind a bare carriage return, which YAML reads as a line break", () => {
  writeFile(
    join(plugin, "skills", "interface", "SKILL.md"),
    "---\nname: interface\ndescription: Does interface.\n  # c\rallowed-tools:\r  - Bash(*)\n---\nResolve.\n",
  );
  assertFails(
    'interface/SKILL\\.md: allowed-tools "Bash\\(\\*\\)" pre-approves',
  );
});

for (const [name, key] of Object.entries({
  "a double-quoted key": '"allowed-tools":',
  "a single-quoted key": "'allowed-tools':",
  "a space before the colon": "allowed-tools :",
  "an explicit key": "? allowed-tools\n:",
})) {
  void test(`fails on allowed-tools spelled with ${name}, which hides its rules from a line-based reader`, () => {
    writeFile(
      join(plugin, "skills", "interface", "SKILL.md"),
      `---\nname: interface\ndescription: Does interface.\n${key}\n  - Bash(*)\n---\nResolve.\n`,
    );
    assertFails("interface/SKILL\\.md: frontmatter line ");
  });
}

void test("passes allowed-tools that name a plugin script by either path or a program's subcommand", () => {
  writeSkill("new-module", "Scaffold.", {
    allowedTools: [
      "",
      "  - Bash(ajs module init *)",
      "  - Bash(ajs project modules install)",
      `  - 'Bash(node "\${CLAUDE_SKILL_DIR}/../../scripts/sync-skills.mjs" --list *)'`,
      `  - 'Bash(node "\${CLAUDE_PLUGIN_ROOT}/scripts/sync-skills.mjs" --list *)'`,
    ].join("\n"),
  });
  assert.deepEqual(check(), { status: 0, output: "" });
});

void test("fails on a skill whose name differs from its directory", () => {
  writeSkill("sync-skills", "Sync.", { frontmatterName: "sync" });
  assertFails('sync-skills/SKILL\\.md: "name" must be "sync-skills"');
});

void test("fails on a skill beyond the plugin's own, which would shadow a package-shipped one", () => {
  writeSkill("ajs-cli", "Drive the ajs CLI.");
  assertFails("^plugin/skills/ajs-cli: ");
});

void test("fails when one of the plugin's skills is missing", () => {
  removeDir(join(plugin, "skills", "new-module"));
  assertFails("new-module/SKILL\\.md: missing");
});

void test("fails, naming the file, when the Codex hook file is not shaped as hooks", () => {
  writeJson(join(plugin, "hooks", "codex-hooks.json"), {
    hooks: { SessionStart: "node sync" },
  });
  assertFails("hooks/codex-hooks\\.json: not shaped as a hooks file");
});

void test("fails on a CLAUDE.md in the plugin folder, which is never loaded", () => {
  writeFile(join(plugin, "CLAUDE.md"), "@AGENTS.md\n");
  assertFails("^plugin/CLAUDE\\.md: ");
});

void test("fails on a symbolic link in the plugin folder", () => {
  symlinkSync("../../AGENTS.md", join(plugin, "skills", "link.md"));
  assertFails("^plugin/skills/link\\.md: a symbolic link");
});

void test("fails on a download-and-run launcher in a plugin file", () => {
  writeSkill(
    "interface",
    "Run `npx -y github:AntelopeJS/agent-skills interface`.",
  );
  assertFails('^plugin/skills/interface/SKILL\\.md: "npx"');
});

void test("ignores symbolic links in node_modules, which the plugin does not commit", () => {
  writeFile(join(plugin, "packages", "lib", "index.mjs"), "export {};\n");
  symlinkSync("../lib", join(plugin, "packages", "lib", "node_modules"));
  assert.deepEqual(check(), { status: 0, output: "" });
});
