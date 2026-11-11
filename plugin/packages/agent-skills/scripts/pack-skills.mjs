import { cpSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const PACKAGE_DIR = join(import.meta.dirname, "..");
const PLUGIN_SKILLS_DIR = join(PACKAGE_DIR, "..", "..", "skills");
const PACKED_SKILLS_DIR = join(PACKAGE_DIR, "skills");
const WORKFLOW_SKILL_RE = /^dms-/;

rmSync(PACKED_SKILLS_DIR, { recursive: true, force: true });
if (!process.argv.includes("--clean"))
  for (const name of readdirSync(PLUGIN_SKILLS_DIR).filter((entry) =>
    WORKFLOW_SKILL_RE.test(entry),
  ))
    cpSync(join(PLUGIN_SKILLS_DIR, name), join(PACKED_SKILLS_DIR, name), {
      recursive: true,
    });
