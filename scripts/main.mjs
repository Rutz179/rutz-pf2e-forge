import { MID, setting, t } from "./util.mjs";
import { PLUS } from "./edition.mjs";
import { blockDestroyed, ensureStats, syncBroken } from "./durability.mjs";

/** A broken-gear setting changed: every character's effects follow (each owner's client does its own). */
function resyncAll() {
  if (game.users.activeGM?.id !== game.user.id) return; // one client does it (two would each make an effect)
  for (const a of game.actors ?? []) if (a.type === "character") syncBroken(a);
}
import { installMarks } from "./marks.mjs";
import { openDurability } from "./ui/durability-app.mjs";
// @plus — wear in combat, the upkeep window, crafting projects (Plus edition)
import { installUpkeep, openUpkeep } from "./upkeep.mjs";
import { openWorkbench } from "./ui/workbench.mjs";
import { abandonProject, checkProject, clockMode, finishProject, projectsOf, startProject, workAll, workByClock, workDays } from "./crafting.mjs";
// @end-plus

/* ======================================================================== *
 * Rutz's PF2e Forge — item durability and crafting projects.
 * Opens from: the actor sheet header (내구도 · 제작대), the shop list's
 * 내구도 button (Rutz's PF2e Shop), the post-combat chat card, or
 * game.rutzForge.durability(actor) / .workbench(actor) / .upkeep().
 * ======================================================================== */

function registerSettings() {
  const s = (key, data) => game.settings.register(MID, key, { config: true, scope: "world", ...data });
  s("autoStats", { name: t("Settings.AutoStats"), hint: t("Settings.AutoStatsHint"), type: Boolean, default: true });
  s("sheetBars", { name: t("Settings.Bars"), hint: t("Settings.BarsHint"), type: String, default: "always",
    choices: { always: t("Settings.BarsAlways"), damaged: t("Settings.BarsDamaged"), off: t("Settings.BarsOff") } });
  s("notice", { name: t("Settings.Notice"), hint: t("Settings.NoticeHint"), type: Boolean, default: true });
  s("noticeTo", { name: t("Settings.NoticeTo"), hint: t("Settings.NoticeToHint"), type: String, default: "public",
    choices: { public: t("Settings.NoticePublic"), owners: t("Settings.NoticeOwners"), gm: t("Settings.NoticeGM") } });
  s("brokenArmor", { name: t("Settings.BrokenArmor"), hint: t("Settings.BrokenArmorHint"), type: Boolean, default: true });
  s("brokenRule", { name: t("Settings.BrokenRule"), hint: t("Settings.BrokenRuleHint"), type: String, default: "penalty",
    choices: { penalty: t("Settings.BrokenPenalty"), raw: t("Settings.BrokenRaw"), clumsy: t("Settings.BrokenClumsy") }, onChange: () => resyncAll() });
  s("brokenPenalty", { name: t("Settings.BrokenPenaltyN"), hint: t("Settings.BrokenPenaltyNHint"), type: Number, default: 1, range: { min: 1, max: 4, step: 1 }, onChange: () => resyncAll() });
  s("destroyedBlock", { name: t("Settings.Destroyed"), hint: t("Settings.DestroyedHint"), type: Boolean, default: true, onChange: () => resyncAll() });
  // @plus
  s("wearOn", { name: t("Settings.Wear"), hint: t("Settings.WearHint"), type: Boolean, default: true });
  s("wearMode", { name: t("Settings.WearMode"), hint: t("Settings.WearModeHint"), type: String, default: "events",
    choices: { events: t("Settings.WearEvents"), flat: t("Settings.WearFlat") } });
  s("wearTiming", { name: t("Settings.WearTiming"), hint: t("Settings.WearTimingHint"), type: String, default: "live",
    choices: { live: t("Settings.WearLive"), end: t("Settings.WearEnd") } });
  s("liveNotice", { name: t("Settings.LiveNotice"), hint: t("Settings.LiveNoticeHint"), type: String, default: "none",
    choices: { each: t("Settings.LiveEach"), broken: t("Settings.LiveBroken"), none: t("Settings.LiveNone") } });
  s("wearChance", { name: t("Settings.WearChance"), hint: t("Settings.WearChanceHint"), type: Number, default: 5, range: { min: 0, max: 100, step: 1 } });
  s("wearAmount", { name: t("Settings.WearAmount"), hint: t("Settings.WearAmountHint"), type: String, default: "1" });
  s("wearHardness", { name: t("Settings.WearHardness"), hint: t("Settings.WearHardnessHint"), type: Boolean, default: false });
  s("ammoRecover", { name: t("Settings.Ammo"), hint: t("Settings.AmmoHint"), type: Number, default: 50, range: { min: 0, max: 100, step: 5 } });
  s("ammoMagic", { name: t("Settings.AmmoMagic"), hint: t("Settings.AmmoMagicHint"), type: Boolean, default: false });
  s("upkeepPopup", { name: t("Settings.Upkeep"), hint: t("Settings.UpkeepHint"), type: String, default: "ask",
    choices: { ask: t("Settings.UpkeepAsk"), always: t("Settings.UpkeepAlways"), off: t("Settings.UpkeepOff") } });
  s("upkeepPublic", { name: t("Settings.UpkeepPublic"), hint: t("Settings.UpkeepPublicHint"), type: Boolean, default: true });
  s("craftClock", { name: t("Settings.CraftClock"), hint: t("Settings.CraftClockHint"), type: String, default: "auto",
    choices: { auto: t("Settings.ClockAuto"), plan: t("Settings.ClockPlan"), time: t("Settings.ClockTime"), manual: t("Settings.ClockManual") } });
  s("dailyRate", { name: t("Settings.DailyRate"), hint: t("Settings.DailyRateHint"), type: Number, default: 1, range: { min: 0.25, max: 5, step: 0.25 } });
  s("setupDays", { name: t("Settings.SetupDays"), hint: t("Settings.SetupDaysHint"), type: Number, default: -1, range: { min: -1, max: 30, step: 1 } });
  // @end-plus
}

function headerV1(sheet, buttons) {
  const actor = sheet.actor ?? sheet.document;
  if (!actor || !["character", "npc"].includes(actor.type) || !(actor.isOwner || game.user.isGM)) return;
  buttons.unshift({ label: t("Dur.Short"), class: "rpf-dur-open", icon: "fa-solid fa-shield-heart fa-fw", onclick: () => openDurability(actor) });
  // @plus
  if (actor.type === "character") buttons.unshift({ label: t("Craft.Short"), class: "rpf-bench-open", icon: "fa-solid fa-hammer fa-fw", onclick: () => openWorkbench(actor) });
  // @end-plus
}

function headerV2(app, controls) {
  const actor = app.document ?? app.actor;
  if (actor?.documentName !== "Actor" || !["character", "npc"].includes(actor.type) || !(actor.isOwner || game.user.isGM)) return;
  if (controls.some(c => c.action === "rpfDur")) return;
  app.options.actions ??= {};
  controls.unshift({ icon: "fa-solid fa-shield-heart fa-fw", label: t("Dur.Short"), action: "rpfDur", onClick: () => openDurability(actor) });
  app.options.actions.rpfDur ??= () => openDurability(actor);
  // @plus
  if (actor.type === "character") {
    controls.unshift({ icon: "fa-solid fa-hammer fa-fw", label: t("Craft.Short"), action: "rpfBench", onClick: () => openWorkbench(actor) });
    app.options.actions.rpfBench ??= () => openWorkbench(actor);
  }
  // @end-plus
}

Hooks.once("init", registerSettings);

Hooks.once("ready", () => {
  blockDestroyed();
  if (game.system.id !== "pf2e" && game.system.id !== "sf2e") return;
  installMarks();
  // @plus
  installUpkeep();
  // @end-plus
  Hooks.on("getActorSheetHeaderButtons", headerV1);
  Hooks.on("getHeaderControlsApplicationV2", headerV2);
  // New weapons and armor on a character get their material's Hit Points.
  Hooks.on("createItem", async (item, _o, userId) => {
    if (userId !== game.user.id || !setting("autoStats", true) || !["character", "npc", "familiar"].includes(item.actor?.type)) return;
    if (await ensureStats(item)) await syncBroken(item.actor);
  });
  game.rutzForge = { durability: openDurability, edition: PLUS ? "plus" : "lite" };
  // @plus
  // Whatever moved the clock (Days, the PF2e world clock, a calendar module), the workbench shows it.
  const benchRefresh = foundry.utils.debounce(() => foundry.applications.instances.get("rpf-workbench")?.render(), 150);
  Hooks.on("updateWorldTime", async () => { await workByClock(); benchRefresh(); });
  Hooks.on("updateActor", (actor, changes) => { if (foundry.utils.hasProperty(changes, `flags.${MID}`)) benchRefresh(); });
  Object.assign(game.rutzForge, {
    workbench: openWorkbench, upkeep: openUpkeep,
    projects: projectsOf, start: startProject, check: checkProject, work: workDays, workAll, finish: finishProject, abandon: abandonProject, clockMode
  });
  // @end-plus
  Hooks.callAll("rutzForgeReady", game.rutzForge);
  console.log(`${MID} | ready`);
});
