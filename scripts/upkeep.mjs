import { MID, esc, setting, t, whisperFor } from "./util.mjs";
import { damageItem, hpOf, stateLabel, stateOf, syncBrokenArmor } from "./durability.mjs";

/* ======================================================================== *
 * After a fight (the GM ends the encounter):
 *   마모 (wear, setting): each equipped weapon / worn armor / shield of the
 *     party rolls a chance and loses a little Hit Points (Hardness may or may
 *     not apply) — keep-up of gear the rules leave to the GM.
 *   정비 창: HP, conditions (wounded, dying, doomed, fatigued, drained), focus
 *     points, what the fight did to the gear, and XP for everyone.
 *   When it opens: always / a chat button for the GM (default) / never.
 * ======================================================================== */

const CONDITIONS = ["wounded", "dying", "doomed", "fatigued", "drained", "frightened", "sickened", "clumsy", "enfeebled", "stupefied"];
let lastFight = { actors: [], wear: [] };

function partyOf(combat) {
  const list = (combat?.combatants?.contents ?? [...(combat?.combatants ?? [])]).map(c => c.actor).filter(a => a?.type === "character" && a.hasPlayerOwner);
  return [...new Map(list.map(a => [a.id, a])).values()];
}

const isMainGM = () => game.user.isGM && game.users.activeGM?.id === game.user.id;

/*
 * Wear from what happened in the fight (setting wearMode "events"):
 *   every time a character loses Hit Points, its worn armor rolls the wear chance;
 *   every damage roll made with a weapon (it hit), that weapon rolls it.
 * No hits, no wear — so a long fight wears gear down, and it can break mid-fight (wearTiming "live").
 * wearMode "flat": the old way, each equipped item rolls once at the end.
 */
const pending = new Map(); // combat id → [{ actorId, itemId, kind }]
const worn = new Map();    // combat id → [{ actor, item, from, to, state }]

async function rollWear(actor, item, combatId, { live }) {
  if (!item || hpOf(item).max <= 0 || stateOf(item) === "destroyed") return;
  const chance = Math.max(0, Math.min(100, Number(setting("wearChance", 15)) || 0));
  if (Math.random() * 100 >= chance) return;
  const roll = await new Roll(String(setting("wearAmount", "1") || "1")).evaluate().catch(() => null);
  const amount = Math.max(0, roll?.total ?? 1);
  const before = hpOf(item).value;
  const { taken, state } = await damageItem(item, amount, { ignoreHardness: !setting("wearHardness", false), quiet: true });
  if (!taken) return;
  const row = { actor: actor.name, actorId: actor.id, item: item.name, from: before, to: hpOf(item).value, state };
  if (!worn.has(combatId)) worn.set(combatId, []);
  worn.get(combatId).push(row);
  await syncBrokenArmor(actor);
  // Something broke in the middle of the fight: say so now.
  if (live && ["broken", "destroyed"].includes(state) && !["broken", "destroyed"].includes(stateOfValue(item, before))) {
    await ChatMessage.create({ whisper: whisperFor(actor), speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="rpf-card dur ${state}"><header><i class="fa-solid fa-link-slash"></i> <b>${t("Upkeep.BrokeNow")}</b></header><p>${t("Upkeep.BrokeNowLine", { actor: esc(actor.name), item: esc(item.name), state: esc(stateLabel(state)) })}</p></div>` });
  }
}

function stateOfValue(item, value) {
  const { max, bt } = hpOf(item);
  return value <= 0 ? "destroyed" : value <= bt ? "broken" : value < max ? "damaged" : "ok";
}

async function wearEvent(actor, item, kind) {
  const combat = game.combat;
  if (!setting("wearOn", false) || setting("wearMode", "events") !== "events" || !combat?.started || !actor?.hasPlayerOwner) return;
  if (setting("wearTiming", "live") === "live") return rollWear(actor, item, combat.id, { live: true });
  if (!pending.has(combat.id)) pending.set(combat.id, []);
  pending.get(combat.id).push({ actorId: actor.id, itemId: item.id, kind });
}

async function flatWear(actors, combatId) {
  for (const a of actors) {
    const gear = a.items.filter(i => ["weapon", "armor", "shield"].includes(i.type) && i.isEquipped && hpOf(i).max > 0);
    for (const item of gear) await rollWear(a, item, combatId, { live: false });
  }
}

export function installUpkeep() {
  // A character lost Hit Points in a fight: its armor takes the hit.
  Hooks.on("preUpdateActor", (actor, changes, options) => {
    const hp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
    if (hp !== undefined) options[`${MID}HpBefore`] = actor.system?.attributes?.hp?.value;
  });
  Hooks.on("updateActor", (actor, changes, options) => {
    if (!isMainGM()) return;
    const before = options?.[`${MID}HpBefore`];
    const now = actor.system?.attributes?.hp?.value;
    if (before === undefined || !(now < before)) return;
    const armor = actor.itemTypes?.armor?.find(a => a.isEquipped);
    if (armor) wearEvent(actor, armor, "hit");
  });
  // A damage roll with a weapon: the weapon was used (and hit).
  Hooks.on("createChatMessage", msg => {
    if (!isMainGM()) return;
    const f = msg.flags?.pf2e;
    if (f?.context?.type !== "damage-roll") return;
    const uuid = f.origin?.uuid;
    const item = uuid ? fromUuidSync(uuid) : null;
    const actor = item?.actor;
    if (item && actor && ["weapon", "shield"].includes(item.type)) wearEvent(actor, item, "use");
  });
  Hooks.on("deleteCombat", async combat => {
    if (!isMainGM()) return;
    const actors = partyOf(combat);
    if (!actors.length) return;
    if (setting("wearOn", false)) {
      if (setting("wearMode", "events") === "flat") await flatWear(actors, combat.id);
      else for (const ev of pending.get(combat.id) ?? []) {
        const a = game.actors.get(ev.actorId);
        await rollWear(a, a?.items.get(ev.itemId), combat.id, { live: false });
      }
    }
    const list = worn.get(combat.id) ?? [];
    pending.delete(combat.id);
    worn.delete(combat.id);
    lastFight = { actors: actors.map(a => a.id), wear: list };
    const mode = setting("upkeepPopup", "ask");
    if (!list.length && mode !== "ask") { if (mode === "always") openUpkeep(lastFight); return; }
    // One summary card (no card per item).
    const lines = list.map(w => `<li>${esc(w.actor)}: ${esc(w.item)} HP ${w.from} → <b>${w.to}</b>${["broken", "destroyed"].includes(w.state) ? ` <b class="warn">${esc(stateLabel(w.state))}</b>` : ""}</li>`).join("");
    await ChatMessage.create({
      whisper: setting("upkeepPublic", true) ? [] : game.users.filter(u => u.isGM).map(u => u.id),
      content: `<div class="rpf-card upkeep"><header><i class="fa-solid fa-campground"></i> <b>${t("Upkeep.Title")}</b></header>
        ${list.length ? `<p>${t("Upkeep.WearSaid")}</p><ul>${lines}</ul>` : `<p>${t("Upkeep.NoWear")}</p>`}
        ${mode !== "off" ? `<button type="button" data-rpf-upkeep="1"><i class="fa-solid fa-clipboard-list"></i> ${t("Upkeep.Open")}</button>` : ""}</div>`,
      flags: { [MID]: { upkeep: lastFight } }
    });
    if (mode === "always") openUpkeep(lastFight);
  });
  Hooks.on("renderChatMessageHTML", (msg, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    root?.querySelector?.("[data-rpf-upkeep]")?.addEventListener("click", ev => { ev.preventDefault(); if (game.user.isGM) openUpkeep(msg.getFlag?.(MID, "upkeep") ?? lastFight); });
  });
}

async function log(html, actor = null) {
  await ChatMessage.create({ speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: t("Upkeep.Title") },
    content: `<div class="rpf-card upkeep"><header><i class="fa-solid fa-campground"></i> <b>${t("Upkeep.Title")}</b></header><p>${html}</p></div>` });
}

export class UpkeepApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "rpf-upkeep",
    classes: ["rpf-app", "rpf-upkeep"],
    window: { title: "RPF.Upkeep.Title", icon: "fa-solid fa-campground", resizable: true },
    position: { width: 760, height: 560 }
  };

  constructor(fight) {
    super();
    this.fight = fight ?? lastFight;
  }

  get party() {
    const ids = this.fight?.actors?.length ? this.fight.actors : game.actors.filter(a => a.type === "character" && a.hasPlayerOwner).map(a => a.id);
    return ids.map(id => game.actors.get(id)).filter(Boolean);
  }

  async _renderHTML() {
    const rows = this.party.map(a => {
      const hp = a.system?.attributes?.hp ?? {};
      const pct = hp.max ? Math.round((hp.value / hp.max) * 100) : 0;
      const conds = CONDITIONS.map(slug => ({ slug, c: a.itemTypes?.condition?.find(c => c.slug === slug) })).filter(x => x.c)
        .map(({ slug, c }) => `<span class="cond ${slug}">${esc(c.name)}${c.value ? ` ${c.value}` : ""}</span>`).join("");
      const fp = a.system?.resources?.focus ?? {};
      const worn = (this.fight?.wear ?? []).filter(w => w.actorId === a.id);
      const broken = a.items.filter(i => ["weapon", "armor", "shield"].includes(i.type) && ["broken", "destroyed"].includes(stateOf(i)));
      return `<div class="rpf-up" data-id="${a.id}"><img src="${esc(a.img)}" alt="">
        <div class="nm"><b>${esc(a.name)}</b>
          <div class="hpbar"><i style="width:${pct}%"></i><span>HP ${hp.value ?? "?"} / ${hp.max ?? "?"}${hp.temp ? ` (+${hp.temp})` : ""}</span></div>
          <div class="facts">${conds || `<span class="rpf-dim">${t("Upkeep.NoConditions")}</span>`}
            ${fp.max ? ` · ${t("Upkeep.Focus", { n: fp.value ?? 0, max: fp.max })}` : ""}</div>
          ${worn.length ? `<div class="facts">${worn.map(w => `${esc(w.item)} ${w.from}→${w.to}`).join(" · ")}</div>` : ""}
          ${broken.length ? `<div class="facts warn">${t("Upkeep.Broken")}: ${broken.map(i => esc(i.name)).join(", ")}</div>` : ""}</div>
        <div class="acts">
          ${fp.max && (fp.value ?? 0) < fp.max ? `<button type="button" data-a="refocus" data-tooltip="${esc(t("Upkeep.RefocusHint"))}"><i class="fa-solid fa-sun"></i> +1</button>` : ""}
          <button type="button" data-a="dur" data-tooltip="${esc(t("Dur.Title"))}"><i class="fa-solid fa-shield-heart"></i></button>
          <button type="button" data-a="sheet" data-tooltip="${esc(t("Upkeep.Sheet"))}"><i class="fa-solid fa-id-card"></i></button></div></div>`;
    }).join("");
    return `<div class="rpf-upapp">
      <p class="rpf-hint">${t("Upkeep.Hint")}</p>
      <div class="list">${rows || `<p class="rpf-empty">${t("Upkeep.NoParty")}</p>`}</div>
      <footer class="row"><label class="inline">${t("Upkeep.Xp")} <input type="number" min="0" step="10" value="${this.xp ?? 80}" data-a="xp-n" class="n"></label>
        ${[40, 60, 80, 120].map(n => `<button type="button" class="mini" data-a="xp-set" data-n="${n}">${n}</button>`).join("")}
        <button type="button" class="primary" data-a="xp"><i class="fa-solid fa-star"></i> ${t("Upkeep.GiveXp")}</button>
        <span class="sep"></span>
        <button type="button" data-a="summary"><i class="fa-solid fa-comment"></i> ${t("Upkeep.ToChat")}</button></footer></div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    if (this._wired === content) return;
    this._wired = content;
    content.addEventListener("click", ev => this.onClick(ev));
    content.addEventListener("change", ev => { if (ev.target.dataset.a === "xp-n") this.xp = Number(ev.target.value) || 0; });
  }

  async onClick(ev) {
    const el = ev.target.closest("[data-a]");
    if (!el || el.tagName === "INPUT") return;
    ev.preventDefault();
    const a = game.actors.get(el.closest("[data-id]")?.dataset.id);
    switch (el.dataset.a) {
      case "refocus": {
        const fp = a.system.resources.focus;
        await a.update({ "system.resources.focus.value": Math.min(fp.max, (fp.value ?? 0) + 1) });
        await log(t("Upkeep.Refocused", { who: esc(a.name), n: Math.min(fp.max, (fp.value ?? 0) + 1), max: fp.max }), a);
        game.rutzDays?.declare?.({ actor: a, minutes: 10, label: t("Upkeep.RefocusLabel") });
        return this.render();
      }
      case "dur": return game.rutzForge?.durability(a);
      case "sheet": return a?.sheet?.render(true);
      case "xp-set": this.xp = Number(el.dataset.n); return this.render();
      case "xp": {
        const n = Number(this.xp ?? this.element.querySelector("[data-a=xp-n]")?.value) || 0;
        if (!n || !game.user.isGM) return;
        for (const p of this.party) await p.update({ "system.details.xp.value": (Number(p.system?.details?.xp?.value) || 0) + n });
        await ChatMessage.create({ content: `<div class="rpf-card upkeep"><header><i class="fa-solid fa-star"></i> <b>${t("Upkeep.XpTitle")}</b></header><p>${t("Upkeep.XpSaid", { n, who: this.party.map(p => esc(p.name)).join(", ") })}</p></div>` });
        return this.render();
      }
      case "summary": {
        const lines = this.party.map(p => {
          const hp = p.system?.attributes?.hp ?? {};
          const conds = CONDITIONS.map(s => p.itemTypes?.condition?.find(c => c.slug === s)).filter(Boolean).map(c => `${c.name}${c.value ? ` ${c.value}` : ""}`).join(", ");
          return `<li><b>${esc(p.name)}</b> HP ${hp.value}/${hp.max}${conds ? ` · ${esc(conds)}` : ""}</li>`;
        }).join("");
        return ChatMessage.create({ content: `<div class="rpf-card upkeep"><header><i class="fa-solid fa-campground"></i> <b>${t("Upkeep.Title")}</b></header><ul>${lines}</ul></div>` });
      }
    }
  }
}

export function openUpkeep(fight = null) {
  const open = foundry.applications.instances.get("rpf-upkeep");
  if (open) { if (fight) open.fight = fight; open.render(true); return open; }
  const app = new UpkeepApp(fight);
  app.render(true);
  return app;
}
