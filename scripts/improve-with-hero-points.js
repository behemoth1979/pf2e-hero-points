/**
 * House rule: right-clicking a check/save roll's chat message offers
 * "Improve Result by 1/2/3 (Hero Point(s))" alongside the system's own
 * "Reroll a Check" options -- spend N Hero Points to raise the degree of
 * success by N steps, capped at critical success/critical save.
 *
 * FIRST ATTEMPT AT THIS SCRIPT USED THE WRONG MECHANISM ENTIRELY, fixed
 * after live testing showed literally no new context menu options
 * appeared at all. Root cause, confirmed by downloading and reading pf2e's
 * actual src/module/apps/sidebar/chat-log.ts directly (not guessed, not
 * inferred from a generic Foundry hook's existence in the type
 * definitions): pf2e does NOT populate its chat message context menu via
 * the generic Hooks.on("getChatLogEntryContext", ...) hook. It replaces
 * Foundry's default chat log with its own class (`class ChatLogPF2e
 * extends fa.sidebar.tabs.ChatLog`) and directly *overrides*
 * `_getEntryContextOptions()`, building the entire entries array itself
 * (calling `super._getEntryContextOptions()` then pushing its own Reroll/
 * Apply Damage/etc. entries) -- it never calls the generic hook at all, so
 * anything relying on that hook silently never fires for pf2e messages.
 *
 * The fix: don't hook, wrap the actual method (the standard way to extend
 * a class method from a separate module without owning the class) --
 * `CONFIG.ui.chat` is the ChatLogPF2e class reference pf2e registers, so
 * `CONFIG.ui.chat.prototype._getEntryContextOptions` is the real prototype
 * method, patched at the "init" hook to call the original then push three
 * more entries. (Patching at "ready" instead of "init" was a second,
 * separate bug: Foundry's ContextMenu snapshots the entries array once,
 * at the moment the chat log's menu is first built -- which happens
 * before "ready" fires -- so a "ready"-time patch never took effect on
 * the live menu even though it worked when called directly. See CLAUDE.md
 * for the full writeup.)
 *
 * Also corrected the entry shape itself, copied verbatim from pf2e's own
 * real entries (e.g. the "PF2E.RerollMenu.HeroPoint" one) rather than the
 * older-Foundry-version {name, icon, condition, callback} shape assumed
 * the first time: this Foundry version's ContextMenuEntry uses `label`
 * (not `name`), `visible` (not `condition`, and it's a plain function, not
 * wrapped), and `onClick(event, li)` (not `callback(li)`) -- and `li` is
 * always a raw HTMLElement here, never jQuery-wrapped, confirmed the same
 * way (`li.dataset.messageId` used directly in pf2e's own entries, no
 * jQuery unwrapping anywhere in that file).
 *
 * Everything about *what* gets updated when Hero Points are spent is
 * unchanged from the first version and still applies: actor.updateResource
 * ("hero-points", value - n) to spend the resource (the same API
 * Check#rerollFromMessage itself uses), and flags.pf2e.context.outcome +
 * the roll's own options.degreeOfSuccess as the two canonical fields that
 * change together. Whether the chat card's own success/failure styling
 * fully re-renders from a plain document update (vs. needing the
 * delete-and-recreate approach the real reroll uses) is still unverified
 * without a live session -- the flavor-text note is still added
 * unconditionally so the change is visible either way.
 */

const DEGREE_STRINGS = ["criticalFailure", "failure", "success", "criticalSuccess"];
const DEGREE_LABELS = ["Critical Failure", "Failure", "Success", "Critical Success"];
const DEBUG_PREFIX = "phil-pf2e-hero-points |";

// House rule (per the table, not a general "spend N to move up N steps"
// rule): only the step counts that make sense for the current degree are
// offered -- a success can only be pushed to critical success (1 point;
// 2 or 3 would do the same thing and just waste points), a failure can
// go to a hit (1) or straight to a critical hit (2), and a critical
// failure/critical miss only gets the single all-or-nothing option to
// spend 3 and turn it all the way around to a critical success -- no
// partial 1- or 2-point recovery from a critical failure.
const ALLOWED_STEPS_BY_DEGREE = {
  0: [3], // critical failure/critical miss
  1: [1, 2], // failure/miss
  2: [1], // success/hit
};

function getContextForLi(li) {
  const messageId = li?.dataset?.messageId;
  const message = messageId ? game.messages.get(messageId) : null;
  if (!message) return null;

  const actor = message.actor;
  if (!actor?.isOwner) return null;
  if (!(message.isAuthor || game.user.isGM)) return null;

  const rollContext = message.flags?.pf2e?.context;
  if (!rollContext?.outcome) return null;

  const currentDegree = DEGREE_STRINGS.indexOf(rollContext.outcome);
  if (currentDegree === -1 || currentDegree >= 3) return null; // already critical success/critical save

  const resource = actor.getResource?.("hero-points");
  if (!resource || resource.value <= 0) return null;

  return { message, actor, resource, currentDegree };
}

async function improveResult(message, steps) {
  const actor = message.actor;
  const resource = actor?.getResource?.("hero-points");
  if (!actor || !resource || resource.value < steps) {
    ui.notifications.warn(`${actor?.name ?? "This character"} doesn't have enough Hero Points.`);
    return;
  }

  const context = foundry.utils.deepClone(message.flags.pf2e?.context ?? {});
  const oldDegree = DEGREE_STRINGS.indexOf(context.outcome);
  if (oldDegree === -1) {
    ui.notifications.error("Could not determine this roll's degree of success.");
    return;
  }

  const newDegree = Math.min(oldDegree + steps, 3);
  if (newDegree === oldDegree) {
    ui.notifications.info(`${actor.name} is already at critical success.`);
    return;
  }

  await actor.updateResource("hero-points", resource.value - steps);

  context.outcome = DEGREE_STRINGS[newDegree];
  context.unadjustedOutcome = context.outcome;

  const updateData = {
    flavor: `${message.flavor ?? ""}<div class="hero-point-improve"><i class="fa-solid fa-hospital-symbol" title="Hero Point"></i> ${actor.name} spends ${steps} Hero Point${steps > 1 ? "s" : ""}: improves the result from <strong>${DEGREE_LABELS[oldDegree]}</strong> to <strong>${DEGREE_LABELS[newDegree]}</strong>.</div>`,
    flags: { pf2e: { ...message.flags.pf2e, context } },
  };

  // Best-effort: also update the stored roll's own degreeOfSuccess option,
  // so anything reading it directly (rather than the context flag) sees
  // the improved result too. Wrapped defensively -- if the exact rolls
  // field shape ever changes upstream, the flavor/flag update above still
  // lands and the mechanical change (Hero Points spent, outcome flag
  // updated) still applies correctly either way.
  try {
    const roll = message.rolls?.[0];
    if (roll) {
      const rollData = roll.toJSON();
      rollData.options = { ...rollData.options, degreeOfSuccess: newDegree };
      updateData.rolls = [JSON.stringify(rollData)];
    }
  } catch (error) {
    console.warn("phil-pf2e-hero-points | Could not update roll's stored degreeOfSuccess:", error);
  }

  await message.update(updateData);

  ui.notifications.info(
    `${actor.name} spends ${steps} Hero Point${steps > 1 ? "s" : ""}: ${DEGREE_LABELS[oldDegree]} -> ${DEGREE_LABELS[newDegree]}.`,
  );
}

Hooks.once("init", () => {
  // Patch at "init", not "ready": Foundry's ContextMenu captures the
  // options array returned by _getEntryContextOptions() ONCE, into a
  // plain instance property (`this.menuItems = menuItems` in
  // client/applications/ux/context-menu.mjs), at the moment the chat
  // log's ContextMenu is first constructed. Only each entry's `visible`
  // callback is re-evaluated per right-click after that -- the array
  // itself is never rebuilt. That construction happens very early
  // (before "ready" fires), so patching at "ready" edits the prototype
  // method too late: the live ContextMenu instance already has its
  // menuItems frozen from the original, unpatched method, and our
  // three pushed entries never make it in even though calling
  // ui.chat._getEntryContextOptions() by hand afterward correctly
  // includes them (confirmed live: that direct call returns all three,
  // but they never appeared in the actual right-click menu).
  //
  // CONFIG.ui.chat is the class reference pf2e registers for this
  // purpose, available at "init" before Foundry ever instantiates
  // ui.chat or builds its ContextMenu -- patching this prototype here
  // guarantees our wrapper runs during that first construction.
  const chatLogClass = CONFIG.ui?.chat;
  if (!chatLogClass?.prototype?._getEntryContextOptions) {
    console.error(
      DEBUG_PREFIX,
      "Could not find CONFIG.ui.chat's _getEntryContextOptions to patch -- the Improve Result options will not appear.",
      { configUiChat: CONFIG.ui?.chat, constructorName: chatLogClass?.name },
    );
    return;
  }

  const original = chatLogClass.prototype._getEntryContextOptions;
  chatLogClass.prototype._getEntryContextOptions = function (...args) {
    const options = original.apply(this, args);
    for (const steps of [1, 2, 3]) {
      options.push({
        label: `Improve Result by ${steps} (${steps} Hero Point${steps > 1 ? "s" : ""})`,
        icon: "fa-solid fa-hospital-symbol",
        visible: (li) => {
          const info = getContextForLi(li);
          if (!info) return false;
          return (ALLOWED_STEPS_BY_DEGREE[info.currentDegree] ?? []).includes(steps) && info.resource.value >= steps;
        },
        onClick: (_event, li) => {
          const message = game.messages.get(li?.dataset?.messageId);
          if (message) improveResult(message, steps);
        },
      });
    }
    return options;
  };
});
