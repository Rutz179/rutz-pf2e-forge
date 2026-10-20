import { MID, esc, formatCp, incomePerDay, levelDC, pay, priceCp, randomId, setting, sourceIdOf, t } from "./util.mjs";

/* ======================================================================== *
 * Crafting as a project you can see (Craft, Player Core — remaster):
 *
 *   준비   — 2 days of work setting up, or 1 day if you have the formula
 *            (the GM can set another number). Raw materials (half the Price)
 *            must be at hand, but are spent only on a success.
 *   판정   — then the Crafting check against the item's level DC.
 *            Success: the materials are spent and the work begins; critical
 *            success: every day counts as one level higher. Failure: you
 *            salvage everything and start over. Critical failure: 10% of the
 *            materials are ruined.
 *   작업   — each further downtime day takes the Earn Income amount for your
 *            level and Crafting rank (× the GM's rate) off what is left.
 *            You can finish any time by paying the rest; when the work
 *            covers it, the item is done for free.
 * Days come from (setting craftClock): the day planner's crafting hours
 * (Rutz's PF2e Days, 8 h = 1 day), the world clock (every day that passes is
 * a day of work), or by hand on the workbench.
 * The project shows on the character as an effect "제작 중: …".
 * ======================================================================== */

export function projectsOf(actor) {
  return foundry.utils.deepClone(actor?.getFlag?.(MID, "projects") ?? []);
}

async function saveProjects(actor, list) {
  await actor.update({ [`flags.${MID}.projects`]: list });
}

export function remainingCp(p) {
  return Math.max(0, p.price - p.materials - p.progress);
}

export function daysLeft(p) {
  return p.perDay > 0 ? Math.ceil(remainingCp(p) / p.perDay) : Infinity;
}

const today = () => Math.floor((game.time?.worldTime ?? 0) / 86400);

function hasFormula(actor, doc) {
  const known = new Set((actor?.system?.crafting?.formulas ?? []).map(f => f.uuid));
  return known.has(doc.uuid) || known.has(sourceIdOf(doc));
}

/** Days of setting up before the check: 2, or 1 with the formula (remaster); the GM may set a number. */
export function setupDaysFor(actor, doc) {
  const n = Number(setting("setupDays", -1));
  if (n >= 0) return n;
  return hasFormula(actor, doc) ? 1 : 2;
}

/** What a project of this item would look like (before the check). */
export function preview(actor, doc, qty = 1) {
  const level = Number(doc.system?.level?.value ?? 0);
  const rank = Number(actor?.skills?.crafting?.rank ?? 0);
  const price = priceCp(doc, qty);
  const rate = Number(setting("dailyRate", 1)) || 1;
  const formulas = new Set((actor?.system?.crafting?.formulas ?? []).map(f => f.uuid));
  return {
    level, rank, price, materials: Math.ceil(price / 2), dc: levelDC(level, doc.system?.traits?.rarity),
    perDay: Math.round(incomePerDay(actor?.level ?? 0, rank) * rate), perDayCrit: Math.round(incomePerDay(actor?.level ?? 0, rank, true) * rate),
    setupDays: setupDaysFor(actor, doc),
    problems: [
      !rank ? t("Craft.Need.Trained") : null,
      level > (actor?.level ?? 0) ? t("Craft.Need.Level", { n: level }) : null,
      (doc.system?.traits?.rarity ?? "common") !== "common" && !formulas.has(doc.uuid) ? t("Craft.Need.Rarity") : null,
      formulas.size && !formulas.has(doc.uuid) && !formulas.has(sourceIdOf(doc)) ? t("Craft.Need.Formula") : null
    ].filter(Boolean)
  };
}

async function say(actor, html) {
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="rpf-card craft"><header><i class="fa-solid fa-hammer"></i> <b>${t("Craft.Title")}</b></header>${html}</div>` });
}

async function syncEffect(actor, p) {
  const eff = actor.itemTypes?.effect?.find(e => e.getFlag(MID, "project") === p.id);
  if (!p.active) { if (eff) await eff.delete(); return; }
  const name = t(p.phase === "work" ? "Craft.EffectName" : "Craft.EffectSetup", { name: p.name });
  const desc = p.phase === "work" ? `<p>${t("Craft.EffectDesc", { done: formatCp(p.materials + p.progress), price: formatCp(p.price), left: formatCp(remainingCp(p)), per: formatCp(p.perDay) })}</p>`
    : `<p>${t("Craft.EffectSetupDesc", { left: p.setupLeft ?? 0, dc: p.dc })}</p>`;
  if (eff) return eff.update({ name, "system.badge": { type: "counter", value: Math.max(1, p.days) }, "system.description.value": desc });
  await actor.createEmbeddedDocuments("Item", [{
    type: "effect", name, img: p.img || "icons/tools/smithing/anvil.webp",
    system: { badge: { type: "counter", value: Math.max(1, p.days) }, duration: { value: -1, unit: "unlimited", expiry: null, sustained: false }, tokenIcon: { show: true }, description: { value: desc }, rules: [] },
    flags: { [MID]: { project: p.id } }
  }]);
}

/** Begin: the setup days (no money yet). With no setup days the check comes at once. */
export async function startProject(actor, doc, qty = 1) {
  const pv = preview(actor, doc, qty);
  if (!actor.skills?.crafting?.rank) { ui.notifications.warn(t("Craft.Need.Trained")); return null; }
  const p = {
    id: randomId(), uuid: doc.uuid, name: qty > 1 ? `${doc.name} ×${qty}` : doc.name, img: doc.img, qty, level: pv.level,
    price: pv.price, materials: pv.materials, dc: pv.dc, perDay: 0, progress: 0, days: 0,
    phase: pv.setupDays > 0 ? "setup" : "check", setupLeft: pv.setupDays, setupDays: pv.setupDays,
    started: today(), lastDay: today(), active: true, critical: false
  };
  const list = projectsOf(actor);
  list.push(p);
  await saveProjects(actor, list);
  await syncEffect(actor, p);
  await say(actor, `<p>${t(p.phase === "setup" ? "Craft.SetupStarted" : "Craft.CheckNow", { item: esc(p.name), days: p.setupDays, materials: formatCp(p.materials) })}</p>`);
  return p;
}

/** The Crafting check after the setup. Success: pay the materials and start working. */
export async function checkProject(actor, id) {
  const list = projectsOf(actor);
  const p = list.find(x => x.id === id && x.active);
  if (!p || p.phase !== "check") return null;
  const stat = actor.skills?.crafting;
  if (!stat?.rank) { ui.notifications.warn(t("Craft.Need.Trained")); return null; }
  const roll = await stat.roll({ dc: { value: p.dc }, extraRollOptions: ["action:craft"], label: `${t("Craft.Title")}: ${p.name}` }).catch(() => null);
  const degree = roll?.degreeOfSuccess ?? roll?.options?.degreeOfSuccess;
  if (degree === undefined || degree === null) return null;
  if (degree <= 1) {
    if (degree === 0) {
      const lost = Math.ceil(p.materials * 0.1);
      await pay(actor, lost);
      await say(actor, `<p>${t("Craft.CritFail", { item: esc(p.name), lost: formatCp(lost) })}</p>`);
    } else await say(actor, `<p>${t("Craft.Fail", { item: esc(p.name) })}</p>`);
    p.active = false;
    await saveProjects(actor, list.filter(x => x.id !== id));
    await syncEffect(actor, p);
    return null;
  }
  if (!(await pay(actor, p.materials))) { ui.notifications.warn(t("Craft.NoMoney", { need: formatCp(p.materials) })); return null; }
  const rate = Number(setting("dailyRate", 1)) || 1;
  p.critical = degree === 3;
  p.perDay = Math.round(incomePerDay(actor.level ?? 0, stat.rank ?? 0, p.critical) * rate);
  p.phase = "work";
  p.lastDay = today();
  await saveProjects(actor, list);
  await syncEffect(actor, p);
  await say(actor, `<p>${t("Craft.Started", { item: esc(p.name), materials: formatCp(p.materials), per: formatCp(p.perDay), days: daysLeft(p) })}</p>`);
  return p;
}

/** Days of work: first the setup days, then the reduction of what is left. */
export async function workDays(actor, id, days = 1) {
  const list = projectsOf(actor);
  const p = list.find(x => x.id === id && x.active);
  if (!p || days <= 0) return null;
  p.lastDay = today();
  if (p.phase === "setup") {
    p.setupLeft = Math.max(0, (p.setupLeft ?? 0) - days);
    p.days += days;
    if (p.setupLeft <= 0) {
      p.phase = "check";
      await say(actor, `<p>${t("Craft.SetupDone", { item: esc(p.name), dc: p.dc })}</p>`);
    }
    await saveProjects(actor, list);
    await syncEffect(actor, p);
    return p;
  }
  if (p.phase !== "work") return p;
  p.days += days;
  p.progress = Math.min(p.price - p.materials, p.progress + Math.round(p.perDay * days));
  await saveProjects(actor, list);
  if (remainingCp(p) <= 0) return finishProject(actor, id, { free: true });
  await syncEffect(actor, p);
  return p;
}

/** "plan" | "time" | "manual": what counts days of crafting work ("auto" resolved). */
export function clockMode() {
  const m = setting("craftClock", "auto");
  if (m !== "auto") return m;
  return game.modules.get("rutz-pf2e-days")?.active ? "plan" : "time";
}

/** World clock (setting craftClock "time"): every whole day that passed is a day of work. GM only. */
export async function workByClock() {
  if (clockMode() !== "time") return;
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  const now = today();
  for (const actor of game.actors.filter(a => a.type === "character")) {
    for (const p of projectsOf(actor).filter(x => x.active)) {
      const n = now - (p.lastDay ?? now);
      if (n > 0) await workDays(actor, p.id, n);
    }
  }
}

/** Pay what is left (nothing if the work covered it) and take the item. */
export async function finishProject(actor, id, { free = false } = {}) {
  const list = projectsOf(actor);
  const p = list.find(x => x.id === id && x.active);
  if (!p || p.phase !== "work") return null;
  const left = remainingCp(p);
  if (left > 0 && !free && !(await pay(actor, left))) { ui.notifications.warn(t("Craft.NoMoney", { need: formatCp(left) })); return null; }
  const doc = await fromUuid(p.uuid).catch(() => null);
  if (doc) {
    const src = doc.toObject();
    delete src._id;
    src.system.quantity = p.qty;
    src._stats = { ...(src._stats ?? {}), compendiumSource: doc.pack ? doc.uuid : sourceIdOf(doc) };
    src.flags = { ...(src.flags ?? {}), [MID]: { crafted: { by: actor.id, day: Math.floor((game.time?.worldTime ?? 0) / 86400) } } };
    await actor.createEmbeddedDocuments("Item", [src]);
  }
  p.active = false;
  await saveProjects(actor, list.filter(x => x.id !== id));
  await syncEffect(actor, p);
  await say(actor, `<p>${t(left > 0 && !free ? "Craft.FinishedPaid" : "Craft.FinishedFree", { item: esc(p.name), paid: formatCp(left), days: p.days })}</p>`);
  return p;
}

export async function abandonProject(actor, id) {
  const list = projectsOf(actor);
  const p = list.find(x => x.id === id);
  if (!p) return;
  p.active = false;
  await saveProjects(actor, list.filter(x => x.id !== id));
  await syncEffect(actor, p);
  await say(actor, `<p>${t("Craft.Abandoned", { item: esc(p.name) })}</p>`);
}

/** For the time planner: days of crafting on the first active project (or all). Returns how many projects there were. */
export async function workAll(actor, days = 1, { first = true } = {}) {
  const list = projectsOf(actor).filter(p => p.active);
  for (const p of first ? list.slice(0, 1) : list) await workDays(actor, p.id, days);
  return list.length;
}
