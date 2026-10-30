import { runScript } from "../helpers.mjs";
import { parseJson } from "./json.mjs";
import { isRecord, isText } from "../../scripts/lib/values.mjs";

/**
 * @typedef {import("../../scripts/sync-skills.mjs").SyncResult & { project: boolean, dryRun?: boolean }} SyncOutput
 */

/**
 * @param {unknown} value
 * @returns {value is string[]}
 */
function isTextList(value) {
  return Array.isArray(value) && value.every(isText);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isTargetResult(value) {
  return (
    isRecord(value) &&
    isText(value.target) &&
    isText(value.dir) &&
    isTextList(value.added) &&
    isTextList(value.removed) &&
    isTextList(value.kept)
  );
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isListedSkill(value) {
  return (
    isRecord(value) &&
    isText(value.name) &&
    isText(value.target) &&
    isText(value.package) &&
    isText(value.origin) &&
    isText(value.skill) &&
    "version" in value &&
    isRecord(value.status) &&
    Object.values(value.status).every(isText)
  );
}

/**
 * @param {unknown} value
 * @returns {value is SyncOutput}
 */
function isSyncOutput(value) {
  return (
    isRecord(value) &&
    (value.project === true || value.project === false) &&
    Array.isArray(value.targets) &&
    value.targets.every(isTargetResult) &&
    isTextList(value.warnings) &&
    Array.isArray(value.skills) &&
    value.skills.every(isListedSkill)
  );
}

/**
 * Parses the `--json` summary of the sync script.
 * @param {string} text
 * @returns {SyncOutput}
 */
export function parseSyncOutput(text) {
  const parsed = parseJson(text);
  if (!isSyncOutput(parsed)) throw new Error(`unexpected sync output: ${text}`);
  return parsed;
}

/**
 * Runs the sync script in `cwd` and reads its `--json` summary.
 * @param {string} script
 * @param {string} cwd
 * @param {string[]} [args]
 * @returns {SyncOutput}
 */
export function runSyncJson(script, cwd, args = []) {
  return parseSyncOutput(runScript(script, cwd, [...args, "--json"]));
}
