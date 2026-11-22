// Tests for what the card shows, built from real states (see fixtures.mjs).
// Run with: npm test   (sets TZ=Europe/Oslo so clock times are stable)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { hass, config, NOW, ext, sourcesConfig, objectsResponse } from "./fixtures.mjs";

function loadCard() {
  const src = readFileSync(new URL("../dist/home-tasks-card.js", import.meta.url), "utf8");
  const registry = new Map();
  const ctx = {
    HTMLElement: class {},
    customElements: { get: (n) => registry.get(n), define: (n, c) => registry.set(n, c) },
    console: { info() {}, warn() {}, log() {} },
    Date,
    Intl,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return registry.get("home-tasks-card")._internals;
}

const { buildModel, daysUntil, taskTitle, dueText, pickPersons, partsForTask, localDate, I18N } = loadCard();
const L = I18N.nb;
const model = buildModel(hass, config, NOW);
const ids = Array.from(model.items, (i) => i.id);

test("only due_soon, overdue and triggered tasks are shown", () => {
  assert.ok(!ids.includes("sensor.stue_stue_luftrenser_fyll_vanntanken"), "ok is hidden");
  assert.ok(!ids.includes("sensor.batteriflate_kjop_lr44_batteri"), "archived is hidden");
  assert.ok(!ids.includes("sensor.batteriflate_aa_batteri_stock"), "stock sensor is not a task");
});

test("excluded objects are hidden", () => {
  assert.ok(!ids.includes("sensor.motorsykkel_oljeskift"));
});

test("sort order: overdue first, then today, then by due date and priority", () => {
  assert.deepEqual(ids, [
    // overdue: no due date first (triggered), then by date
    "sensor.soverom_1_lexmark_c3326dw_bytt_blekk_eller_toner_cyan",
    "sensor.stue_xiaomi_smart_pet_food_feeder_bytt_filter",
    "sensor.torketrommel_rens_av_kondensator",
    // today: the washer (finished 40 min ago) before dated tasks
    "appliance:vaskemaskin",
    "sensor.soppel_innsamling_mat_farlig_avfall",
    "sensor.tommekalender_papp_papir",
    // soon
    "sensor.stue_vannfontene_rengjore_fontene_og_skylle_filter",
    "sensor.ecovent_rens_filter_sov_4",
  ]);
});

test("titles drop the device or object prefix", () => {
  const t = (id) => model.items.find((i) => i.id === id).title;
  assert.equal(t("sensor.tommekalender_papp_papir"), "Papp & papir");
  assert.equal(t("sensor.torketrommel_rens_av_kondensator"), "Rens av kondensator");
  // device name "Stue luftrenser" differs from the object "Luftrenser"
  assert.equal(
    taskTitle(hass, "sensor.stue_stue_luftrenser_fyll_vanntanken", hass.states["sensor.stue_stue_luftrenser_fyll_vanntanken"]),
    "Fyll vanntanken",
  );
  // registry name wins when present
  const h2 = { ...hass, entities: { ...hass.entities, "sensor.tommekalender_papp_papir": { platform: "maintenance_supporter", name: "Papir" } } };
  assert.equal(taskTitle(h2, "sensor.tommekalender_papp_papir", hass.states["sensor.tommekalender_papp_papir"]), "Papir");
});

test("due text in Norwegian", () => {
  const sub = (id) => model.items.find((i) => i.id === id).sub;
  assert.equal(sub("sensor.tommekalender_papp_papir"), "I dag");
  assert.equal(sub("sensor.stue_xiaomi_smart_pet_food_feeder_bytt_filter"), "Nå");
  assert.equal(sub("sensor.torketrommel_rens_av_kondensator"), "Forfalt for 3 dager siden");
  assert.equal(sub("sensor.stue_vannfontene_rengjore_fontene_og_skylle_filter"), "lørdag");
  assert.equal(sub("sensor.ecovent_rens_filter_sov_4"), "9. des.");
  assert.equal(sub("appliance:vaskemaskin"), "Ferdig kl. 11:50");
  assert.equal(dueText({ kind: "task", status: "due_soon", days: 1 }, NOW, L), "I morgen");
  assert.equal(dueText({ kind: "task", status: "overdue", days: -1 }, NOW, L), "Forfalt i går");
});

test("daysUntil counts local calendar days", () => {
  assert.equal(daysUntil("2026-11-19", NOW), 0);
  assert.equal(daysUntil("2026-11-20", NOW), 1);
  assert.equal(daysUntil("2026-11-18", NOW), -1);
  assert.equal(daysUntil(null, NOW), null);
});

test("assignees: responsible person, else everyone it is shared with", () => {
  const a = (id) => Array.from(model.items.find((i) => i.id === id).assignees);
  assert.deepEqual(a("sensor.soverom_1_lexmark_c3326dw_bytt_blekk_eller_toner_cyan"), ["person.anders"]);
  assert.deepEqual(a("sensor.tommekalender_papp_papir"), []);
  const h2 = structuredClone(hass);
  h2.states["sensor.tommekalender_papp_papir"].attributes.shared_with = ["person.david", "person.cecilie"];
  const m2 = buildModel(h2, config, NOW);
  assert.deepEqual(Array.from(m2.items.find((i) => i.id === "sensor.tommekalender_papp_papir").assignees), ["person.david", "person.cecilie"]);
});

test("finished washing machine is a to-do, red after overdue_after", () => {
  const w = model.items.find((i) => i.id === "appliance:vaskemaskin");
  assert.equal(w.title, "Tøm vaskemaskin");
  assert.equal(w.urgency, "today"); // finished 11:50, now 12:30: 40 min < 60
  assert.equal(w.action, null, "Home Connect clears itself when the door opens");
  const later = new Date(NOW.getTime() + 30 * 60000); // 70 min
  assert.equal(buildModel(hass, config, later).items.find((i) => i.id === "appliance:vaskemaskin").urgency, "overdue");
});

test("unavailable dryer shows nothing", () => {
  assert.ok(!ids.some((i) => i.includes("torketrommel") && i.startsWith("appliance")));
  assert.ok(!model.running.some((r) => r.name === "Tørketrommel"));
});

test("running dishwasher shows phase, finish time and progress", () => {
  const d = model.running.find((r) => r.name === "Oppvaskmaskin");
  assert.equal(d.phase, "Skyller");
  assert.equal(d.progress, 70);
  assert.equal(d.finishAt.getHours() * 60 + d.finishAt.getMinutes(), 12 * 60 + 30 + 35);
});

test("finished dishwasher becomes 'Tøm oppvaskmaskin' with the emptied action", () => {
  const h2 = structuredClone(hass);
  h2.states["binary_sensor.oppvaskmaskin_running"].state = "off";
  h2.states["input_select.oppvaskmaskin_status"].state = "Ferdig";
  const m2 = buildModel(h2, config, NOW);
  const d = m2.items.find((i) => i.id === "appliance:Oppvaskmaskin");
  assert.equal(d.title, "Tøm oppvaskmaskin");
  assert.equal(d.urgency, "today"); // 70 min < 720
  assert.equal(d.action.action, "input_select.select_option");
  assert.equal(m2.running.length, 0);
});

test("person picker uses the configured persons", () => {
  assert.deepEqual(
    pickPersons(hass, config).map((p) => p.name),
    ["Anders", "Berit", "Cecilie", "David"],
  );
  // default: everyone linked to a user, never pets
  const all = pickPersons(hass, {}).map((p) => p.id);
  assert.ok(all.includes("person.erik"));
  assert.ok(!all.includes("person.sylvester"));
});

test("empty house: no items, no running", () => {
  const m = buildModel({ states: {}, entities: {}, devices: {}, language: "nb" }, {}, NOW);
  assert.deepEqual([m.items.length, m.running.length], [0, 0]);
});

// ---- Calendars, to-do lists and dates

const full = buildModel(hass, { ...config, ...sourcesConfig }, NOW, ext);
const row = (id) => full.items.find((i) => i.id === id);
const plain = (v) => JSON.parse(JSON.stringify(v)); // arrays from the vm context are not deepEqual to ours

test("without fetched data the new sources add nothing, and tasks keep their order", () => {
  const m = buildModel(hass, { ...config, calendars: sourcesConfig.calendars, todo_lists: sourcesConfig.todo_lists }, NOW);
  assert.deepEqual(Array.from(m.items, (i) => i.id), ids);
});

test("calendar events: within days_ahead, finished ones gone, ongoing all-day today", () => {
  const ev = full.items.filter((i) => i.kind === "event").map((i) => [i.title, i.sub, i.object, i.urgency]);
  assert.deepEqual(plain(ev), [
    ["Høstferie", "I dag", "Familien", "today"],
    ["Foreldremøte", "I dag kl. 18:00", "Familien", "today"],
    ["Cecilie 12 år", "lørdag", "Bursdager", "soon"],
  ]);
});

test("an event that is happening now says so", () => {
  const at = new Date(2026, 10, 19, 18, 15);
  const m = buildModel(hass, { calendars: sourcesConfig.calendars }, at, ext);
  assert.equal(m.items.find((i) => i.title === "Foreldremøte").sub, "Nå");
});

test("to-do items: open only, overdue by due date, undated last, beyond days_ahead hidden", () => {
  const td = full.items.filter((i) => i.kind === "todo").map((i) => [i.title, i.urgency, i.sub]);
  assert.deepEqual(plain(td), [
    ["Rydd boden", "overdue", "Forfalt i går"],
    ["Bytt lyspære i gangen", "soon", ""],
  ]);
  assert.equal(row("todo:todo.husarbeid:t1").uid, "t1");
  const m = buildModel(hass, { todo_lists: [{ entity: "todo.husarbeid", show_undated: false }] }, NOW, ext);
  assert.deepEqual(plain(m.items.filter((i) => i.kind === "todo").map((i) => i.title)), ["Rydd boden", "Støvsug bilen"]);
});

test("dates: yearly birthday with age, a passed deadline is overdue, far ones hidden", () => {
  const b = row("date:input_datetime.berit_bursdag");
  assert.equal(b.title, "Berit har bursdag");
  assert.equal(b.sub, "I morgen, 40 år");
  assert.deepEqual(Array.from(b.assignees), ["person.berit"]);
  const eu = row("date:input_datetime.eu_kontroll");
  assert.equal(eu.title, "EU-kontroll");
  assert.equal(eu.urgency, "overdue");
  assert.equal(eu.sub, "Forfalt for 2 dager siden");
  assert.equal(row("date:sensor.neste_service"), undefined);
  // the birthday after it has passed this year: next year, a year older
  const later = new Date(2026, 10, 25);
  const m = buildModel(hass, { dates: [{ entity: "input_datetime.berit_bursdag", yearly: true, days_ahead: 400 }] }, later);
  const next = m.items.find((i) => i.kind === "date");
  assert.equal(next.due, "2027-11-20");
  assert.equal(next.age, 41);
});

test("everything sorts together: overdue, today (timed after untimed), soon (undated to-dos last)", () => {
  assert.deepEqual(Array.from(full.items, (i) => i.id), [
    "sensor.soverom_1_lexmark_c3326dw_bytt_blekk_eller_toner_cyan",
    "sensor.stue_xiaomi_smart_pet_food_feeder_bytt_filter",
    "sensor.torketrommel_rens_av_kondensator", // due 16 Nov
    "date:input_datetime.eu_kontroll", // 17 Nov
    "todo:todo.husarbeid:t2",
    "appliance:vaskemaskin",
    "event:calendar.familie:f3:2026-11-16",
    "sensor.soppel_innsamling_mat_farlig_avfall",
    "sensor.tommekalender_papp_papir",
    "event:calendar.familie:f1:2026-11-19T18:00:00+01:00",
    "date:input_datetime.berit_bursdag",
    "event:calendar.bursdager:b1:20261121", // 21 Nov, "Cecilie" before "Rengjøre"
    "sensor.stue_vannfontene_rengjore_fontene_og_skylle_filter",
    "sensor.ecovent_rens_filter_sov_4",
    "todo:todo.husarbeid:t1",
  ]);
});

test("localDate reads dates, naive datetimes and timestamps", () => {
  assert.equal(localDate("2026-11-19"), "2026-11-19");
  assert.equal(localDate("2026-11-19 23:30:00"), "2026-11-19");
  assert.equal(localDate("2026-11-19T23:30:00+00:00"), "2026-11-20"); // 00:30 in Oslo
  assert.equal(localDate("10:00:00"), null);
  assert.equal(localDate("unknown"), null);
});

// ---- Spare parts in the done dialog

test("parts a completion books, resolved on the owning object", () => {
  const p = partsForTask(objectsResponse, "sensor.stue_xiaomi_smart_pet_food_feeder_bytt_filter");
  assert.deepEqual(JSON.parse(JSON.stringify(p)), [
    { name: "Xiaomi filter", quantity: 1, unit: "", stock: 3 },
    { name: "Tørkemiddel", quantity: 2, unit: "poser", stock: 7.5 },
  ]);
  assert.deepEqual(Array.from(partsForTask(objectsResponse, "sensor.lager_tork")), []);
  assert.deepEqual(Array.from(partsForTask(objectsResponse, "sensor.ukjent")), []);
  assert.deepEqual(Array.from(partsForTask(undefined, "sensor.ukjent")), []);
});
