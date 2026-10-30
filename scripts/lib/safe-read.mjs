/**
 * Reads that fall back to an empty value instead of throwing, and the typed
 * property read for the `unknown` that a JSON read returns.
 */

import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";

import { isRecord } from "./values.mjs";

/**
 * @param {string} path
 * @returns {unknown}
 */
export function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {string} path
 * @returns {string}
 */
export function readTextSafe(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * @param {string} path
 * @returns {import("node:fs").Stats | null}
 */
export function lstatSafe(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/**
 * @param {string} path
 * @returns {boolean}
 */
export function isDirectorySafe(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * @param {string} path
 * @returns {string[]}
 */
export function readdirSafe(path) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

/**
 * The `key` property of `value` when it is an object, undefined otherwise.
 * @param {unknown} value
 * @param {string} key
 * @returns {unknown}
 */
export function fieldOf(value, key) {
  return isRecord(value) ? value[key] : undefined;
}
