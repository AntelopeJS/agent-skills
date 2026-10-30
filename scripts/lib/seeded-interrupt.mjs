import { constants } from "node:os";

/**
 * The handle on the trapped signals.
 * @typedef {object} InterruptTrap
 * @property {AbortSignal} signal Aborts on the first signal.
 * @property {AbortSignal} forceSignal Aborts on the second signal.
 * @property {number | undefined} exitCode 128 plus the first signal's number, once one arrived.
 * @property {() => void} release
 */

/** @type {NodeJS.Signals[]} */
const SIGNALS = ["SIGINT", "SIGTERM"];
const SIGNAL_EXIT_BASE = 128;

/**
 * Traps SIGINT and SIGTERM for the run of the seeded eval. The first signal
 * aborts `signal`, which kills every live agent's process group; the run then
 * stops the harness runs and removes the folders, and `exitCode` holds 128 plus
 * the signal number. A second signal aborts `forceSignal`, which kills the stop
 * commands, and exits the process at once with 128 plus its number. `release` removes the handlers.
 * @param {{ proc?: NodeJS.Process }} [where]
 * @returns {InterruptTrap}
 */
export function trapInterrupt({ proc = process } = {}) {
  const first = new AbortController();
  const second = new AbortController();
  /** @type {InterruptTrap} */
  const trap = {
    signal: first.signal,
    forceSignal: second.signal,
    exitCode: undefined,
    release: () => {
      for (const name of SIGNALS) proc.removeListener(name, handlers[name]);
    },
  };
  const handlers = Object.fromEntries(
    SIGNALS.map((name) => [
      name,
      () => {
        const code = SIGNAL_EXIT_BASE + constants.signals[name];
        if (first.signal.aborted) {
          second.abort();
          proc.exit(code);
          return;
        }
        trap.exitCode = code;
        first.abort();
      },
    ]),
  );
  for (const name of SIGNALS) proc.on(name, handlers[name]);
  return trap;
}
