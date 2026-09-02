# CLAUDE.md — pf2e-hero-points module

Context for Claude Code sessions working on this repo. Read this
before making changes.

## What this module is

A Foundry VTT module (`phil-pf2e-hero-points`) for the Pathfinder 2e
system, home to homebrew Hero Points house rules. Tooling copied over
from the sibling
[pf2e-weredragon](https://github.com/behemoth1979/pf2e-weredragon)
module (same owner, same conventions). No compendium content
(`src/packs/`) exists yet — the first house rule implemented is pure
runtime JS (see below), not compendium items.

Owner/GM: Phil. Runs the game on Forge VTT.

## Repo layout

```
module.json          # Foundry module manifest — id, version, manifest/download URLs, "scripts"
scripts/               # runtime JS, loaded via module.json's "scripts" array
src/packs/items/      # SOURCE OF TRUTH once compendium content exists — does not exist yet
packs/                 # COMPILED LevelDB — generated, never hand-edit — does not exist yet
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

## House rule: improve a check's degree of success with Hero Points

`scripts/improve-with-hero-points.js` — the first (and, as of this
writing, only) piece of content in this module. Vanilla pf2e's own
Hero Point option is only "spend 1 to reroll and keep the second
result" (`Check.rerollFromMessage` in the pf2e system's
`src/module/system/check/check.ts`, exposed at `game.pf2e.Check`).
This house rule adds a second option to the same right-click chat
context menu: spend N Hero Points (1/2/3) to move the roll's existing
degree of success up N steps directly — miss→hit, hit→crit, etc. —
capped at critical success, without rerolling any dice.

**Why this doesn't call into `game.pf2e.Check.rerollFromMessage` or
copy its full implementation**: that method (read in full before
building this) evaluates a *brand new* d20 roll, then deletes the
original chat message and recreates it with a custom side-by-side
old/new render built from `Check.renderReroll()`, plus a fair amount
of extra logic (mythic-point special-casing, initiative-roll
handling, flavor-text reconstruction with note filtering by outcome).
None of the dice-rerolling part applies here — this house rule never
rolls new dice, it just needs to move an already-computed degree of
success up N steps. Reimplementing the delete/recreate custom render
pipeline blind (untestable from here) carried real risk of a subtly
broken chat card. Confirmed instead, directly against source, what
this needs: `actor.updateResource("hero-points", value - n)` is the
actual API the built-in reroll uses to spend the resource, and
`flags.pf2e.context.outcome` (string) + the roll's own
`options.degreeOfSuccess` (number, 0–3) are the two canonical fields
`rerollFromMessage` updates together whenever the degree changes —
those are exactly what this script updates too, then relies on
Foundry's standard "updating a ChatMessage document re-renders its
card" behavior rather than custom-building new HTML. A flavor-text
note announcing the change is always added regardless, so the effect
is visible even if the card's own styling doesn't fully react to the
data change.

**Known unverified risk**: whether the pf2e chat card template
re-derives its degree-of-success color/label purely from those two
fields on a plain document update (vs. needing something the delete
-and-recreate reroll flow uniquely provides) hasn't been confirmed
live — there was no way to test this without a running Foundry
session. If the flavor-text note appears but the card's own
success/failure styling doesn't visually update to match, that's the
first thing to revisit; the mechanical parts (Hero Points spent, the
`context.outcome` flag actually changed) should still be correct
either way, since downstream automation reading that flag would still
see the right value.

**Menu gating** (`getChatLogEntryContext` hook, standard Foundry
chat-log context-menu hook — same one referenced in pf2e's own type
definitions): each of the three options only appears when the message
belongs to a check/save roll the user can act on (actor owned, and
`message.isAuthor || game.user.isGM`, mirroring
`ChatMessagePF2e#isRerollable`'s own gating logic), the roll has a
recorded `context.outcome` (so there's a degree to improve at all,
and it isn't already critical success), and the acting character has
at least that many Hero Points. Foundry's context-menu callbacks can
receive either a raw `HTMLElement` or a jQuery-wrapped one depending
on version — `getLiElement()` handles both rather than assuming one.

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
