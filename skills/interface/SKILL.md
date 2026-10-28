---
name: interface
description: Look up an AntelopeJS interface contract (surface, versions, or full TSDoc) with the live resolver. Use when the person asks what an interface exports, which version to use, or how to import it.
argument-hint: <name> [subpath]
allowed-tools: Bash(node:*)
---

Resolve the AntelopeJS interface contract the person asked about and present it to them. The request names the interface and, optionally, a subpath; if it names no interface, ask which one.

The resolver is `scripts/resolve-interface.mjs` at the plugin root, two levels above the directory holding this file: `<skill-dir>/../../scripts/resolve-interface.mjs`. Run it and answer from its output, never from memory, since contracts are versioned and change:

- With only an interface name, show the surface and versions:
  `node "<skill-dir>/../../scripts/resolve-interface.mjs" show <name>`
- With a subpath too, print the full TSDoc'd contract:
  `node "<skill-dir>/../../scripts/resolve-interface.mjs" contract <name> <subpath>`

Then summarize: what the interface is for, the key exported symbols, the import lines a consumer would use, and the current vs. available versions. If the name is unknown, run `list` and show the person what's available.
