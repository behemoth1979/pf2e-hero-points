# Homebrew: Hero Points

A Foundry VTT module (`phil-pf2e-hero-points`) for the Pathfinder 2e
system, home to Hero Points house rules. Content not yet defined —
this is a scaffold, tooling copied from the
[pf2e-weredragon](https://github.com/behemoth1979/pf2e-weredragon)
module.

## Install

1. Copy this folder into `Data/modules/phil-pf2e-hero-points/`.
2. Restart Foundry, enable the module in your world's Manage Modules.

## Editing the design

Source lives at:

```
src/packs/items/
```

Rebuild after editing:

```bash
npm install
node build.mjs
```

That regenerates `packs/` (the actual LevelDB the system reads).
Always edit the source, never the compiled `packs/` folder — it gets
overwritten on every build.

## Release process (how updates reach Forge)

Forge auto-updates via `module.json`'s `manifest`/`download` URLs,
which point at this repo's GitHub Releases (not raw branch files).

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
