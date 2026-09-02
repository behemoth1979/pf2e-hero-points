/**
 * House rule: every character actor automatically gains 1 Hero Point on
 * the hour, real-world wall-clock time, for as long as a GM client has
 * the world open. GM-only -- players never run this timer, so there's
 * exactly one grant per hour regardless of how many clients are
 * connected.
 *
 * Filters actors on type === "character" alone, NOT hasPlayerOwner &&
 * type === "character" as first built -- confirmed live that this
 * table's PCs are both owned/played directly by the GM account rather
 * than through separate player logins, so hasPlayerOwner (only true
 * for non-GM Owner permission) was false for every real PC, and the
 * original filter matched zero actors every single hour. type ===
 * "character" alone still correctly excludes "npc" and "party" typed
 * actors.
 *
 * Toggle: world setting "heroPointHourlyEnabled" (default on), so the
 * GM can turn this off without disabling the module entirely.
 *
 * Scheduling: aligns the first tick to the next real top-of-the-hour
 * (e.g. connecting at 2:37 waits until 3:00), then repeats every 60
 * real minutes via a plain setInterval chained inside that initial
 * setTimeout. No catch-up/offline handling and no drift correction
 * beyond that initial alignment -- if no GM client has the world open
 * when an hour rolls over, that grant is simply skipped, which is the
 * explicitly requested behavior, not an oversight.
 *
 * Actor update uses actor.updateResource("hero-points", newValue) --
 * the same API the improve-with-hero-points.js house rule in this
 * module already uses to spend the resource -- rather than a raw
 * actor.update() on the nested system.resources.heroPoints.value path,
 * so this goes through whatever pf2e's own resource-update handling
 * does rather than bypassing it.
 *
 * Wrapped in an IIFE: this file's own top-level `const MODULE_ID` is
 * exactly what collided with the sibling pf2e-weredragon module's
 * identically-named top-level `const MODULE_ID` (both loaded as plain,
 * non-isolated <script> tags sharing one global page scope) -- whoever
 * loaded second threw "Identifier 'MODULE_ID' has already been
 * declared" and silently failed to run at all. Scoping every top-level
 * declaration inside a function eliminates this whole class of
 * cross-module collision regardless of what identifiers any other
 * module happens to use -- applied here as a standing practice for
 * every script in this module going forward.
 */

(() => {

const MODULE_ID = "phil-pf2e-hero-points";

async function grantHourlyHeroPoints() {
  // type === "character" alone, not hasPlayerOwner && type === "character":
  // confirmed live that this table's two PCs are both owned/played directly
  // by the GM account rather than through separate player logins, so
  // hasPlayerOwner (which only counts non-GM Owner permission) is false for
  // both and excluded every real PC from the original filter -- the grant
  // silently ran over zero actors every hour. type === "character" alone
  // still correctly excludes NPCs ("npc") and the party actor ("party").
  const actors = game.actors.filter((a) => a.type === "character");
  const updatedNames = [];

  for (const actor of actors) {
    const resource = actor.system.resources?.heroPoints;
    const value = resource?.value ?? 0;
    const max = resource?.max ?? 3;
    if (value >= max) continue;

    await actor.updateResource("hero-points", value + 1);
    updatedNames.push(actor.name);
  }

  const content = updatedNames.length
    ? `<p><i class="fa-solid fa-hospital-symbol"></i> <strong>Hourly Hero Point:</strong> ${updatedNames.join(", ")} gained 1 Hero Point.</p>`
    : `<p><i class="fa-solid fa-hospital-symbol"></i> <strong>Hourly Hero Point:</strong> everyone is already at max Hero Points.</p>`;

  await ChatMessage.create({
    content,
    speaker: { alias: "Hero Points" },
  });
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "heroPointHourlyEnabled", {
    name: "Hourly Hero Point Grant",
    hint: "Automatically grant every player character 1 Hero Point on the hour (real-world time) while a GM client has the world open.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
});

Hooks.once("ready", () => {
  if (!game.user.isGM) return;
  if (!game.settings.get(MODULE_ID, "heroPointHourlyEnabled")) return;

  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setMinutes(60, 0, 0); // rolls over into the next hour, :00:00.000

  const msUntilNextHour = nextHour.getTime() - now.getTime();

  setTimeout(() => {
    grantHourlyHeroPoints();
    setInterval(grantHourlyHeroPoints, 60 * 60 * 1000);
  }, msUntilNextHour);
});

})();
