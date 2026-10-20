import { MID, setting, t } from "./util.mjs";

/* ======================================================================== *
 * Item damage, as the rules have it (Player Core p. 269, GM Core p. 252):
 *   damage is reduced by Hardness; at or below the Broken Threshold the item
 *   is broken, at 0 HP destroyed (can't be Repaired). Broken armor keeps its
 *   item bonus but takes a status penalty to AC (–1 light, –2 medium,
 *   –3 heavy); other broken items don't work.
 *
 * PF2e gives Hit Points to shields only. Weapons and armor get them here from
 * their material: ordinary ones from the base table (a sword is thin iron,
 * plate is iron, leather is leather …), precious ones (cold iron, silver,
 * adamantine …) from the precious materials table by grade — thin items for
 * weapons, items for armor.
 * ======================================================================== */

// GM Core table 11-4: [Hardness, HP, BT]
export const MATERIALS = {
  paper: [0, 1, 0], "thin-cloth": [0, 1, 0], cloth: [1, 4, 2], "thin-leather": [2, 8, 4], "thin-rope": [2, 8, 4],
  "thin-wood": [3, 12, 6], leather: [4, 16, 8], rope: [4, 16, 8], "thin-stone": [5, 16, 8], "thin-iron": [5, 20, 10],
  wood: [5, 20, 10], stone: [7, 28, 14], iron: [9, 36, 18]
};

// Precious materials (GM Core): grade → { thin, item } [Hardness, HP, BT].
export const PRECIOUS = {
  "adamantine": { standard: { thin: [10, 40, 20], item: [14, 56, 28] }, high: { thin: [13, 52, 26], item: [17, 68, 34] } },
  "cold-iron": { low: { thin: [5, 20, 10], item: [9, 36, 18] }, standard: { thin: [7, 28, 14], item: [11, 44, 22] }, high: { thin: [10, 40, 20], item: [13, 52, 26] } },
  "silver": { low: { thin: [3, 12, 6], item: [5, 20, 10] }, standard: { thin: [5, 20, 10], item: [7, 28, 14] }, high: { thin: [8, 32, 16], item: [10, 40, 20] } },
  "dawnsilver": { standard: { thin: [5, 20, 10], item: [9, 36, 18] }, high: { thin: [8, 32, 16], item: [12, 48, 24] } },
  "duskwood": { standard: { thin: [5, 20, 10], item: [7, 28, 14] }, high: { thin: [8, 32, 16], item: [10, 40, 20] } },
  "dragonhide": { standard: { thin: [4, 16, 8], item: [7, 28, 14] }, high: { thin: [8, 32, 16], item: [11, 44, 22] } },
  "orichalcum": { high: { thin: [16, 64, 32], item: [18, 72, 36] } }
};

const WOODEN_WEAPON_GROUPS = new Set(["club", "bow", "sling", "dart"]);

/** The base-table row that fits an item (a guess; the GM can pick another). */
export function guessMaterial(item) {
  const s = item.system ?? {};
  if (item.type === "armor") {
    if (s.category === "unarmored" || s.group === "cloth") return "cloth";
    if (s.group === "leather") return "leather";
    if (s.group === "wood") return "wood";
    return "iron";
  }
  if (item.type === "weapon") {
    const traits = s.traits?.value ?? [];
    if (s.baseItem === "whip" || traits.includes("whip")) return "thin-leather";
    if (WOODEN_WEAPON_GROUPS.has(s.group) || /staff|club|bow|sling/.test(s.baseItem ?? "")) return "thin-wood";
    return "thin-iron";
  }
  if (item.type === "shield") return /wooden/.test(s.baseItem ?? "") ? "thin-wood" : "thin-iron";
  if (item.type === "backpack") return "thin-leather";
  return "cloth";
}

/** [Hardness, HP, BT] the item should have by its material (precious first). */
export function statsFor(item) {
  const m = item.system?.material ?? {};
  const p = m.type && PRECIOUS[m.type]?.[m.grade ?? "standard"];
  if (p) return item.type === "armor" ? p.item : p.thin;
  return MATERIALS[guessMaterial(item)];
}

export function hpOf(item) {
  const hp = item.system?.hp ?? {};
  const max = Number(hp.max ?? 0) || 0;
  const value = Number(hp.value ?? 0) || 0;
  const bt = Number(item.hitPoints?.brokenThreshold ?? hp.brokenThreshold ?? Math.floor(max / 2)) || 0;
  return { value, max, bt, hardness: Number(item.system?.hardness ?? 0) || 0 };
}

export function stateOf(item) {
  const { value, max, bt } = hpOf(item);
  if (max <= 0) return "none";
  if (value <= 0) return "destroyed";
  if (value <= bt) return "broken";
  if (value < max) return "damaged";
  return "ok";
}

export function stateLabel(state) {
  return t(`State.${state}`);
}

/** Give an item Hardness/HP from a row (keeps the share of HP it had left). */
export async function setStats(item, row) {
  if (!row) return;
  const [hardness, max] = row;
  const cur = hpOf(item);
  const value = cur.max > 0 ? Math.max(cur.value > 0 ? 1 : 0, Math.round((cur.value / cur.max) * max)) : max;
  await item.update({ "system.hardness": hardness, "system.hp.max": max, "system.hp.value": value });
}

export async function setMaterial(item, key) {
  return setStats(item, MATERIALS[key]);
}

/** Damage through Hardness. quiet: no chat notice for this one (a summary says it). */
export async function damageItem(item, amount, { ignoreHardness = false, quiet = false } = {}) {
  const { value, hardness } = hpOf(item);
  const taken = Math.max(0, Math.floor(Number(amount) || 0) - (ignoreHardness ? 0 : hardness));
  if (taken) await item.update({ "system.hp.value": Math.max(0, value - taken) }, { [MID]: { quiet } });
  return { taken, state: stateOf(item) };
}

export async function healItem(item, amount = null, { quiet = true } = {}) {
  const { value, max } = hpOf(item);
  if (value <= 0) return false;
  await item.update({ "system.hp.value": amount === null ? max : Math.min(max, value + Math.max(0, Number(amount) || 0)) }, { [MID]: { quiet } });
  return true;
}

/** Set the Hit Points directly (the bar in the durability window). */
export async function setHp(item, value) {
  const { max } = hpOf(item);
  await item.update({ "system.hp.value": Math.max(0, Math.min(max, Math.round(Number(value) || 0))) }, { [MID]: { quiet: true } });
}

/** Repair (Player Core p. 236): success 5 + 5 × rank, critical 10 + 10 × rank (rank = Crafting proficiency). */
export function repairAmount(rank, critical = false) {
  const r = Math.max(0, Math.min(4, Number(rank) || 0));
  return critical ? 10 + 10 * r : 5 + 5 * r;
}

/** Weapons/armor without Hit Points get them from their material (setting). */
export async function ensureStats(item) {
  if (!["weapon", "armor"].includes(item?.type) || hpOf(item).max > 0) return false;
  await setStats(item, statsFor(item));
  return true;
}

/* ---------------- broken gear → effects on the character ---------------- */
/*
 * Rules (Player Core, Item Damage): a broken item can't be used for its normal function nor grant its
 * bonuses — except armor, which keeps its item bonus but takes a status penalty to AC (−1 light,
 * −2 medium, −3 heavy). PF2e itself doesn't track any of that, so an effect "파손: <item>" is put on
 * the character for each equipped broken item (it shows on the sheet and the token):
 *   armor   — the AC penalty (always, as written)
 *   weapons — by the GM's choice (setting brokenRule):
 *     raw      a reminder on every attack with it ("can't be used normally")
 *     penalty  −2 status penalty to attacks with it (house rule: still usable, badly)
 *     clumsy   clumsy 1 (house rule: −1 to Dex-based checks and DCs)
 *   shields — the reminder only (PF2e already stops a broken shield's Shield Block bonus).
 */

const PENALTY = { light: -1, medium: -2, heavy: -3 };
// Foundry core's own icon: always there (a guessed icon path shows as a broken image).
const FALLBACK_ICON = "icons/svg/hazard.svg";

function brokenRules(item) {
  const label = t("Broken.Label", { name: item.name });
  if (item.type === "armor") return [{ key: "FlatModifier", selector: "ac", type: "status", value: PENALTY[item.system?.category] ?? -1, label }];
  if (item.type === "weapon") {
    // Strikes with this weapon: every attack roll carries the roll option item:id:<id>.
    const predicate = [`item:id:${item.id}`];
    const mode = setting("brokenRule", "raw");
    const note = text => ({ key: "RollNote", selector: "attack-roll", predicate, text: `<p><strong>${t("Broken.Tag")}</strong> ${t(text)}</p>` });
    if (mode === "penalty") return [{ key: "FlatModifier", selector: "attack-roll", predicate, type: "status", value: -2, label }, note("Broken.NotePenalty")];
    if (mode === "clumsy") return [{ key: "FlatModifier", selector: "dex-based", type: "status", value: -1, label: t("Broken.Clumsy", { name: item.name }) }, note("Broken.NoteClumsy")];
    return [note("Broken.NoteRaw")];
  }
  return [];
}

// One sync at a time per actor: the sheet hook and the window both ask after the same change,
// and two syncs running side by side each made an effect.
const queue = new Map();

/** Keep one effect per equipped broken weapon / armor / shield, and none for the rest. */
export function syncBroken(actor) {
  if (!actor?.isOwner || !actor.items || !setting("brokenArmor", true)) return Promise.resolve();
  const prev = queue.get(actor.uuid) ?? Promise.resolve();
  const next = prev.catch(() => null).then(() => doSync(actor));
  queue.set(actor.uuid, next);
  next.finally(() => { if (queue.get(actor.uuid) === next) queue.delete(actor.uuid); });
  return next;
}

async function doSync(actor) {
  const want = actor.items.filter(i => ["weapon", "armor", "shield"].includes(i.type) && i.isEquipped && stateOf(i) === "broken");
  const have = actor.itemTypes?.effect?.filter(e => e.getFlag(MID, "brokenItem") || e.getFlag(MID, "brokenArmor")) ?? [];
  const keep = new Map();
  const drop = [];
  for (const e of have) {
    const id = e.getFlag(MID, "brokenItem");
    if (!want.some(i => i.id === id) || keep.has(id)) drop.push(e.id); // gone, or a second copy
    else keep.set(id, e);
  }
  if (drop.length) await actor.deleteEmbeddedDocuments("Item", drop);
  const creates = [];
  for (const item of want) {
    const rules = brokenRules(item);
    const name = t("Broken.Effect", { name: item.name });
    const eff = keep.get(item.id);
    if (eff) {
      if (eff.name !== name || JSON.stringify(eff.system?.rules ?? []) !== JSON.stringify(rules)) await eff.update({ name, "system.rules": rules });
      continue;
    }
    creates.push({
      type: "effect", name, img: item.img || FALLBACK_ICON,
      system: { rules, duration: { value: -1, unit: "unlimited", expiry: null, sustained: false }, tokenIcon: { show: true },
        description: { value: `<p>${t(`Broken.Desc.${item.type}`)}</p>` } },
      flags: { [MID]: { brokenItem: item.id } }
    });
  }
  if (creates.length) await actor.createEmbeddedDocuments("Item", creates);
}

/** Older name, kept for the other modules that call it. */
export const syncBrokenArmor = syncBroken;
