/**
 * Extends the "Improve Result with Hero Points" house rule (see
 * improve-with-hero-points.js) to work with the third-party pf2e-toolbelt
 * module's "Target Helper" tool -- the per-target dice-icon rows it adds
 * under a spell/check/damage chat card, one row per target, each showing a
 * clickable d20 icon (before rolling) that turns into the rolled degree of
 * success + total (after rolling).
 *
 * Confirmed directly against pf2e-toolbelt's real source (cloned
 * github.com/reonZ/pf2e-toolbelt and its foundry-helpers dependency,
 * v1.5.0) and against real live data/DOM over a live CDP connection to
 * the dev server -- not guessed.
 *
 * **Where the data lives**: each target's save result is stored at
 * `message.flags["pf2e-toolbelt"].targetHelper.saveVariants.<variantId>
 * .saves.<targetId>`, shaped as `{success, value, die, modifiers, notes,
 * unadjustedOutcome, rerolled, ...}` -- directly analogous to pf2e's own
 * `context.outcome`/`unadjustedOutcome` that improve-with-hero-points.js
 * already manipulates for a normal roll. Same approach applies here: read/
 * write this flag shape directly, then rely on Foundry's standard
 * "updating a ChatMessage re-renders it" behavior. This is necessary
 * because **toolbelt exposes no public API for writing save results** --
 * its `api.targetHelper` object only has `getMessageTargets`/
 * `setMessageFlagTargets`; the actual save-writing method
 * (`updateMessageEmitable`) is private to its own bundle.
 *
 * **Problem 1: toolbelt's rendered rows carry no target-id attribute at
 * all.** Confirmed by reading tool/_targets.ts and header.hbs directly --
 * row-to-target association exists only as a JS closure inside toolbelt's
 * own row-building code (`createTargetsRows`), invisible to an external
 * module. Per explicit user decision (asked directly rather than
 * guessed), this is worked around by independently recomputing the exact
 * same filtered+sorted target list toolbelt's own `createTargetsRows`/
 * `getTargetRowData` build for the current user, and matching by row
 * index -- but only ONCE, at render time (see `getSortedVisibleTargets`
 * below), with the result baked directly into a `data-target-id`
 * attribute on our own inserted icon (see Problem 2). The exact sort/
 * filter algorithm, copied from that real source:
 *   - GM: all targets (splash included), sorted ascending by
 *     hasPlayerOwner then name.
 *   - Non-GM: targets with `target.hidden || hasCondition("unnoticed",
 *     "undetected")` are skipped entirely (toolbelt's own
 *     getTargetRowData returns undefined for them, dropped from the
 *     rendered list), remaining ones sorted descending by isOwner, then
 *     descending by hasPlayerOwner, then ascending by name.
 * **This is fragile by design, not a bug**: if pf2e-toolbelt ever changes
 * its own sort/filter logic in a future update, this will silently
 * misattribute rows to the wrong target. Re-verify this function against
 * pf2e-toolbelt's real source whenever it's updated.
 *
 * **Problem 2, found only through live testing, not source-reading:
 * right-click (contextmenu) on anything inside a chat message is
 * hijacked by pf2e's own chat-log context menu, no matter which specific
 * element is clicked.** The original design (right-click the existing
 * result icon, matching the convention improve-with-hero-points.js
 * already established) was built and tested live via CDP against a real
 * message and real DOM. Confirmed broken: even a bare
 * `element.addEventListener("contextmenu", handler)` calling
 * `stopImmediatePropagation()` directly on the result icon did not
 * prevent pf2e's own chat-log menu from appearing afterward. Root cause
 * (inferred from DOM event-model behavior, since the actual capture-phase
 * listener's registration site wasn't traced further): the capture phase
 * runs top-down through every ancestor BEFORE the bubble phase reaches
 * the target at all, and a `stopPropagation` called during the (later)
 * bubble phase cannot retroactively cancel whatever already happened
 * during an ancestor's earlier capture-phase handler. Since pf2e's own
 * context menu is bound (at some ancestor, not traced further) in a way
 * that wins this race regardless of which nested element is clicked,
 * *no* right-click-based UI nested inside a chat message can reliably
 * out-race it -- this isn't specific to the particular selector or
 * element originally chosen.
 *
 * **Fixed by not using right-click at all.** This script instead inserts
 * a brand-new icon of its own into each eligible row's `.controls`
 * (never reusing the `.reroll`/`.observe` elements toolbelt already
 * wires up), and binds a plain `click` listener to it -- confirmed safe
 * from the same hijacking, since toolbelt's own `roll-save`/
 * `reroll-save`/`ping-target` actions already rely on plain clicks inside
 * the same message without issue.
 *
 * **Whose Hero Points get spent**: the target's own actor
 * (`target.actor`), not `message.actor` (which here is the *caster*, an
 * entirely different actor) -- gated on `target.actor?.isOwner ||
 * game.user.isGM` alone, mirroring getIncomingContextForLi()'s gating in
 * improve-with-hero-points.js (no message.isAuthor check, since the
 * message's own author is irrelevant to whether the target's owner can
 * act on the target's own save).
 *
 * **`dosAdjustments` is deliberately left untouched, not populated.**
 * TargetSaveInstance has a real `dosAdjustments` field toolbelt copies
 * verbatim from the underlying roll's own pf2e CheckContext (used for its
 * own tooltip's "why did this change" text), but its `amount` field is a
 * real pf2e enum (DEGREE_ADJUSTMENT_AMOUNTS) whose exact valid values
 * weren't confirmed against live data (no example ever appeared on a
 * captured message during this feature's development). Guessing wrong
 * here risked either a Zod validation failure on the whole saves object
 * (breaking toolbelt's rendering entirely for that target) or silently
 * wrong tooltip text. Used the same safer mechanism
 * improve-with-hero-points.js's own flavor-text note relies on instead:
 * appended a real note (TargetSaveInstance.notes, the same
 * RollNotePF2e-backed field toolbelt already renders for its own notes)
 * announcing the change in plain text.
 *
 * Wrapped in an IIFE, per this module's own standing practice (see
 * CLAUDE.md and the other two scripts in this module for why).
 */

(() => {

const TOOLBELT_MODULE_ID = "pf2e-toolbelt";
const DEGREE_STRINGS = ["criticalFailure", "failure", "success", "criticalSuccess"];
const DEGREE_LABELS = ["Critical Failure", "Failure", "Success", "Critical Success"];
const ICON_CLASS = "phil-hero-points-target-improve";

// Mirrors ALLOWED_STEPS_BY_DEGREE in improve-with-hero-points.js exactly
// -- keep both in sync if that table ever changes.
const ALLOWED_STEPS_BY_DEGREE = {
  0: [1, 2, 3], // critical failure/critical miss
  1: [1, 2], // failure/miss
  2: [1], // success/hit
};

function isTargetHidden(target) {
  return !!target.hidden || !!target.actor?.hasCondition?.("unnoticed", "undetected");
}

// See the module docstring above (Problem 1) for why this exists and its
// fragility. Confirmed against pf2e-toolbelt v1.5.0's real
// tool/_targets.ts source.
function getSortedVisibleTargets(data) {
  const isGM = game.user.isGM;
  const uuids = [...(data.targets ?? []), ...(data.splashTargets ?? [])];

  const tokens = uuids
    .map((uuid) => {
      try {
        return fromUuidSync(uuid);
      } catch (error) {
        return null;
      }
    })
    .filter((token) => token instanceof TokenDocument);

  const visible = isGM ? tokens : tokens.filter((target) => !isTargetHidden(target));

  return isGM
    ? visible.sort((a, b) => Number(a.hasPlayerOwner) - Number(b.hasPlayerOwner) || a.name.localeCompare(b.name))
    : visible.sort(
        (a, b) =>
          Number(b.isOwner) - Number(a.isOwner) ||
          Number(b.hasPlayerOwner) - Number(a.hasPlayerOwner) ||
          a.name.localeCompare(b.name),
      );
}

// Resolves everything needed to act on a given target: its current save
// data and the actor whose Hero Points would be spent. Returns null if
// this row shouldn't offer the improve icon at all.
function getTargetContext(saveVariant, target) {
  const actor = target.actor;
  if (!actor?.isOwner && !game.user.isGM) return null;

  const targetSave = saveVariant.saves?.[target.id];
  if (!targetSave?.success) return null;

  const currentDegree = DEGREE_STRINGS.indexOf(targetSave.success);
  if (currentDegree === -1 || currentDegree >= 3) return null; // already critical success

  const resource = actor?.getResource?.("hero-points");
  if (!resource || resource.value <= 0) return null;

  return { actor, currentDegree, resource, targetSave };
}

async function improveTargetSave(message, variantId, target, targetSave, steps) {
  const actor = target.actor;
  const resource = actor?.getResource?.("hero-points");
  if (!actor || !resource || resource.value < steps) {
    ui.notifications.warn(`${actor?.name ?? "This character"} doesn't have enough Hero Points.`);
    return;
  }

  const oldDegree = DEGREE_STRINGS.indexOf(targetSave.success);
  const newDegree = Math.min(Math.max(oldDegree + steps, 0), 3);
  if (newDegree === oldDegree) {
    ui.notifications.info(`${actor.name}'s result can't be improved any further.`);
    return;
  }

  await actor.updateResource("hero-points", resource.value - steps);

  const newNote = {
    selector: "hero-points-improve",
    title: null,
    text: `<i class="fa-solid fa-hospital-symbol" title="Hero Point"></i> ${actor.name} spends ${steps} Hero Point${steps > 1 ? "s" : ""}: improves the result from <strong>${DEGREE_LABELS[oldDegree]}</strong> to <strong>${DEGREE_LABELS[newDegree]}</strong>.`,
    outcome: [],
    predicate: [],
  };

  const path = `flags.${TOOLBELT_MODULE_ID}.targetHelper.saveVariants.${variantId}.saves.${target.id}`;
  await message.update({
    [`${path}.success`]: DEGREE_STRINGS[newDegree],
    [`${path}.notes`]: [...(targetSave.notes ?? []), newNote],
  });

  ui.notifications.info(
    `${actor.name} spends ${steps} Hero Point${steps > 1 ? "s" : ""}: ${DEGREE_LABELS[oldDegree]} -> ${DEGREE_LABELS[newDegree]}.`,
  );
}

Hooks.on("renderChatMessageHTML", (message, html) => {
  if (!game.modules.get(TOOLBELT_MODULE_ID)?.active) return;

  const data = message.flags?.[TOOLBELT_MODULE_ID]?.targetHelper;
  if (!data?.saveVariants) return;

  // Toolbelt's own row-injection (#messageRenderHTML) is async (its own
  // Handlebars template render is awaited), and Hooks.callAll doesn't
  // await async listeners -- confirmed live that .target-row doesn't
  // exist in `html` yet at the moment this hook first runs, but does by
  // the very next macrotask (a bare setTimeout(fn, 0) was already enough
  // in testing). Deferred a little further than the observed minimum, as
  // a pragmatic buffer rather than relying on exact timing -- same
  // approach already established in the sibling pf2e-weredragon module
  // for this identical class of async-render race.
  setTimeout(() => addImproveIcons(message, html, data), 50);
});

function addImproveIcons(message, html, data) {
  const variantId = Object.keys(data.saveVariants)[0];
  const saveVariant = variantId ? data.saveVariants[variantId] : null;
  if (!saveVariant) return;

  const sortedTargets = getSortedVisibleTargets(data);
  const rows = html.querySelectorAll(".target-row");

  // Only one ContextMenu (bound to our own new icons, never toolbelt's
  // own .reroll/.observe elements) is needed per message -- each icon
  // carries its own resolved target/steps info via a data attribute set
  // below, so the click handler doesn't need to re-derive anything.
  const menuItems = [1, 2, 3].map((steps) => ({
    label: `Improve Result by ${steps} (${steps} Hero Point${steps > 1 ? "s" : ""})`,
    icon: '<i class="fa-solid fa-hospital-symbol"></i>',
    visible: (icon) => icon.dataset.allowedSteps?.split(",").includes(String(steps)),
    onClick: (_event, icon) => {
      const target = sortedTargets.find((t) => t.id === icon.dataset.targetId);
      const targetSave = saveVariant.saves?.[icon.dataset.targetId];
      if (target && targetSave) improveTargetSave(message, variantId, target, targetSave, steps);
    },
  }));

  rows.forEach((row, index) => {
    const target = sortedTargets[index];
    if (!target) return;

    const info = getTargetContext(saveVariant, target);
    if (!info) return;

    const controls = row.querySelector(".controls");
    if (!controls || controls.querySelector(`.${ICON_CLASS}`)) return;

    const allowedSteps = (ALLOWED_STEPS_BY_DEGREE[info.currentDegree] ?? []).filter(
      (steps) => info.resource.value >= steps,
    );
    if (!allowedSteps.length) return;

    const icon = document.createElement("a");
    icon.classList.add(ICON_CLASS);
    icon.dataset.targetId = target.id;
    icon.dataset.allowedSteps = allowedSteps.join(",");
    icon.dataset.tooltip = "Improve Result (Hero Points)";
    icon.innerHTML = '<i class="fa-solid fa-hospital-symbol"></i>';
    controls.appendChild(icon);
  });

  foundry.applications.ux.ContextMenu.create({}, html, `.${ICON_CLASS}`, menuItems, {
    eventName: "click",
    jQuery: false,
  });
}

})();
