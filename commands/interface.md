---
description: Look up an AntelopeJS interface contract (surface, versions, or full TSDoc)
argument-hint: <name> [subpath]
allowed-tools: Bash(node:*)
---

Resolve the AntelopeJS interface contract for `$ARGUMENTS` and present it to the user.

Run the resolver and answer from its output — never from memory, since contracts are versioned and change:

- If only an interface name was given, show the surface and versions:
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-interface.mjs" show $1`
- If a subpath was also given, print the full TSDoc'd contract:
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-interface.mjs" contract $1 $2`

Then summarize: what the interface is for, the key exported symbols, the import lines a consumer would use, and the current vs. available versions. If the name is unknown, run `list` and show the user what's available.
