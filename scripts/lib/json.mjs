import { readFileSync } from "node:fs";

/**
 * Parses JSON text. The result is `unknown` until the caller narrows it.
 * @param {string} text
 * @returns {unknown}
 */
export function parseJson(text) {
  return JSON.parse(text);
}

/**
 * Reads and parses a JSON file. The result is `unknown` until the caller narrows it.
 * @param {string | URL} file
 * @returns {unknown}
 */
export function readJsonFile(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}
