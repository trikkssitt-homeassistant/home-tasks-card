// A trimmed copy of real states from a real Home Assistant (2026-11-19), with people renamed.
// Entity IDs, names and attribute shapes are as Maintenance Supporter and Home Connect report them.

const ms = (entity_id, state, a) => ({
  entity_id,
  state,
  last_changed: "2026-11-19T08:00:00+01:00",
  attributes: { maintenance_type: "custom", schedule_type: "time_based", priority: "normal", shared_with: [], responsible_user: null, next_due: null, days_until_due: null, ...a },
});

export const NOW = new Date(2026, 10, 19, 12, 30); // Thu 19 Nov 2026 12:30 local

export const states = {
  "sensor.tommekalender_papp_papir": ms("sensor.tommekalender_papp_papir", "due_soon", {
    friendly_name: "Tømmekalender Papp & papir", parent_object: "Tømmekalender", next_due: "2026-11-19", days_until_due: 0, icon: "phu:garbage-cardboard",
  }),
  "sensor.soppel_innsamling_mat_farlig_avfall": ms("sensor.soppel_innsamling_mat_farlig_avfall", "due_soon", {
    friendly_name: "Tømmekalender Mat / Farlig avfall", parent_object: "Tømmekalender", schedule_type: "weekdays", next_due: "2026-11-19", days_until_due: 0,
  }),
  "sensor.stue_xiaomi_smart_pet_food_feeder_bytt_filter": ms("sensor.stue_xiaomi_smart_pet_food_feeder_bytt_filter", "triggered", {
    friendly_name: "Xiaomi Smart Pet Food Feeder Bytt filter", parent_object: "Smart Pet Food Feeder", maintenance_type: "replacement", schedule_type: "sensor_based",
  }),
  "sensor.soverom_1_lexmark_c3326dw_bytt_blekk_eller_toner_cyan": ms("sensor.soverom_1_lexmark_c3326dw_bytt_blekk_eller_toner_cyan", "triggered", {
    friendly_name: "Lexmark C3326dw Bytt blekk eller toner — Cyan", parent_object: "Printer", maintenance_type: "replacement", schedule_type: "sensor_based",
    responsible_user: "person.anders", shared_with: [],
  }),
  "sensor.stue_vannfontene_rengjore_fontene_og_skylle_filter": ms("sensor.stue_vannfontene_rengjore_fontene_og_skylle_filter", "due_soon", {
    friendly_name: "Vannfontene Rengjøre fontene og skylle filter", parent_object: "Vannfontene", schedule_type: "weekdays", next_due: "2026-11-21", days_until_due: 2,
    responsible_user: "person.anders", shared_with: ["person.anders", "person.berit", "person.cecilie", "person.david"],
  }),
  "sensor.torketrommel_rens_av_kondensator": ms("sensor.torketrommel_rens_av_kondensator", "overdue", {
    friendly_name: "Tørketrommel Rens av kondensator", parent_object: "Tørketrommel", maintenance_type: "cleaning", next_due: "2026-11-16", days_until_due: -3,
  }),
  "sensor.stue_stue_luftrenser_fyll_vanntanken": ms("sensor.stue_stue_luftrenser_fyll_vanntanken", "ok", {
    friendly_name: "Stue luftrenser Fyll vanntanken", parent_object: "Luftrenser", schedule_type: "sensor_based",
  }),
  "sensor.motorsykkel_oljeskift": ms("sensor.motorsykkel_oljeskift", "due_soon", {
    friendly_name: "Motorsykkel Oljeskift", parent_object: "Motorsykkel", next_due: "2026-11-25", days_until_due: 6,
  }),
  "sensor.batteriflate_kjop_lr44_batteri": ms("sensor.batteriflate_kjop_lr44_batteri", "archived", {
    friendly_name: "Batteriflåte Kjøp LR44-batteri", parent_object: "Batteriflåte", schedule_type: "one_time",
  }),
  "sensor.ecovent_rens_filter_sov_4": ms("sensor.ecovent_rens_filter_sov_4", "due_soon", {
    friendly_name: "EcoVent Rens filter Sov 4", parent_object: "Ventilasjon rom", next_due: "2026-12-09", days_until_due: 20, priority: "high",
  }),
  // Not a task: stock sensor from the same integration (no maintenance_type).
  "sensor.batteriflate_aa_batteri_stock": { entity_id: "sensor.batteriflate_aa_batteri_stock", state: "30", attributes: { part_name: "AA" } },

  // Home Connect washing machine: finished 40 minutes ago, not emptied.
  "sensor.vaskemaskin_operation_state": { entity_id: "sensor.vaskemaskin_operation_state", state: "finished", last_changed: "2026-11-19T11:50:00+01:00", attributes: {} },
  "sensor.vaskemaskin_program_progress": { entity_id: "sensor.vaskemaskin_program_progress", state: "unknown", attributes: {} },
  "sensor.vaskemaskin_program_finish_time": { entity_id: "sensor.vaskemaskin_program_finish_time", state: "unknown", attributes: {} },
  // Home Connect dryer: integration unavailable.
  "sensor.torketrommel_operation_state": { entity_id: "sensor.torketrommel_operation_state", state: "unavailable", attributes: {} },
  // Dishwasher via its own integration + an input_select for "finished, not emptied".
  "binary_sensor.oppvaskmaskin_running": { entity_id: "binary_sensor.oppvaskmaskin_running", state: "on", attributes: {} },
  "sensor.oppvaskmaskin_navaerende_fase": { entity_id: "sensor.oppvaskmaskin_navaerende_fase", state: "Skyller", attributes: {} },
  "sensor.oppvaskmaskin_time_remaining": { entity_id: "sensor.oppvaskmaskin_time_remaining", state: "35", attributes: {} },
  "sensor.oppvaskmaskin_progress": { entity_id: "sensor.oppvaskmaskin_progress", state: "70", attributes: {} },
  "input_select.oppvaskmaskin_status": { entity_id: "input_select.oppvaskmaskin_status", state: "Vasker", last_changed: "2026-11-19T11:20:00+01:00", attributes: {} },

  "person.anders": { entity_id: "person.anders", state: "home", attributes: { friendly_name: "Anders", user_id: "u1", entity_picture: "/api/image/a.jpg" } },
  "person.berit": { entity_id: "person.berit", state: "not_home", attributes: { friendly_name: "Berit", user_id: "u2", entity_picture: "/api/image/b.jpg" } },
  "person.cecilie": { entity_id: "person.cecilie", state: "home", attributes: { friendly_name: "Cecilie", user_id: "u3" } },
  "person.david": { entity_id: "person.david", state: "home", attributes: { friendly_name: "David", user_id: "u4" } },
  "person.erik": { entity_id: "person.erik", state: "Odden", attributes: { friendly_name: "Erik", user_id: "u5" } },
  "person.sylvester": { entity_id: "person.sylvester", state: "home", attributes: { friendly_name: "Sylvester" } },
};

export const entities = Object.fromEntries(
  Object.keys(states)
    .filter((e) => states[e].attributes?.maintenance_type !== undefined || e.endsWith("_stock"))
    .map((e) => [e, { entity_id: e, platform: "maintenance_supporter", device_id: null }]),
);
// Device name differs from the parent object for the air purifier.
entities["sensor.stue_stue_luftrenser_fyll_vanntanken"].device_id = "dev_luft";
entities["sensor.soverom_1_lexmark_c3326dw_bytt_blekk_eller_toner_cyan"].device_id = "dev_printer";
entities["sensor.stue_xiaomi_smart_pet_food_feeder_bytt_filter"].device_id = "dev_feeder";

export const devices = {
  dev_luft: { id: "dev_luft", name: "Stue luftrenser", name_by_user: null },
  dev_printer: { id: "dev_printer", name: "Lexmark C3326dw", name_by_user: null },
  dev_feeder: { id: "dev_feeder", name: "Xiaomi Smart Pet Food Feeder", name_by_user: null },
};

export const hass = { states, entities, devices, language: "nb", locale: { language: "nb" } };

export const config = {
  exclude_objects: ["Motorsykkel", "Elbil", "Batteriflåte"],
  persons: ["person.anders", "person.berit", "person.cecilie", "person.david"],
  appliances: [
    { name: "Vaskemaskin", type: "home_connect", prefix: "vaskemaskin", overdue_after: 60 },
    { name: "Tørketrommel", type: "home_connect", prefix: "torketrommel", overdue_after: 60 },
    {
      name: "Oppvaskmaskin",
      type: "entities",
      running: { entity: "binary_sensor.oppvaskmaskin_running", state: "on" },
      phase: "sensor.oppvaskmaskin_navaerende_fase",
      remaining: "sensor.oppvaskmaskin_time_remaining",
      progress: "sensor.oppvaskmaskin_progress",
      finished: { entity: "input_select.oppvaskmaskin_status", state: "Ferdig" },
      overdue_after: 720,
      emptied_action: {
        action: "input_select.select_option",
        target: { entity_id: "input_select.oppvaskmaskin_status" },
        data: { option: "Avsluttet" },
      },
    },
  ],
};
