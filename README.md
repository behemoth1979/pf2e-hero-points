# Homebrew: Hero Points

A Foundry VTT module (`phil-pf2e-hero-points`) for the Pathfinder 2e
system, home to Hero Points house rules.

## Improve a result with Hero Points

Right-click a check or saving throw's chat message and, alongside the
normal "Reroll a Check" options, you'll see an **Improve Result**
option — no reroll involved, just the existing result pushed up.
Which options appear depends on the roll's current result:

- **Success** → spend 1 Hero Point to make it a critical success.
- **Failure/miss** → spend 1 to make it a hit, or 2 to make it a
  critical hit.
- **Critical failure/critical miss** → spend 3 to turn it all the way
  around into a critical success. (No partial 1- or 2-point recovery
  from a critical failure — it's all or nothing.)

Only shows up when there's a result to improve (the roll needs a
target/DC set) and the acting character has enough Hero Points for
that option.

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
