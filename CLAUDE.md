# CLAUDE.md — pf2e-hero-points module

Context for Claude Code sessions working on this repo. Read this
before making changes.

## What this module is

A Foundry VTT module (`phil-pf2e-hero-points`) for the Pathfinder 2e
system, intended to hold homebrew Hero Points house rules. **As of
this writing, no actual content has been defined yet** — this repo is
a freshly scaffolded skeleton, tooling copied over from the sibling
[pf2e-weredragon](https://github.com/behemoth1979/pf2e-weredragon)
module (same owner, same conventions), pending the owner deciding what
the actual Hero Points house rule(s) should be.

Owner/GM: Phil. Runs the game on Forge VTT.

## Repo layout

```
module.json          # Foundry module manifest — id, version, manifest/download URLs
src/packs/items/      # SOURCE OF TRUTH once content exists — does not exist yet
packs/                 # COMPILED LevelDB — generated, never hand-edit
build.mjs              # compiles src/packs/* -> packs/* via @foundryvtt/foundryvtt-cli
                        # (skips any src/packs/* subfolder that doesn't exist yet)
README.md
```

**Golden rule (once content exists):** always edit `src/packs/*`
source files, then run `node build.mjs` to regenerate `packs/`. Never
hand-edit anything under `packs/` — it's compiled LevelDB and gets
clobbered on every build.

## Build workflow

```bash
npm install        # first time only
node build.mjs      # compiles src/packs/* -> packs/* (LevelDB)
```

Verify changes round-trip cleanly (compile → extract → diff) before
committing if an edit touches rule-element structure, not just values
— see the `pf2e-weredragon` repo's own CLAUDE.md for the established
verification pattern (a throwaway Node script using
`extractPack`/`compilePack` and a deep, key-order-independent JSON
comparison) if this repo needs the same treatment later.

## Release process (how updates reach Forge)

Same as `pf2e-weredragon`: Forge auto-updates via `module.json`'s
`manifest`/`download` URLs, which point at this repo's GitHub
Releases (not raw branch files).

1. Bump `"version"` in `module.json`.
2. Update the `"download"` URL in `module.json` to match the new
   version tag (the `"manifest"` URL stays constant — it always
   resolves to `releases/latest`).
3. Commit + push.
4. Run `node build.mjs` if source changed, and re-zip the module
   contents (module.json, packs/, src/, build.mjs, README.md — NOT
   node_modules or .git).
5. On github.com: repo → Releases → "Create a new release" → tag it
   `vX.Y.Z` matching `module.json` → attach both the zip and a
   standalone copy of `module.json` → publish.
6. Forge will offer an "Update" button once it next checks.

Repo: https://github.com/behemoth1979/pf2e-hero-points

## Environment

- Built/tested against Foundry v14.366, pf2e system v8.4.1.
- Unofficial homebrew, not affiliated with Paizo or the PF2e Foundry
  team.
