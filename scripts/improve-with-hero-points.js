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
 * `ui.chat` is the live ChatLog application instance (a stable, standard
 * Foundry global), so `ui.chat.constructor.prototype._getEntryContextOptions`
 * is the real ChatLogPF2e prototype method, patched at the "ready" hook
 * (after the UI exists) to call the original then push three more entries.
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

// TEMPORARY: verbose diagnostics while chasing why the menu options don't
// appear at all in play, despite the patch itself applying without error.
// Logs the specific reason getContextForLi rejected a message, once per
// right-click (not once per Hero Point tier) via a short-lived cache keyed
// on message id, so opening one context menu doesn't log the same reason 3x.
const DEBUG_PREFIX = "phil-pf2e-hero-points |";
let lastLoggedMessageId = null;

function getContextForLi(li) {
  const messageId = li?.dataset?.messageId;
  const shouldLog = messageId && messageId !== lastLoggedMessageId;
  if (shouldLog) lastLoggedMessageId = messageId;
  const log = (reason, extra) => {
    if (shouldLog) console.log(DEBUG_PREFIX, "hidden:", reason, extra ?? "");
  };

  const message = game.messages.get(messageId);
  if (!message) {
    log("no message found for li.dataset.messageId", messageId);
    return null;
  }

  const actor = message.actor;
  if (!actor?.isOwner) {
    log("actor missing or not owned", actor?.name);
    return null;
  }
  if (!(message.isAuthor || game.user.isGM)) {
    log("not message author and not GM");
    return null;
  }

  const rollContext = message.flags?.pf2e?.context;
  if (!rollContext?.outcome) {
    log("no flags.pf2e.context.outcome on this message -- likely no target/DC was set for this roll", rollContext);
    return null;
  }

  const currentDegree = DEGREE_STRINGS.indexOf(rollContext.outcome);
  if (currentDegree === -1) {
    log("context.outcome present but not a recognized degree string", rollContext.outcome);
    return null;
  }
  if (currentDegree >= 3) {
    log("already critical success/critical save, nothing to improve");
    return null;
  }

  const resource = actor.getResource?.("hero-points");
  if (!resource) {
    log("actor.getResource('hero-points') returned nothing -- resource slug may differ on this actor/system version");
    return null;
  }
  if (resource.value <= 0) {
    log("character has 0 Hero Points", resource);
    return null;
  }

  if (shouldLog) console.log(DEBUG_PREFIX, "eligible:", { degree: DEGREE_LABELS[currentDegree], heroPoints: resource.value });
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

Hooks.once("ready", () => {
  const chatLogClass = ui.chat?.constructor;
  if (!chatLogClass?.prototype?._getEntryContextOptions) {
    console.error(
      DEBUG_PREFIX,
      "Could not find ui.chat's _getEntryContextOptions to patch -- the Improve Result options will not appear.",
      { uiChat: ui.chat, constructorName: chatLogClass?.name },
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
          return !!info && info.resource.value >= steps;
        },
        onClick: (_event, li) => {
          const message = game.messages.get(li?.dataset?.messageId);
          if (message) improveResult(message, steps);
        },
      });
    }
    return options;
  };

  console.log(DEBUG_PREFIX, "Patched", chatLogClass.name + ".prototype._getEntryContextOptions successfully.");
});
