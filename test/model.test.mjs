// Tests for what the card shows, built from real states (see fixtures.mjs).
// Run with: npm test   (sets TZ=Europe/Oslo so clock times are stable)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { hass, config, NOW } from "./fixtures.mjs";

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

const { buildModel, daysUntil, taskTitle, dueText, pickPersons, I18N } = loadCard();
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
