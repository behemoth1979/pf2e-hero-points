/**
 * House rule: every player character actor automatically gains 1 Hero
 * Point on the hour, real-world wall-clock time, for as long as a GM
 * client has the world open. GM-only -- players never run this timer,
 * so there's exactly one grant per hour regardless of how many clients
 * are connected.
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
 */

const MODULE_ID = "phil-pf2e-hero-points";

async function grantHourlyHeroPoints() {
  const actors = game.actors.filter((a) => a.hasPlayerOwner && a.type === "character");
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
