import { enrich, esc, formatCp, t, walletCp } from "../util.mjs";
import { abandonProject, checkProject, daysLeft, finishProject, preview, projectsOf, remainingCp, startProject, workDays } from "../crafting.mjs";

/* ======================================================================== *
 * 제작대 — a character's crafting projects, and new ones.
 *   left:  projects with a bar (materials + work vs. the Price), +1 day,
 *          + N days, finish now (pay the rest), give up
 *   right: a new project — from the formula book, or an item dropped here;
 *          price, materials, DC, daily progress, days to finish for free
 * ======================================================================== */

/** Where the days of work come from (setting), said under the plan. */
function clockHint() {
  let mode = game.settings.get("rutz-pf2e-forge", "craftClock");
  if (mode === "auto") mode = game.modules.get("rutz-pf2e-days")?.active ? "plan" : "time";
  return `<p class="rpf-hint"><i class="fa-solid fa-clock"></i> ${t(`Craft.Clock.${mode}`)}</p>`;
}

export class Workbench extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "rpf-workbench",
    classes: ["rpf-app", "rpf-workbench"],
    window: { title: "RPF.Craft.Bench", icon: "fa-solid fa-hammer", resizable: true },
    position: { width: 900, height: 620 }
  };

  constructor(actor = null) {
    super();
    const a = actor ?? canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character;
    this.actorId = a?.type === "character" ? a.id : this.actors()[0]?.id ?? null;
    this.ui = { search: "", pick: null, qty: 1, days: 1 };
  }

  actors() {
    return game.actors.filter(a => a.type === "character" && (a.isOwner || game.user.isGM) && (game.user.isGM ? a.hasPlayerOwner || a.isOwner : true));
  }
  get actor() { return game.actors.get(this.actorId) ?? null; }

  async formulas() {
    const list = [];
    for (const f of this.actor?.system?.crafting?.formulas ?? []) {
      const doc = await fromUuid(f.uuid).catch(() => null);
      if (doc) list.push(doc);
    }
    return list.sort((a, b) => (a.system?.level?.value ?? 0) - (b.system?.level?.value ?? 0) || a.name.localeCompare(b.name, game.i18n.lang));
  }

  async _renderHTML() {
    const a = this.actor;
    const projects = projectsOf(a).filter(p => p.active);
    const n = this.ui.days;
    const dayButtons = `<button type="button" data-a="day" data-n="1">+1${t("Craft.Day")}</button>${n > 1 ? `<button type="button" data-a="day" data-n="${n}">+${n}${t("Craft.Day")}</button>` : ""}`;
    const pRows = projects.map(p => {
      const phase = p.phase ?? "work";
      const done = phase === "work" ? p.materials + p.progress : 0;
      const pct = phase === "work" ? Math.round((done / Math.max(1, p.price)) * 100) : Math.round((((p.setupDays ?? 0) - (p.setupLeft ?? 0)) / Math.max(1, p.setupDays ?? 1)) * 100);
      const left = remainingCp(p);
      const bar = phase === "work" ? `${formatCp(done)} / ${formatCp(p.price)}` : phase === "setup" ? t("Craft.SetupBar", { done: (p.setupDays ?? 0) - (p.setupLeft ?? 0), all: p.setupDays ?? 0 }) : t("Craft.CheckBar", { dc: p.dc });
      const facts = phase === "work" ? t("Craft.Facts", { days: p.days, per: formatCp(p.perDay), left: formatCp(left), free: daysLeft(p) })
        : phase === "setup" ? t("Craft.FactsSetup", { n: p.setupLeft ?? 0, materials: formatCp(p.materials) }) : t("Craft.FactsCheck", { materials: formatCp(p.materials) });
      const acts = phase === "check"
        ? `<button type="button" class="primary" data-a="check" ${walletCp(a) < p.materials ? "disabled" : ""}><i class="fa-solid fa-dice-d20"></i> ${t("Craft.Check", { dc: p.dc })}</button>`
        : `${dayButtons}${phase === "work" ? `<button type="button" class="primary" data-a="finish" ${walletCp(a) < left ? "disabled" : ""} data-tooltip="${esc(t("Craft.FinishHint"))}"><i class="fa-solid fa-check"></i> ${t("Craft.Finish", { cost: formatCp(left) })}</button>` : ""}`;
      return `<div class="rpf-proj ${phase}" data-id="${p.id}"><img src="${esc(p.img)}" alt="">
        <div class="nm"><b>${esc(p.name)}</b> <span class="phase">${t(`Craft.Phase.${phase}`)}</span>${p.critical ? ` <span class="crit">${t("Craft.Crit")}</span>` : ""}
          <div class="hpbar"><i style="width:${pct}%"></i><span>${esc(bar)}</span></div>
          <div class="facts">${facts}</div>
          <div class="acts">${acts}<button type="button" data-a="abandon" data-tooltip="${esc(t("Craft.Abandon"))}"><i class="fa-solid fa-xmark"></i></button></div></div></div>`;
    }).join("");
    const forms = await this.formulas();
    const words = this.ui.search.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = forms.filter(d => words.every(w => d.name.toLowerCase().includes(w)));
    const pick = this.ui.pick ? await fromUuid(this.ui.pick).catch(() => null) : null;
    let pickHtml = `<p class="rpf-dim">${t("Craft.PickHint")}</p>`;
    if (pick && a) {
      const pv = preview(a, pick, this.ui.qty);
      const desc = await enrich(pick.system?.description?.value ?? "", { relativeTo: pick });
      pickHtml = `<header><img src="${esc(pick.img)}" alt=""><div><h3>${esc(pick.name)}</h3><small>${t("Craft.Level", { n: pv.level })} · DC ${pv.dc}</small></div></header>
        <div class="facts big"><div><span>${t("Craft.Price")}</span><b>${formatCp(pv.price)}</b></div><div><span>${t("Craft.Materials")}</span><b>${formatCp(pv.materials)}</b></div>
          <div><span>${t("Craft.PerDay")}</span><b>${formatCp(pv.perDay)}</b><small>${t("Craft.CritPer", { n: formatCp(pv.perDayCrit) })}</small></div>
          <div><span>${t("Craft.FreeIn")}</span><b>${pv.perDay ? Math.ceil((pv.price - pv.materials) / pv.perDay) : "—"}${t("Craft.Day")}</b></div></div>
        ${pv.problems.length ? `<ul class="warn">${pv.problems.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        <p class="rpf-hint">${t("Craft.SetupHint", { n: pv.setupDays })}</p>
        ${clockHint()}
        <div class="row"><label class="inline">${t("Craft.Qty")} <input type="number" min="1" value="${this.ui.qty}" data-a="qty" class="n"></label>
          <button type="button" class="primary" data-a="start" ${walletCp(a) < pv.materials ? "disabled" : ""}><i class="fa-solid fa-hammer"></i> ${t(pv.setupDays ? "Craft.StartSetup" : "Craft.Start", { dc: pv.dc, n: pv.setupDays })}</button></div>
        <div class="desc">${desc}</div>`;
    }
    return `<div class="rpf-bench">
      <div class="row"><select data-a="actor">${this.actors().map(x => `<option value="${x.id}" ${x.id === this.actorId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
        <span class="rpf-dim">${a ? t("Craft.Rank", { rank: game.i18n.localize(`PF2E.ProficiencyLevel${a.skills?.crafting?.rank ?? 0}`), money: formatCp(walletCp(a)) }) : ""}</span>
        <span class="sep"></span><label class="inline">${t("Craft.DaysStep")} <input type="number" min="1" value="${this.ui.days}" data-a="days" class="n"></label></div>
      <div class="cols">
        <section><h4>${t("Craft.Projects")}</h4>${pRows || `<p class="rpf-empty">${t("Craft.NoProjects")}</p>`}
          <h4>${t("Craft.Formulas")}</h4><input type="search" data-a="search" value="${esc(this.ui.search)}" placeholder="${esc(t("Craft.Search"))}">
          <div class="flist">${shown.map(d => `<button type="button" class="${this.ui.pick === d.uuid ? "on" : ""}" data-a="pick" data-uuid="${esc(d.uuid)}"><span class="lv">${d.system?.level?.value ?? 0}</span><img src="${esc(d.img)}" alt=""><span>${esc(d.name)}</span></button>`).join("") || `<p class="rpf-dim">${t("Craft.NoFormulas")}</p>`}</div></section>
        <section class="pick">${pickHtml}</section></div>
      <p class="rpf-drop"><i class="fa-solid fa-hand-pointer"></i> ${t("Craft.Drop")}</p></div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    if (this._wired === content) return;
    this._wired = content;
    content.addEventListener("click", ev => this.onClick(ev));
    content.addEventListener("change", ev => this.onChange(ev));
    const typed = ev => {
      if (ev.isComposing || ev.target.dataset.a !== "search") return; // Korean IME: wait for the syllable
      this.ui.search = ev.target.value;
      clearTimeout(this._typing);
      this._typing = setTimeout(async () => { await this.render(); const b = this.element.querySelector('[data-a="search"]'); b?.focus(); b?.setSelectionRange(b.value.length, b.value.length); }, 200);
    };
    content.addEventListener("input", typed);
    content.addEventListener("compositionend", typed);
    content.addEventListener("dragover", ev => ev.preventDefault());
    content.addEventListener("drop", async ev => {
      ev.preventDefault();
      const Editor = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
      const data = Editor.getDragEventData(ev);
      const doc = data?.uuid ? await fromUuid(data.uuid).catch(() => null) : null;
      if (doc?.documentName === "Item") { this.ui.pick = doc.uuid; this.ui.qty = 1; this.render(); }
    });
  }

  async onClick(ev) {
    const el = ev.target.closest("[data-a]");
    if (!el || el.tagName === "INPUT" || el.tagName === "SELECT") return;
    ev.preventDefault();
    const a = this.actor;
    const id = el.closest("[data-id]")?.dataset.id;
    switch (el.dataset.a) {
      case "pick": this.ui.pick = el.dataset.uuid; this.ui.qty = 1; return this.render();
      case "start": {
        const doc = await fromUuid(this.ui.pick).catch(() => null);
        if (doc && a) await startProject(a, doc, this.ui.qty);
        return this.render();
      }
      case "day": await workDays(a, id, Number(el.dataset.n) || 1); return this.render();
      case "check": await checkProject(a, id); return this.render();
      case "finish": await finishProject(a, id); return this.render();
      case "abandon": {
        const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: t("Craft.Abandon") }, content: `<p>${t("Craft.AbandonAsk")}</p>`, rejectClose: false }).catch(() => false);
        if (ok) await abandonProject(a, id);
        return this.render();
      }
    }
  }

  onChange(ev) {
    const el = ev.target;
    if (el.dataset.a === "actor") { this.actorId = el.value; this.ui.pick = null; return this.render(); }
    if (el.dataset.a === "qty") { this.ui.qty = Math.max(1, Number(el.value) || 1); return this.render(); }
    if (el.dataset.a === "days") { this.ui.days = Math.max(1, Number(el.value) || 1); return this.render(); }
  }
}

export function openWorkbench(actor = null) {
  const open = foundry.applications.instances.get("rpf-workbench");
  if (open) { if (actor) { open.actorId = actor.id; } open.render(true); return open; }
  const app = new Workbench(actor);
  app.render(true);
  return app;
}
