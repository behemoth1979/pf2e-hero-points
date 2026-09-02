/**
 * House rule: right-clicking a check/save roll's chat message offers
 * "Improve Result by 1/2/3 (Hero Point(s))" alongside the system's own
 * "Reroll a Check" options -- spend N Hero Points to raise the degree of
 * success by N steps, capped at critical success/critical save.
 *
 * Deliberately does NOT reimplement the system's own reroll pipeline
 * (Check#rerollFromMessage in src/module/system/check/check.ts) -- that
 * evaluates a brand new d20 roll and rebuilds the chat card with a custom
 * old/new side-by-side render, delete-and-recreating the message. This
 * doesn't need a new roll at all, just the existing roll's degree of
 * success moved up N steps, so instead it updates the same canonical
 * fields the built-in reroll updates (flags.pf2e.context.outcome, and the
 * roll's own options.degreeOfSuccess) and lets Foundry's standard
 * document-update re-render handle the chat card display -- lower risk
 * than trying to blind-replicate the system's own custom rendering, at
 * the cost of not visually showing an old-vs-new comparison the way a
 * real reroll does. A flavor-text note is added either way so the change
 * is clearly visible regardless of how the card itself re-renders.
 *
 * Confirmed against real pf2e source before use, not guessed:
 * - Check is genuinely exposed at game.pf2e.Check (src/scripts/
 *   set-game-pf2e.ts), though this script doesn't call into it directly
 *   for the reasons above.
 * - actor.updateResource(slug, newValue) is the actual API the system's
 *   own reroll uses to spend Hero Points (resource.slug is "hero-points").
 * - Degree of success is encoded 0-3 (criticalFailure/failure/success/
 *   criticalSuccess) and stored in both flags.pf2e.context.outcome (a
 *   string) and the roll's own options.degreeOfSuccess (a number) --
 *   confirmed by reading rerollFromMessage's own update logic, where both
 *   are set together from the same computed degree.
 */

const DEGREE_STRINGS = ["criticalFailure", "failure", "success", "criticalSuccess"];
const DEGREE_LABELS = ["Critical Failure", "Failure", "Success", "Critical Success"];

function getLiElement(li) {
  // Foundry's context-menu condition/callback receives either a raw
  // HTMLElement or a jQuery-wrapped one depending on version; handle both.
  return li instanceof HTMLElement ? li : li[0];
}

function getContextForLi(li) {
  const element = getLiElement(li);
  const messageId = element?.dataset?.messageId;
  const message = messageId ? game.messages.get(messageId) : null;
  if (!message) return null;

  const actor = message.actor;
  if (!actor?.isOwner) return null;
  if (!(message.isAuthor || game.user.isGM)) return null;

  const rollContext = message.flags?.pf2e?.context;
  if (!rollContext?.outcome) return null;

  const currentDegree = DEGREE_STRINGS.indexOf(rollContext.outcome);
  if (currentDegree === -1 || currentDegree >= 3) return null; // already critical success

  const resource = actor.getResource?.("hero-points");
  if (!resource) return null;

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

Hooks.on("getChatLogEntryContext", (_html, options) => {
  for (const steps of [1, 2, 3]) {
    options.push({
      name: `Improve Result by ${steps} (${steps} Hero Point${steps > 1 ? "s" : ""})`,
      icon: '<i class="fa-solid fa-hospital-symbol"></i>',
      condition: (li) => {
        const info = getContextForLi(li);
        return !!info && info.resource.value >= steps;
      },
      callback: (li) => {
        const element = getLiElement(li);
        const message = game.messages.get(element?.dataset?.messageId);
        if (message) improveResult(message, steps);
      },
    });
  }
});
