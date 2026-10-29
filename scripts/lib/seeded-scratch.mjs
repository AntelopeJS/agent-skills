import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SKILLS_DIR } from "./seeded-cases.mjs";

export const DEFAULT_SETUP =
  "pnpm install --frozen-lockfile --prefer-offline --ignore-scripts";
const AUTHOR = ["-c", "user.name=seeded-eval", "-c", "user.email=eval@invalid"];
const SETUP_TIMEOUT_MS = 900_000;
const HIDDEN = ["seeded-breaks", "seeded-doors"];
const NO_PUSH_URL = "file:///seeded-eval-push-disabled";

function pathsOf(dir, patch) {
  return git(dir, ["apply", "--numstat", patch])
    .split("\n")
    .map((line) => line.split("\t")[2])
    .filter(Boolean);
}

function touchFiles(dir, patch) {
  for (const path of pathsOf(dir, patch))
    if (existsSync(join(dir, path))) appendFileSync(join(dir, path), "\n");
}

function originOf(checkout) {
  try {
    return git(checkout, ["remote", "get-url", "origin"]);
  } catch {
    return undefined;
  }
}

function git(cwd, args) {
  return execFileSync("git", [...AUTHOR, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Environment of the setup command: the caller's, with `CI` set. The caller strips the credentials (`withoutCredentials`, applied in seeded-command.mjs). */
function setupEnv(env) {
  return { ...env, CI: "1" };
}

/**
 * Builds the scratch checkout one case runs in. It is a fresh single-commit
 * repository holding the tracked files of `checkout`'s `ref`, with the seeded
 * patches removed and no history, so the verifier cannot read them. `origin`
 * keeps the checkout's URL, which verdict rendering reads, but its push URL is
 * disabled; `origin/main` points at the base commit, the diff base the skills
 * default to. The case's patch, when
 * there is one, becomes the commit on top of it. `setup` runs between the two.
 */
export function createScratch({
  checkout,
  skill,
  patch,
  touch = false,
  ref = "HEAD",
  root = tmpdir(),
  setup = DEFAULT_SETUP,
  env = process.env,
}) {
  const base = mkdtempSync(join(root, "seeded-eval-"));
  const dir = join(base, "repo");
  mkdirSync(dir);
  try {
    const archive = join(base, "head.tar");
    git(checkout, ["archive", "--format=tar", "-o", archive, ref]);
    execFileSync("tar", ["-xf", archive, "-C", dir]);
    rmSync(archive);
    for (const name of HIDDEN)
      rmSync(join(dir, SKILLS_DIR, skill, name), {
        recursive: true,
        force: true,
      });
    git(dir, ["init", "-q", "-b", "main"]);
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "--no-verify", "-m", "base"]);
    const baseSha = git(dir, ["rev-parse", "HEAD"]);
    git(dir, ["update-ref", "refs/remotes/origin/main", baseSha]);
    const origin = originOf(checkout);
    if (origin) {
      git(dir, ["remote", "add", "origin", origin]);
      git(dir, ["remote", "set-url", "--push", "origin", NO_PUSH_URL]);
    }
    if (setup)
      execFileSync("sh", ["-c", setup], {
        cwd: dir,
        env: setupEnv(env),
        stdio: ["ignore", "ignore", "pipe"],
        timeout: SETUP_TIMEOUT_MS,
      });
    if (patch) {
      if (touch) touchFiles(dir, patch);
      else git(dir, ["apply", patch]);
      git(dir, ["add", "-A"]);
      git(dir, ["commit", "-q", "--no-verify", "-m", "change under review"]);
    }
    return { base, dir, baseSha, headSha: git(dir, ["rev-parse", "HEAD"]) };
  } catch (error) {
    rmSync(base, { recursive: true, force: true });
    throw error;
  }
}

export function removeScratch(scratch) {
  rmSync(scratch.base, { recursive: true, force: true });
}
