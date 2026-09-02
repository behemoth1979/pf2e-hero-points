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
context menu: spend Hero Points to move the roll's existing degree of
success up, directly, without rerolling any dice. Which spend amounts
are offered depends on the roll's *current* degree, per the user's own
table (not a general "spend N for N steps" rule) — see
`ALLOWED_STEPS_BY_DEGREE` in the script:

| Current result | Options offered |
|---|---|
| Success | 1 point → critical success |
| Failure/miss | 1 point → success/hit, or 2 points → critical success/hit |
| Critical failure/critical miss | 3 points → critical success (all-or-nothing; no 1- or 2-point partial recovery) |

The asymmetry on critical failure is deliberate, not an oversight: the
user explicitly wants only the full 3-point turnaround offered from a
critical failure, not the 1- or 2-point partial improvements that
would otherwise be mechanically consistent with the other rows.

## House rule: worsen an incoming attack or enemy save with Hero Points

Same script, same right-click menu, opposite direction: spend Hero
Points to push *someone else's* roll against you down, instead of
improving your own. `INCOMING_ALLOWED_STEPS_BY_DEGREE` is the exact
mirror of `ALLOWED_STEPS_BY_DEGREE` above (crit hit against you → only
3 points, all-or-nothing; hit against you → 1 or 2 points; miss
against you → only 1 point) — the user asked to "apply the same
logic," and confirmed via `AskUserQuestion` that this literal mirror
(not a flat "N points = N degrees") was the intended table.

**The hard part wasn't the table, it was finding whose Hero Points to
spend and which message field identifies them**, since the roller of
an incoming roll is never the person who should get to react to it —
it's always someone else:

- **attack-roll**: `context.target.actor` is the character being hit.
  Confirmed against a real captured message (not guessed) — pulled
  directly out of this world's own LevelDB message store over SSH,
  since Foundry's LevelDB is grep-able plaintext for embedded JSON:
  `context":{"type":"attack-roll",...,"target":{"actor":"Scene.
  NUEDEFAULTSCENE0.Token.<id>.Actor.<id>",...}}`. This is a clean,
  directly-resolvable UUID in every attack-roll message checked.
- **saving-throw**: `context.origin.actor` is meant to hold the caster
  whose spell/effect provoked the save. Confirmed two ways: (1)
  `CheckContext.resolve()` in pf2e's own compiled source explicitly
  reads `origin?.actor` when computing attacker/defender for the roll
  (`let e = await super.resolve(), t = !!e.origin?.self, n = t ?
  e.origin?.actor : e.target?.actor, ...`); (2) a real captured save
  message where an NPC saved against persistent fire damage had
  `context.origin: null` at the top level, but the *effect's source*
  was still identifiable only through free-text roll options buried in
  `context.options` (`"origin:treerazer"`, `"origin:trait:fiend"`,
  etc.) — not through any clean, resolvable actor UUID. This
  particular save type (a monster's own condition-recovery check) just
  doesn't populate `context.origin.actor`, confirming it's genuinely
  `null` sometimes, not merely unobserved. **The fix is to fail closed,
  not guess**: `getIncomingContextForLi()` returns `null` (no menu
  option offered) whenever `context.origin?.actor` is absent, rather
  than trying to parse the `origin:*` roll-option strings as a
  fallback. A real spell/effect-provoked save (the case this feature
  is actually for) is expected to populate this field correctly, per
  the `CheckContext.resolve()` source read above — this repo just
  doesn't have a live example of one on hand to double-confirm against
  real data the way the attack-roll case was confirmed.

Both UUIDs are resolved with `fromUuidSync()` — safe to call
synchronously here because `visible()`/`onClick()` context-menu
callbacks are themselves synchronous, and every Scene/Token/Actor
document referenced is already loaded in memory as part of the world's
own collections regardless of which scene is currently viewed.

**Gating differs by design from the "improve your own roll" case**:
`getContextForLi()` requires `message.isAuthor || game.user.isGM`
(matching pf2e's own reroll-option gating, since the roller *is* the
relevant person there); `getIncomingContextForLi()` has no such check
— `message.isAuthor` is meaningless here, since the message's author
is always the attacker or the enemy roller, never the person this
option is for. Ownership (`actor.isOwner`) on the resolved target/
origin actor is the only gate needed. A guard against
`actor.id === message.actor?.id` also exists, for the edge case of a
self-targeted save (nothing to "worsen" when you're both the caster
and the one saving).

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

**Confirmed working live** (2026-09-02, after the context-menu timing
fix below): the plain document update approach is sufficient — no need
for pf2e's delete-and-recreate reroll pipeline.

**Menu registration — corrected after live testing found it silently
didn't work at all.** The first version used
`Hooks.on("getChatLogEntryContext", ...)`, reasoning from that hook
merely *existing* in Foundry's own type definitions
(`types/foundry/client/helpers/hooks.d.mts`) — but never actually
confirmed pf2e *calls* it. It doesn't: read pf2e's real
`src/module/apps/sidebar/chat-log.ts` directly and found `class
ChatLogPF2e extends fa.sidebar.tabs.ChatLog` completely *overrides*
`_getEntryContextOptions()` — calling `super._getEntryContextOptions()`
then pushing its own Reroll/Apply Damage/etc. entries directly in the
override, never calling the generic hook at all. Anything relying on
that hook alone silently never fires. **Lesson: confirm a hook is
actually called by the system, not just that it's declared/typed
somewhere, before building on it** — especially for chat-log/sidebar
UI, which this system frequently replaces wholesale with its own
`fa.sidebar.tabs.*`-extending classes rather than hooking the default.

Fixed by wrapping the real method instead of hooking: `ui.chat` is the
live `ChatLog` application instance (a stable Foundry global), so
`ui.chat.constructor.prototype._getEntryContextOptions` is the actual
`ChatLogPF2e` prototype method — patched at `Hooks.once("ready", ...)`
(after the UI exists) to call the original and push three more
entries. This is the standard way to extend one method on a class this
module doesn't own, without an external dependency like libWrapper.

**Entry shape was also wrong the first time**, assumed rather than
checked: the older Foundry-version convention `{name, icon, condition,
callback(li)}` doesn't apply here. Copied the real shape verbatim from
pf2e's own entries in the same file (e.g. the actual
`"PF2E.RerollMenu.HeroPoint"` entry): `label` (not `name`), `visible`
(not `condition`), and `onClick(event, li)` (not `callback(li)`) — and
`li` is confirmed always a raw `HTMLElement` in this Foundry version
(`li.dataset.messageId` used directly in pf2e's own entries, no jQuery
anywhere in that file), not sometimes-jQuery-wrapped as first assumed.

**Third bug, the real one — patched at the wrong hook.** After the two
fixes above, the wrapped method was confirmed live and correct
(inspecting `ui.chat.constructor.prototype._getEntryContextOptions.
toString()` in the browser console showed our wrapper, and calling
`ui.chat._getEntryContextOptions().map(o => o.label)` directly
returned all three "Improve Result" entries) — yet the actual
right-click menu never showed them, and not even our diagnostic
logging (attached to each entry's own `visible()` callback) ever ran.
Root cause, found by pulling Foundry's own core
`client/applications/ux/context-menu.mjs` directly off this module's
target server via SSH (not guessed, not found in any docs): `class
ContextMenu`'s constructor does `this.menuItems = menuItems` —a
**plain instance property, captured once, at construction time**.
`#renderEntries()` (called on every right-click) re-evaluates each
entry's `visible()` callback against `this.#target`, but it never
calls `_getEntryContextOptions()` again to rebuild `this.menuItems`
itself. Whatever array existed when the chat log's `ContextMenu`
instance was originally built is what's shown, forever after — no
matter how many times the underlying method gets re-patched later.

That first construction happens very early — well before `ready`
fires, confirmed by grepping pf2e's own compiled `pf2e.mjs` for
`CONFIG.ui.chat =`, which is set inside pf2e's own `init` hook
handler (immediately after its `"PF2e System | Initializing..."` log
line) — so patching at `Hooks.once("ready", ...)` genuinely is too
late: `CONFIG.ui.chat`'s prototype gets patched correctly, but the
live `ui.chat` instance's `ContextMenu` was already constructed from
the *original* method by then.

**Fix**: patch at `Hooks.once("init", ...)` instead, using
`CONFIG.ui.chat` (the class reference) rather than waiting for the
`ui.chat` instance to exist. Foundry always runs the active system's
`init` hook before any module's `init` hook, so `CONFIG.ui.chat` is
guaranteed already assigned by pf2e when this module's `init` hook
runs — patching the prototype there guarantees our wrapper is what
runs the first time Foundry ever builds the chat log's `ContextMenu`.
**Lesson, layered on top of the "confirm a hook is actually called"
one above: confirming a patched method returns the right thing when
called manually is not the same as confirming the *live UI* is using
that patched method** — some Foundry UI pieces (`ContextMenu` here)
snapshot a method's return value once at construction rather than
calling the method fresh on every use, so patch timing relative to
that construction matters as much as patching the right method at
all.

**Menu gating** (inside the wrapped `_getEntryContextOptions`, not a
hook): each of the three options only appears when the message
belongs to a check/save roll the user can act on (actor owned, and
`message.isAuthor || game.user.isGM`, mirroring
`ChatMessagePF2e#isRerollable`'s own gating logic), the roll has a
recorded `context.outcome` (so there's a degree to improve at all,
and it isn't already critical success), and the acting character has
at least that many Hero Points.

## House rule: hourly Hero Point grant

`scripts/hourly-hero-point.js` — second script file in this module,
separate from `improve-with-hero-points.js` since it's an entirely
independent house rule (a passive timer, not a chat-message
interaction) with its own settings registration. Every character actor
(`type === "character"`) gains 1 Hero Point on the real-world hour,
for as long as a GM client has the world open.

**Filter bug found in play, first release (v0.1.5)**: originally
`hasPlayerOwner && type === "character"`, matching the literal
original spec. Live testing showed the hourly chat message always said
"everyone already at max" even with two PCs below cap. Confirmed via
console (`game.actors.contents.map(a => ({name: a.name, type: a.type,
hasPlayerOwner: a.hasPlayerOwner}))`) that both real PCs on this table
(Drengor, Vanilla) report `hasPlayerOwner: false` — this GM plays both
characters directly under the GM account rather than through separate
player logins, and `hasPlayerOwner` only counts *non-GM* users with
explicit Owner permission, so it was false for every actor that
mattered and the grant loop ran over zero actors, every hour, forever.
Fixed by dropping the `hasPlayerOwner` check entirely — `type ===
"character"` alone still correctly excludes `"npc"`- and `"party"`-
typed actors, and is the right filter for this table's actual setup.
**If this module is ever used on a table where players do log in with
their own accounts, revisit whether `hasPlayerOwner` should come back**
— dropping it here is a table-specific fix, not a general claim that
the flag is unreliable everywhere.

**GM-only by explicit design, not an incidental restriction**: the
`Hooks.once("ready", ...)` handler returns immediately if
`!game.user.isGM`, so the timer is only ever running on the GM's own
client. This is what makes "once per hour" actually true regardless of
how many players are connected simultaneously — if every client ran
its own timer, a 4-player table would post 4 duplicate chat messages
and grant points 4x. This mirrors the same "exactly one client should
act" concern `aeon-stone-healing.js` in the sibling `pf2e-weredragon`
module solves with `actor.primaryUpdater !== game.user` — but here the
constraint is simpler (only the GM should ever run this at all, not
"whichever client happens to own the actor"), so a flat `isGM` check
is sufficient and no primary-updater check is needed.

**Setting registered at `init`, gating logic runs at `ready`** — per
Foundry convention (and per how `game.settings.register` is documented
to be used), registration happens as early as possible so the setting
exists before anything might read it or render a config UI for it; the
actual GM-only scheduling decision happens later at `ready`, per the
user's own explicit requirement, since it needs the game and its
settings to be fully loaded before deciding whether to start the
timer.

**Scheduling**: aligns the first tick to the next wall-clock
top-of-hour via a single `setTimeout` (`Date#setMinutes(60, 0, 0)` is
the concise way to compute "the next hour boundary" — passing 60 as
the minutes argument rolls the `Date` over into the next hour
automatically, rather than needing an explicit `+1` on the hours field
and a separate check for a 23→0 day rollover), then chains a plain
`setInterval` at exactly 60 real minutes once that first tick fires.
No drift correction beyond that initial alignment and no catch-up
logic for a missed hour while offline — both explicitly out of scope
per the user's own requirements, not oversights. A `setInterval` left
running for very long real-world sessions will drift slightly from the
true wall-clock hour over time (typical `setInterval` behavior, not
specific to this script), which was accepted as fine given "no
drift-correction needed" was explicit in the ask.

**Actor update reuses `actor.updateResource("hero-points", newValue)`**
— the exact same API `improve-with-hero-points.js` already uses to
spend the resource — rather than a raw `actor.update()` against the
nested `system.resources.heroPoints.value` path, so this grant goes
through whatever resource-update handling pf2e's own actor document
does, instead of bypassing it with a direct data-path write. The
*read* side does use the raw `actor.system.resources.heroPoints`
path directly (checking `.value` against `.max ?? 3`), per the user's
own explicit specification.

**Bug found in play, fixed in v0.1.7: every script in this module is
now wrapped in an IIFE.** Both `improve-with-hero-points.js` and
`hourly-hero-point.js` declared top-level identifiers directly in the
page's shared global scope (Foundry loads every enabled module's plain
`"scripts"` entries as classic `<script>` tags, not isolated per
module). `hourly-hero-point.js`'s top-level `const MODULE_ID =
"phil-pf2e-hero-points"` collided with the sibling `pf2e-weredragon`
module's own identically-named top-level `const MODULE_ID` — whichever
loaded second threw `Uncaught SyntaxError: Identifier 'MODULE_ID' has
already been declared` and silently failed to execute at all (in that
instance, it was `pf2e-weredragon`'s `bizarre-transformation.js` that
broke). Fixed by wrapping every script file's body in an IIFE
(`(() => { ... })();`), eliminating this whole class of cross-module
collision regardless of what identifiers any other module happens to
use. This is now standing practice for every script added to this
module going forward, applied proactively to new files from the start
rather than only after a collision is actually confirmed.

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
