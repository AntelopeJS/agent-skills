import { existsSync, readFileSync, readdirSync } from "node:fs";

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readText(path) {
  return readFileSync(path, "utf8");
}

export function exists(path) {
  return existsSync(path);
}

export function listDir(path) {
  return readdirSync(path);
}
