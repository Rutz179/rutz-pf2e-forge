import { MID, esc, setting, t, whisperFor } from "./util.mjs";
import { hpOf, stateLabel, stateOf, syncBroken } from "./durability.mjs";

/* ======================================================================== *
 * Durability where the players look: a small HP bar next to every weapon,
 * armor and shield in the inventory (setting: always / only when damaged /
 * off), a "파손" tag on broken ones, and a whisper to the owners the moment
 * an item loses Hit Points. Clicking a bar opens the durability window.
 * ======================================================================== */

const ICON = { damaged: "fa-heart-crack", broken: "fa-link-slash", destroyed: "fa-skull" };

function barFor(item) {
  const h = hpOf(item);
  if (!h.max) return null;
  const st = stateOf(item);
  const mode = setting("sheetBars", "always");
  if (mode === "off" || (mode === "damaged" && st === "ok")) return null;
  const el = document.createElement("span");
  el.className = `rpf-mark ${st}`;
  el.dataset.rpfItem = item.id;
  el.dataset.tooltip = `${stateLabel(st)} · HP ${h.value}/${h.max} · BT ${h.bt} · ${t("Hardness")} ${h.hardness}`;
  const pct = Math.max(0, Math.min(100, Math.round((h.value / h.max) * 100)));
  el.innerHTML = `<span class="bar"><i style="width:${pct}%"></i><b style="left:${Math.round((h.bt / h.max) * 100)}%"></b></span>${["broken", "destroyed"].includes(st) ? `<em>${esc(stateLabel(st))}</em>` : ""}`;
  return el;
}

function marks(app, html) {
  const actor = app?.actor ?? app?.document;
  if (!actor?.items || !["character", "npc", "familiar"].includes(actor.type)) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? app?.element;
  if (!root?.querySelectorAll) return;
  for (const row of root.querySelectorAll("[data-item-id]")) {
    const item = actor.items.get(row.dataset.itemId);
    if (!item || !["weapon", "armor", "shield"].includes(item.type) || row.querySelector(":scope .rpf-mark")) continue;
    const bar = barFor(item);
    if (!bar) continue;
    // Next to the name, never inside it (inside, PF2e's name styles laid the bar over the text).
    const name = row.querySelector(".item-name h4, .item-name .name, h4, .name");
    if (name?.parentElement) name.insertAdjacentElement("afterend", bar);
    else (row.querySelector(".item-name") ?? row).appendChild(bar);
    bar.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); game.rutzForge?.durability(actor, item.id); });
  }
}

export function installMarks() {
  Hooks.on("renderActorSheet", marks);
  Hooks.on("renderActorSheetV2", marks);
  Hooks.on("preUpdateItem", (item, changes, options) => {
    if (!hpOf(item).max) return;
    options[MID] = { ...(options[MID] ?? {}), hpBefore: hpOf(item).value };
  });
  Hooks.on("updateItem", async (item, changes, options, userId) => {
    if (userId !== game.user.id) return;
    const actor = item.actor;
    const before = options?.[MID]?.hpBefore;
    if (actor && (before !== undefined || "equipped" in (changes.system ?? {}))) await syncBroken(actor);
    if (before === undefined || !actor || options?.[MID]?.quiet || !setting("notice", true) || actor.getFlag?.("rutz-pf2e-shop", "shop")) return;
    const h = hpOf(item);
    if (h.value >= before) return;
    const st = stateOf(item);
    const state = ["broken", "destroyed"].includes(st) ? `<p class="warn"><b>${esc(stateLabel(st))}</b> — ${t(`NoticeState.${st}`)}</p>` : "";
    await ChatMessage.create({
      content: `<div class="rpf-card dur ${st}"><header><i class="fa-solid ${ICON[st] ?? "fa-shield-heart"}"></i> <b>${t("NoticeTitle")}</b></header>
        <p>${t("Notice", { actor: esc(actor.name), item: esc(item.name), from: before, to: h.value, max: h.max, bt: h.bt })}</p>${state}</div>`,
      whisper: whisperFor(actor), speaker: ChatMessage.getSpeaker({ actor })
    });
  });
}
