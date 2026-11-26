#!/usr/bin/env node
import {
  cmdContract,
  cmdImplementations,
  cmdList,
  cmdShow,
  cmdVersions,
} from "./lib/resolver/commands.mjs";
import { fail, flags } from "./lib/resolver/support.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0];
const positional = argv.slice(1).filter((a) => !a.startsWith("--"));
const json = flags.has("--json");

/** @type {Record<string, () => void | Promise<void>>} */
const COMMANDS = {
  list: () => cmdList(json),
  show: () => cmdShow(positional[0], json),
  contract: () => cmdContract(positional[0], positional[1]),
  versions: () => cmdVersions(positional[0]),
  implementations: () => cmdImplementations(positional[0]),
};

const handler = COMMANDS[cmd];
if (!handler) {
  fail(
    `unknown command '${cmd ?? ""}'. One of: ${Object.keys(COMMANDS).join(", ")}`,
  );
}
if (cmd !== "list" && !positional[0])
  fail(`'${cmd}' requires an interface name`);
await handler();
