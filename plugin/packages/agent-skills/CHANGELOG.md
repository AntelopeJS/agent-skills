# Changelog


## v0.2.0

[compare changes](https://github.com/AntelopeJS/agent-skills/compare/agent-skills-v0.1.0...v0.2.0)

### 🔥 Performance

- **verify:** Find import lines without rescanning the text ([#57](https://github.com/AntelopeJS/agent-skills/pull/57))
- **sync:** Read each installed package.json once ([#58](https://github.com/AntelopeJS/agent-skills/pull/58))
- **resolver:** Read versions and dist-tags in one npm view ([#59](https://github.com/AntelopeJS/agent-skills/pull/59))
- **evals:** Fetch the published packages concurrently ([#60](https://github.com/AntelopeJS/agent-skills/pull/60))

### 🩹 Fixes

- **verify:** Read a package whose exports is null from its types field ([#51](https://github.com/AntelopeJS/agent-skills/pull/51))
- **resolver:** Resolve a conditions object under an explicit export's types ([#52](https://github.com/AntelopeJS/agent-skills/pull/52))
- **plugin:** Ship the plugin from its own folder to pass the directory review ([#53](https://github.com/AntelopeJS/agent-skills/pull/53))

### 📖 Documentation

- **readme:** Show the three ways to build in a GIF ([59144a2](https://github.com/AntelopeJS/agent-skills/commit/59144a2))
- **readme:** Unlink the internal docs-assistant repository ([#47](https://github.com/AntelopeJS/agent-skills/pull/47))
- **readme:** List packages/agent-skills in the layout tree ([#55](https://github.com/AntelopeJS/agent-skills/pull/55))
- **readme:** Rank installed modules before dependencies in the sync search order ([#56](https://github.com/AntelopeJS/agent-skills/pull/56))

### 📦 Build

- **deps:** Bump @antelopejs packages to the 2026-11-06 releases ([#49](https://github.com/AntelopeJS/agent-skills/pull/49))
- **deps:** Bump @antelopejs/tooling-configs to 0.5.0 ([#54](https://github.com/AntelopeJS/agent-skills/pull/54))
- **deps:** Bump @antelopejs/tooling-configs to 0.5.1 ([#61](https://github.com/AntelopeJS/agent-skills/pull/61))

### 🏡 Chore

- **release:** Bump the plugin to 0.6.0 ([#39](https://github.com/AntelopeJS/agent-skills/pull/39))
- Land the cleanup campaign on main ([#41](https://github.com/AntelopeJS/agent-skills/pull/41))
- **evals:** Remove the seeded-break eval ([#43](https://github.com/AntelopeJS/agent-skills/pull/43))
- **plugin:** Release 0.7.0 without the seeded eval ([#44](https://github.com/AntelopeJS/agent-skills/pull/44))
- **evals:** Drop the central cases the packages now ship ([#45](https://github.com/AntelopeJS/agent-skills/pull/45))
- **ci:** Remove the weekly mutation caller ([#46](https://github.com/AntelopeJS/agent-skills/pull/46))
- **plugin:** Add the listing icon for the Claude plugin directory ([#50](https://github.com/AntelopeJS/agent-skills/pull/50))
- **release:** Antelopejs plugin 0.8.0 ([#62](https://github.com/AntelopeJS/agent-skills/pull/62))

### 🤖 CI

- Call ci-node.yml@v1 ([#48](https://github.com/AntelopeJS/agent-skills/pull/48))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))

