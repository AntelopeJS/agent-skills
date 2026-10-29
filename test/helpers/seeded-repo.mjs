import { execFileSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { join } from "node:path";

import { makeTempDir, writeFile } from "../helpers.mjs";

const AUTHOR = ["-c", "user.name=t", "-c", "user.email=t@invalid"];

function git(cwd, args) {
  return execFileSync("git", [...AUTHOR, ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
}

function patchOf(dir, file, content) {
  writeFile(join(dir, file), content);
  const patch = git(dir, ["diff"]);
  git(dir, ["checkout", "--", file]);
  return `${patch}\n`;
}

/**
 * A git checkout with a verification skill `verify-demo` that holds one seeded
 * break (`alpha`, changing src/alpha.txt) and one seeded door (`data`, changing
 * src/data.txt), committed on `main`.
 */
export function makeSeededRepo() {
  const dir = makeTempDir();
  git(dir, ["init", "-q", "-b", "main"]);
  writeFile(join(dir, "src", "alpha.txt"), "alpha\n");
  writeFile(join(dir, "src", "data.txt"), "data\n");
  writeFile(
    join(dir, ".agents/skills/verify-demo/SKILL.md"),
    "# Verify demo\n",
  );
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "init"]);
  const skill = join(dir, ".agents/skills/verify-demo");
  writeFile(
    join(skill, "seeded-breaks", "alpha.patch"),
    patchOf(dir, "src/alpha.txt", "broken\n"),
  );
  writeFile(
    join(skill, "seeded-doors", "data.patch"),
    patchOf(dir, "src/data.txt", "migrated\n"),
  );
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "seed"]);
  git(dir, ["remote", "add", "origin", "https://github.com/Acme/demo.git"]);
  return dir;
}

/** Runs git in `dir`. */
export function gitIn(dir, args) {
  return git(dir, args);
}

/**
 * An executable that stands for `claude`: it prints `reply` as the JSON the
 * CLI prints, and records its arguments, working directory and HOME in
 * `calls.log` beside it.
 */
export function makeFakeClaude(dir, reply) {
  const bin = join(dir, "fake-claude.mjs");
  writeFile(
    bin,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(join(dir, "calls.log"))}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), home: process.env.HOME, token: process.env.GH_TOKEN ?? null }) + "\\n");
process.stdin.resume();
process.stdin.on("end", () => process.stdout.write(${JSON.stringify(JSON.stringify(reply))}));
`,
  );
  chmodSync(bin, 0o755);
  return bin;
}
