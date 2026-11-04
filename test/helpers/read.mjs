import { existsSync, readFileSync, readdirSync } from "node:fs";

/**
 * @param {string} path
 * @returns {unknown}
 */
export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * @param {string} path
 * @returns {string}
 */
export function readText(path) {
  return readFileSync(path, "utf8");
}

/**
 * @param {string} path
 * @returns {boolean}
 */
export function exists(path) {
  return existsSync(path);
}

/**
 * @param {string} path
 * @returns {string[]}
 */
export function listDir(path) {
  return readdirSync(path);
}
