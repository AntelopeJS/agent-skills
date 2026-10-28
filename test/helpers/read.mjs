import { existsSync, readFileSync } from "node:fs";

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readText(path) {
  return readFileSync(path, "utf8");
}

export function exists(path) {
  return existsSync(path);
}
