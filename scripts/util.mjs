export const MID = "rutz-pf2e-forge";

export function t(key, data) {
  const k = `RPF.${key}`;
  return data ? game.i18n.format(k, data) : game.i18n.localize(k);
}
export function esc(v) {
  return foundry.utils.escapeHTML(String(v ?? ""));
}
export function setting(key, fallback = null) {
  try { return game.settings.get(MID, key); } catch (_) { return fallback; }
}
export function sourceIdOf(item) {
  return item?._stats?.compendiumSource ?? item?.flags?.core?.sourceId ?? null;
}
export function enrich(html, options = {}) {
  const Editor = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  return Editor.enrichHTML(html ?? "", options).catch(() => html ?? "");
}
export function randomId() {
  return foundry.utils.randomID();
}

/* ---------------- money ---------------- */

const RATE = { pp: 1000, gp: 100, sp: 10, cp: 1 };
export function coinsToCp(c) {
  let n = 0;
  for (const [d, r] of Object.entries(RATE)) n += (Number(c?.[d]) || 0) * r;
  return n;
}
export function cpToCoins(cp) {
  const n = Math.max(0, Math.round(cp));
  return { gp: Math.floor(n / 100), sp: Math.floor((n % 100) / 10), cp: n % 10 };
}
export function formatCp(cp) {
  const c = cpToCoins(cp);
  const parts = ["gp", "sp", "cp"].filter(d => c[d]).map(d => `${c[d].toLocaleString()} ${d}`);
  return parts.join(" ") || "0 cp";
}
export function priceCp(item, qty = 1) {
  const v = item?.price?.value;
  const per = Number(item?.price?.per ?? item?.system?.price?.per ?? 1) || 1;
  const cp = v && typeof v.copperValue === "number" ? v.copperValue : coinsToCp(item?.system?.price?.value ?? {});
  return Math.round((cp * qty) / per);
}
export function walletCp(actor) {
  const c = actor?.inventory?.coins ?? actor?.inventory?.currency;
  return c && typeof c.copperValue === "number" ? c.copperValue : coinsToCp(c ?? {});
}

/** Pay copper: small coins first, a bigger coin broken when needed (platinum too). */
export async function pay(actor, cp) {
  cp = Math.round(cp);
  if (cp <= 0) return true;
  if (walletCp(actor) < cp) return false;
  const c = actor.inventory?.currency ?? actor.inventory?.coins ?? {};
  const have = { cp: Number(c.cp) || 0, sp: Number(c.sp) || 0, gp: Number(c.gp) || 0, pp: Number(c.pp) || 0 };
  let left = cp;
  const remove = { cp: 0, sp: 0, gp: 0, pp: 0 };
  for (const d of ["cp", "sp", "gp", "pp"]) { const use = Math.min(have[d], Math.floor(left / RATE[d])); remove[d] = use; left -= use * RATE[d]; }
  let change = 0;
  if (left > 0) {
    const d = ["cp", "sp", "gp", "pp"].find(x => have[x] - remove[x] > 0 && RATE[x] > left);
    if (!d) return actor.inventory.removeCoins({ cp }, { byValue: true });
    remove[d]++;
    change = RATE[d] - left;
  }
  const ok = await actor.inventory.removeCoins(Object.fromEntries(Object.entries(remove).filter(([, n]) => n)), { byValue: false });
  if (!ok) return actor.inventory.removeCoins({ cp }, { byValue: true });
  if (change) await actor.inventory.addCoins(cpToCoins(change));
  return true;
}

/* ---------------- PF2e tables ---------------- */

// Level-based DCs (GM Core table 10-5), level 0–25.
const DC_BY_LEVEL = [14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50];
const RARITY_ADJ = { common: 0, uncommon: 2, rare: 5, unique: 10 };
export function levelDC(level, rarity = "common") {
  return DC_BY_LEVEL[Math.max(0, Math.min(25, Number(level) || 0))] + (RARITY_ADJ[rarity] ?? 0);
}

// Earn Income (Player Core table 4-2), per day in copper: [failure, trained, expert, master, legendary]; 21 = level 20 critical success.
const G = 100, S = 10;
export const INCOME = {
  0: [1, 5, 5, 5, 5], 1: [2, 2 * S, 2 * S, 2 * S, 2 * S], 2: [4, 3 * S, 3 * S, 3 * S, 3 * S], 3: [8, 5 * S, 5 * S, 5 * S, 5 * S],
  4: [S, 7 * S, 8 * S, 8 * S, 8 * S], 5: [2 * S, 9 * S, G, G, G], 6: [3 * S, 15 * S, 2 * G, 2 * G, 2 * G], 7: [4 * S, 2 * G, 25 * S, 25 * S, 25 * S],
  8: [5 * S, 25 * S, 3 * G, 3 * G, 3 * G], 9: [6 * S, 3 * G, 4 * G, 4 * G, 4 * G], 10: [7 * S, 4 * G, 5 * G, 6 * G, 6 * G], 11: [8 * S, 5 * G, 6 * G, 8 * G, 8 * G],
  12: [9 * S, 6 * G, 8 * G, 10 * G, 10 * G], 13: [G, 7 * G, 10 * G, 15 * G, 15 * G], 14: [15 * S, 8 * G, 15 * G, 20 * G, 20 * G], 15: [2 * G, 10 * G, 20 * G, 28 * G, 28 * G],
  16: [25 * S, 13 * G, 25 * G, 36 * G, 40 * G], 17: [3 * G, 15 * G, 30 * G, 45 * G, 55 * G], 18: [4 * G, 20 * G, 45 * G, 70 * G, 90 * G],
  19: [6 * G, 30 * G, 60 * G, 100 * G, 130 * G], 20: [8 * G, 40 * G, 75 * G, 150 * G, 200 * G], 21: [0, 50 * G, 90 * G, 175 * G, 300 * G]
};
export function incomePerDay(level, rank, critical = false) {
  const row = INCOME[Math.max(0, Math.min(21, (Number(level) || 0) + (critical ? 1 : 0)))];
  return row?.[Math.max(1, Math.min(4, Number(rank) || 1))] ?? 0;
}

/** Who sees durability messages (setting): everyone, the owners and the GM, or the GM only. */
export function whisperFor(actor) {
  const mode = setting("noticeTo", "public");
  if (mode === "public") return [];
  return game.users.filter(u => u.isGM || (mode === "owners" && actor?.testUserPermission(u, "OWNER"))).map(u => u.id);
}
