import { esc, levelDC, t, whisperFor } from "../util.mjs";
import { MATERIALS, damageItem, ensureStats, guessMaterial, healItem, hpOf, repairAmount, setHp, setMaterial, stateLabel, stateOf, statsFor, syncBroken } from "../durability.mjs";

/* ======================================================================== *
 * 내구도 창 — for players (their own characters) and the GM (everyone).
 *   everyone: give gear its material's Hit Points, Repair (a Crafting check
 *             against the item's level DC; the result is applied)
 *   GM:       damage through Hardness, set a material, heal, repair fully
 * ======================================================================== */

export class DurabilityApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "rpf-durability",
    classes: ["rpf-app", "rpf-durability"],
    window: { title: "RPF.Dur.Title", icon: "fa-solid fa-shield-heart", resizable: true },
    position: { width: 780, height: 600 }
  };

  constructor(actor = null, focus = null) {
    super();
    const sel = actor ?? canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character;
    this.actorId = sel?.id ?? this.actors()[0]?.id ?? null;
    this.focus = focus;
    this.showAll = false;
  }

  actors() {
    return game.actors.filter(a => ["character", "npc", "familiar"].includes(a.type) && (game.user.isGM ? (a.hasPlayerOwner || a.type === "npc") : a.isOwner))
      .sort((a, b) => (b.hasPlayerOwner - a.hasPlayerOwner) || a.name.localeCompare(b.name, game.i18n.lang));
  }

  get target() { return game.actors.get(this.actorId) ?? null; }

  async _renderHTML() {
    const gm = game.user.isGM;
    const a = this.target;
    const editable = gm || a?.isOwner;
    const crafters = game.actors.filter(x => x.type === "character" && (gm || x.isOwner));
    const repairer = game.actors.get(this.repairerId) ?? (a?.type === "character" ? a : crafters[0]) ?? null;
    this.repairerId = repairer?.id ?? null;
    const rank = repairer?.skills?.crafting?.rank ?? 0;
    const items = (a?.items ?? []).filter(i => ["weapon", "armor", "shield"].includes(i.type) || (this.showAll && hpOf(i).max > 0))
      .sort((x, y) => ["armor", "shield", "weapon"].indexOf(x.type) - ["armor", "shield", "weapon"].indexOf(y.type) || x.name.localeCompare(y.name, game.i18n.lang));
    const mats = Object.keys(MATERIALS);
    const rows = items.map(i => {
      const h = hpOf(i);
      const st = stateOf(i);
      const pct = h.max ? Math.round((h.value / h.max) * 100) : 0;
      const dc = levelDC(i.system?.level?.value ?? 0, i.system?.traits?.rarity);
      const mat = i.system?.material?.type;
      return `<div class="rpf-dur ${st} ${this.focus === i.id ? "focus" : ""}" data-id="${i.id}"><img src="${esc(i.img)}" alt="">
        <div class="nm"><b>${esc(i.name)}</b>${i.isEquipped ? ` <i class="fa-solid fa-shirt" data-tooltip="${esc(t("Dur.Equipped"))}"></i>` : ""}
          ${mat ? `<span class="mat">${esc(game.i18n.localize(CONFIG.PF2E?.preciousMaterials?.[mat] ?? mat))}</span>` : ""}
          ${h.max ? `<div class="hpbar ${editable ? "set" : ""}" ${editable ? `data-a="bar" data-tooltip="${esc(t("Dur.BarHint"))}"` : ""}><i style="width:${pct}%"></i><b style="left:${Math.round((h.bt / h.max) * 100)}%"></b><span>HP ${h.value} / ${h.max}</span></div>
            <div class="facts"><span class="st">${esc(stateLabel(st))}</span> · BT ${h.bt} · ${t("Hardness")} ${h.hardness} · ${t("Dur.RepairDC", { dc })}</div>`
          : `<div class="facts rpf-dim">${t("Dur.NoHp")}</div>`}</div>
        <div class="acts">
          ${!h.max && editable ? `<button type="button" data-a="give" data-tooltip="${esc(t("Dur.GiveHint"))}"><i class="fa-solid fa-wand-magic"></i> ${t("Dur.Give", { h: statsFor(i)?.[0] ?? "?", hp: statsFor(i)?.[1] ?? "?" })}</button>` : ""}
          ${h.max && editable && st !== "destroyed" && h.value < h.max ? `<button type="button" class="primary" data-a="repair" data-tooltip="${esc(t("Dur.RepairHint", { n: repairAmount(rank), c: repairAmount(rank, true), dc }))}"><i class="fa-solid fa-screwdriver-wrench"></i> ${t("Dur.Repair")}</button>` : ""}
          ${gm ? `<div class="gmrow">
            <select data-a="mat" data-tooltip="${esc(t("Dur.MaterialHint"))}"><option value="">${t("Dur.Material")}</option>${mats.map(m => `<option value="${m}">${guessMaterial(i) === m ? "★ " : ""}${t(`Mat.${m}`)} (${MATERIALS[m].join("/")})</option>`).join("")}</select>
            <input type="number" min="0" placeholder="${esc(t("Dur.Damage"))}" class="n dmg"><button type="button" data-a="hit" data-tooltip="${esc(t("Dur.HitHint"))}"><i class="fa-solid fa-burst"></i></button>
            <button type="button" data-a="fix" data-r="full" data-tooltip="${esc(t("Dur.FixFull"))}" ${st === "destroyed" || !h.max ? "disabled" : ""}><i class="fa-solid fa-hammer"></i></button></div>` : ""}
        </div></div>`;
    }).join("");
    return `<div class="rpf-durapp">
      <div class="row"><select data-a="actor">${this.actors().map(x => `<option value="${x.id}" ${x.id === this.actorId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
        <label class="inline"><input type="checkbox" data-a="all" ${this.showAll ? "checked" : ""}> ${t("Dur.ShowAll")}</label>
        <span class="sep"></span>
        <label class="inline">${t("Dur.Repairer")} <select data-a="repairer">${crafters.map(x => `<option value="${x.id}" ${x.id === this.repairerId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
          <span class="rpf-dim">${t("Dur.Crafter", { rank: game.i18n.localize(`PF2E.ProficiencyLevel${rank}`) })}</span></label>
        ${a && editable ? `<button type="button" data-a="give-all"><i class="fa-solid fa-wand-magic-sparkles"></i> ${t("Dur.GiveAll")}</button>` : ""}</div>
      <p class="rpf-hint">${t("Dur.Hint")}</p>
      <div class="list">${rows || `<p class="rpf-empty">${t("Dur.Nothing")}</p>`}</div></div>`;
  }

  _replaceHTML(result, content) {
    const top = content.querySelector(".list")?.scrollTop ?? 0;
    content.innerHTML = result;
    const list = content.querySelector(".list");
    if (list) list.scrollTop = this.focus && !top ? (content.querySelector(".rpf-dur.focus")?.offsetTop ?? 0) - 40 : top;
    if (this._wired === content) return;
    this._wired = content;
    content.addEventListener("click", ev => this.onClick(ev));
    content.addEventListener("change", ev => this.onChange(ev));
  }

  async say(text) {
    const a = this.target;
    const whisper = whisperFor(a);
    await ChatMessage.create({ content: `<div class="rpf-card dur"><header><i class="fa-solid fa-shield-heart"></i> <b>${t("Dur.Title")}</b></header><p>${text}</p></div>`, whisper });
  }

  async onClick(ev) {
    const el = ev.target.closest("[data-a]");
    if (!el || el.tagName === "SELECT" || el.tagName === "INPUT" || el.tagName === "SUMMARY") return;
    ev.preventDefault();
    const a = this.target;
    if (el.dataset.a === "give-all") {
      let n = 0;
      for (const i of a?.items ?? []) if (await ensureStats(i)) n++;
      ui.notifications.info(t("Dur.GaveAll", { n }));
      return this.render();
    }
    const row = el.closest("[data-id]");
    const item = a?.items.get(row?.dataset.id);
    if (!item) return;
    switch (el.dataset.a) {
      case "bar": {
        // Click the bar, type the Hit Points, Enter (Esc cancels).
        if (!hpOf(item).max || ev.target.tagName === "INPUT" || el.querySelector("input")) return;
        const h = hpOf(item);
        const input = document.createElement("input");
        Object.assign(input, { type: "number", min: 0, max: h.max, value: h.value, className: "hpin" });
        el.querySelector("span")?.replaceChildren(input, document.createTextNode(` / ${h.max}`));
        input.focus();
        input.select();
        let done = false;
        const save = async () => {
          if (done) return;
          done = true;
          const value = Math.max(0, Math.min(h.max, Math.round(Number(input.value))));
          if (Number.isFinite(value) && value !== h.value) {
            await setHp(item, value, { quiet: true });
            await this.say(t("Dur.SaidSet", { item: esc(item.name), from: h.value, to: hpOf(item).value, max: h.max, state: stateLabel(stateOf(item)) }));
            await syncBroken(a);
          }
          this.render();
        };
        input.addEventListener("keydown", e => {
          if (e.key === "Enter") { e.preventDefault(); save(); }
          if (e.key === "Escape") { e.preventDefault(); done = true; this.render(); }
        });
        input.addEventListener("blur", save);
        return;
      }
      case "give": await ensureStats(item); break;
      case "repair": await this.repair(item); break;
      case "hit": {
        const amount = Number(row.querySelector(".dmg")?.value) || 0;
        if (!amount) return;
        const { taken, state } = await damageItem(item, amount, { quiet: true });
        await this.say(t("Dur.SaidHit", { item: esc(item.name), amount, taken, state: stateLabel(state) }));
        break;
      }
      case "fix":
        if (await healItem(item, null)) await this.say(t("Dur.SaidFix", { item: esc(item.name), hp: `${hpOf(item).value}/${hpOf(item).max}`, state: stateLabel(stateOf(item)) }));
        break;
    }
    await syncBroken(a);
    this.render();
  }

  /** Repair: a Crafting check against the item's level DC (Player Core p. 236), applied. */
  async repair(item) {
    const who = game.actors.get(this.repairerId);
    const stat = who?.skills?.crafting;
    if (!stat) return ui.notifications.warn(t("Dur.NoRepairer"));
    const dc = levelDC(item.system?.level?.value ?? 0, item.system?.traits?.rarity);
    const roll = await stat.roll({ dc: { value: dc }, extraRollOptions: ["action:repair"], label: `${t("Dur.Repair")}: ${item.name}` }).catch(() => null);
    const degree = roll?.degreeOfSuccess ?? roll?.options?.degreeOfSuccess;
    if (degree === undefined || degree === null) return;
    const rank = stat.rank ?? 0;
    // Repair takes 10 minutes (Player Core, Repair): the others are asked what they do meanwhile (Rutz's PF2e Days).
    game.rutzDays?.declare?.({ actor: who, minutes: 10, label: t("Dur.RepairTime", { item: item.name }) });
    if (degree >= 2) {
      const n = repairAmount(rank, degree === 3);
      await healItem(item, n);
      await this.say(t("Dur.SaidRepair", { who: esc(who.name), item: esc(item.name), n, hp: `${hpOf(item).value}/${hpOf(item).max}` }));
    } else if (degree === 0) {
      const r = await new Roll("2d6").evaluate();
      const { taken, state } = await damageItem(item, r.total);
      await this.say(t("Dur.SaidCritFail", { item: esc(item.name), roll: r.total, taken, state: stateLabel(state) }));
    } else await this.say(t("Dur.SaidFail", { who: esc(who.name), item: esc(item.name) }));
  }

  async onChange(ev) {
    const el = ev.target;
    if (el.dataset.a === "actor") { this.actorId = el.value; this.focus = null; return this.render(); }
    if (el.dataset.a === "repairer") { this.repairerId = el.value; return this.render(); }
    if (el.dataset.a === "all") { this.showAll = el.checked; return this.render(); }
    if (el.dataset.a === "mat" && el.value) {
      const item = this.target?.items.get(el.closest("[data-id]")?.dataset.id);
      if (!item) return;
      await setMaterial(item, el.value);
      await syncBroken(this.target);
      this.render();
    }
  }
}

export function openDurability(actor = null, focus = null) {
  const open = foundry.applications.instances.get("rpf-durability");
  if (open) {
    if (actor) { open.actorId = actor.id; open.focus = focus; }
    open.render(true);
    return open;
  }
  const app = new DurabilityApp(actor, focus);
  app.render(true);
  return app;
}
