/*
 * home-tasks-card
 * One list of everything that needs doing in the house, for a shared wall tablet.
 *
 * "In progress": appliances that are running, with phase, finish time and progress.
 * "To do": Maintenance Supporter tasks that are due soon, overdue or triggered, plus
 * appliances that are finished but not emptied, calendar events (birthdays, appointments),
 * to-do list items and date entities. Tap a row to mark it done and pick who did it; hold
 * a task to skip it.
 *
 * The card owns no state. It reads hass.states, fetches calendar events and to-do items,
 * and calls Maintenance Supporter's and the to-do integration's services.
 */

const CARD_VERSION = "0.3.0";

const DEFAULTS = {
  title: null, // null: translated default
  max_items: 8,
  ask_who: true,
  persons: null, // null: every person.* linked to a Home Assistant user
  exclude_objects: [],
  include_statuses: ["due_soon", "overdue", "triggered"],
  appliances: [],
  calendars: [],
  todo_lists: [],
  dates: [],
};

const FETCH_EVERY_MS = 15 * 60000;

const HC_RUNNING = ["run", "pause", "delayedstart", "actionrequired"];
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };
const URGENCY_RANK = { overdue: 0, today: 1, soon: 2 };
const HOLD_MS = 550;

const I18N = {
  nb: {
    title: "Å gjøre",
    in_progress: "I gang",
    nothing: "Ingenting å gjøre",
    more: (n) => `+${n} til`,
    less: "Vis færre",
    done: "Ferdig",
    emptied: "Tømt",
    cancel: "Avbryt",
    skip: "Hopp over",
    now: "Nå",
    today: "I dag",
    tomorrow: "I morgen",
    yesterday_overdue: "Forfalt i går",
    days_overdue: (n) => `Forfalt for ${n} dager siden`,
    finished_at: (t) => `Ferdig kl. ${t}`,
    finishes_at: (t) => `ferdig kl. ${t}`,
    at: (day, t) => `${day} kl. ${t}`,
    years: (n) => `${n} år`,
    uses: "Bruker",
    in_stock: (n) => `${n} på lager`,
    todo_done_q: (title) => `Er «${title}» gjort?`,
    empty_task: (name) => `Tøm ${name.toLowerCase()}`,
    opens_door: "Forsvinner når døren åpnes",
    who_did: (title) => `Hvem gjorde «${title}»?`,
    is_emptied: (name) => `Er ${name.toLowerCase()} tømt?`,
    skip_q: (title) => `Hopp over «${title}» denne gangen?`,
    reason: "Årsak (valgfritt)",
    failed: "Det gikk ikke:",
    phase: { run: "Går", pause: "Pause", delayedstart: "Starter senere", actionrequired: "Trenger tilsyn" },
    weekdays: ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"],
    months: ["jan.", "feb.", "mars", "apr.", "mai", "juni", "juli", "aug.", "sep.", "okt.", "nov.", "des."],
  },
  en: {
    title: "To do",
    in_progress: "In progress",
    nothing: "Nothing to do",
    more: (n) => `+${n} more`,
    less: "Show fewer",
    done: "Done",
    emptied: "Emptied",
    cancel: "Cancel",
    skip: "Skip",
    now: "Now",
    today: "Today",
    tomorrow: "Tomorrow",
    yesterday_overdue: "Overdue since yesterday",
    days_overdue: (n) => `Overdue by ${n} days`,
    finished_at: (t) => `Finished at ${t}`,
    finishes_at: (t) => `done at ${t}`,
    at: (day, t) => `${day} at ${t}`,
    years: (n) => `${n} years`,
    uses: "Uses",
    in_stock: (n) => `${n} in stock`,
    todo_done_q: (title) => `Is "${title}" done?`,
    empty_task: (name) => `Empty the ${name.toLowerCase()}`,
    opens_door: "Clears when the door is opened",
    who_did: (title) => `Who did "${title}"?`,
    is_emptied: (name) => `Is the ${name.toLowerCase()} emptied?`,
    skip_q: (title) => `Skip "${title}" this time?`,
    reason: "Reason (optional)",
    failed: "That did not work:",
    phase: { run: "Running", pause: "Paused", delayedstart: "Starts later", actionrequired: "Needs attention" },
    weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  },
};

const pickLang = (config, hass) => {
  const want = (config && config.language) || (hass && (hass.locale?.language || hass.language)) || "en";
  return I18N[want] ? want : String(want).startsWith("nb") || String(want).startsWith("no") ? "nb" : "en";
};

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const pad2 = (n) => String(n).padStart(2, "0");
const initials = (name) =>
  String(name)
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
/** A CSS url() value that survives any characters in the picture URL. */
const cssUrl = (u) => `url("${String(u).replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`;
const hhmm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const localDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Whole days from `now`'s local date to `ymd` (YYYY-MM-DD). Negative = in the past. */
function daysUntil(ymd, now) {
  if (!ymd) return null;
  const [y, m, d] = String(ymd).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const b = Date.UTC(y, m - 1, d);
  return Math.round((b - a) / 86400000);
}

/**
 * Task title without the object/device prefix. Maintenance Supporter names its entities
 * "<device> <task>", and the device name is not always the parent object's name
 * (device "Stue luftrenser", object "Luftrenser"), so try the registry first.
 */
function taskTitle(hass, entityId, st) {
  const reg = hass?.entities?.[entityId];
  if (reg?.name) return reg.name;
  const fn = st?.attributes?.friendly_name || entityId;
  const dev = reg?.device_id ? hass?.devices?.[reg.device_id] : null;
  const prefixes = [dev?.name_by_user, dev?.name, st?.attributes?.parent_object].filter(Boolean);
  for (const p of prefixes) {
    if (fn.toLowerCase().startsWith(String(p).toLowerCase() + " ")) return fn.slice(p.length + 1);
  }
  return fn;
}

/** Maintenance Supporter tasks that should be shown. */
function collectTasks(hass, config, now) {
  const cfg = { ...DEFAULTS, ...config };
  const out = [];
  for (const [eid, st] of Object.entries(hass?.states || {})) {
    if (!eid.startsWith("sensor.")) continue;
    const a = st.attributes || {};
    if (a.maintenance_type === undefined) continue;
    const platform = hass?.entities?.[eid]?.platform;
    if (platform && platform !== "maintenance_supporter") continue;
    if (!cfg.include_statuses.includes(st.state)) continue;
    if ((cfg.exclude_objects || []).includes(a.parent_object)) continue;

    const days = a.next_due ? daysUntil(a.next_due, now) : null;
    let urgency = "soon";
    if (st.state === "overdue" || st.state === "triggered" || (days !== null && days < 0)) urgency = "overdue";
    else if (days === 0) urgency = "today";

    const assignees = a.responsible_user ? [a.responsible_user] : Array.isArray(a.shared_with) ? [...a.shared_with] : [];
    out.push({
      kind: "task",
      id: eid,
      title: taskTitle(hass, eid, st),
      object: a.parent_object || "",
      status: st.state,
      due: a.next_due ? String(a.next_due).slice(0, 10) : null,
      days,
      urgency,
      priority: a.priority || "normal",
      assignees,
      responsible: a.responsible_user || null,
      icon: a.icon || null,
    });
  }
  return out;
}

const num = (s) => {
  const v = parseFloat(s?.state);
  return Number.isFinite(v) ? v : null;
};

/** One appliance's current situation: { running: {...} | null, todo: {...} | null }. */
function applianceStatus(hass, ap, now, L) {
  const S = hass?.states || {};
  const name = ap.name || ap.prefix || "?";
  const overdueAfter = Number(ap.overdue_after ?? 60);

  if ((ap.type || "home_connect") === "home_connect") {
    const op = S[`sensor.${ap.prefix}_operation_state`];
    if (!op) return { running: null, todo: null };
    const prog = num(S[`sensor.${ap.prefix}_program_progress`]);
    const finRaw = S[`sensor.${ap.prefix}_program_finish_time`]?.state;
    const fin = finRaw && !isNaN(Date.parse(finRaw)) ? new Date(finRaw) : null;
    if (HC_RUNNING.includes(op.state)) {
      return {
        running: { id: ap.prefix, name, phase: L.phase[op.state] || op.state, finishAt: fin, progress: prog, icon: ap.icon },
        todo: null,
      };
    }
    if (op.state === "finished") {
      const since = new Date(op.last_changed || now);
      const mins = (now - since) / 60000;
      return {
        running: null,
        todo: {
          kind: "appliance",
          id: `appliance:${ap.prefix}`,
          name,
          title: L.empty_task(name),
          finishedAt: since,
          urgency: mins > overdueAfter ? "overdue" : "today",
          priority: "normal",
          assignees: [],
          action: ap.emptied_action || null,
          icon: ap.icon,
        },
      };
    }
    return { running: null, todo: null };
  }

  // type: entities
  const isRunning = ap.running && S[ap.running.entity]?.state === String(ap.running.state);
  if (isRunning) {
    const rem = num(S[ap.remaining]);
    const finishAt = rem !== null ? new Date(now.getTime() + rem * 60000) : null;
    const phaseState = S[ap.phase]?.state;
    const phase = phaseState && !["unknown", "unavailable"].includes(phaseState) ? phaseState : L.phase.run;
    return { running: { id: name, name, phase, finishAt, progress: num(S[ap.progress]), icon: ap.icon }, todo: null };
  }
  const fst = ap.finished && S[ap.finished.entity];
  if (fst && fst.state === String(ap.finished.state)) {
    const since = new Date(fst.last_changed || now);
    const mins = (now - since) / 60000;
    return {
      running: null,
      todo: {
        kind: "appliance",
        id: `appliance:${name}`,
        name,
        title: L.empty_task(name),
        finishedAt: since,
        urgency: mins > overdueAfter ? "overdue" : "today",
        priority: "normal",
        assignees: [],
        action: ap.emptied_action || null,
        icon: ap.icon,
      },
    };
  }
  return { running: null, todo: null };
}

/** The date part of a date, datetime or timestamp string, in local time. */
function localDate(value) {
  const v = String(value ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d/.test(v)) {
    // A timestamp with an offset is converted to local time; a naive one is local already.
    const d = /[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? new Date(v) : null;
    return d && !isNaN(d) ? localDay(d) : v.slice(0, 10);
  }
  return null;
}

/** Display name of a configured source: its `name`, else the entity's friendly name. */
const sourceName = (hass, src) => src.name || hass?.states?.[src.entity]?.attributes?.friendly_name || src.entity;

/**
 * Calendar events from now to `days_ahead` days ahead. They have no button: an event is
 * not done, it is over. `events` is what /api/calendars/<entity> returned, per entity.
 */
function collectEvents(hass, cfg, events, now) {
  const out = [];
  for (const src of cfg.calendars || []) {
    const ahead = Number(src.days_ahead ?? 7);
    for (const ev of events?.[src.entity] || []) {
      const allDay = !!ev.start?.date;
      let days;
      let time = null;
      let ongoing = false;
      if (allDay) {
        days = daysUntil(ev.start.date, now);
        const endDays = daysUntil(ev.end?.date, now); // exclusive
        if (endDays !== null && endDays <= 0) continue;
      } else {
        const start = new Date(ev.start?.dateTime);
        const end = ev.end?.dateTime ? new Date(ev.end.dateTime) : start;
        if (isNaN(start) || end < now) continue;
        days = daysUntil(localDay(start), now);
        ongoing = start <= now;
        if (days >= 0) time = hhmm(start);
      }
      if (days === null || days > ahead) continue;
      days = Math.max(0, days);
      const due = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
      out.push({
        kind: "event",
        id: `event:${src.entity}:${ev.uid || ev.summary}:${ev.recurrence_id || ev.start?.date || ev.start?.dateTime}`,
        title: ev.summary || "",
        object: sourceName(hass, src),
        due,
        time,
        ongoing,
        days,
        urgency: days === 0 ? "today" : "soon",
        priority: "normal",
        assignees: src.persons || [],
      });
    }
  }
  return out;
}

/**
 * Open to-do items. `items` is what todo/item/list returned, per entity. Items with a due
 * date further away than `days_ahead` wait; items without one show unless `show_undated`
 * is false.
 */
function collectTodos(hass, cfg, items, now) {
  const out = [];
  for (const src of cfg.todo_lists || []) {
    const ahead = src.days_ahead ?? null;
    const undated = src.show_undated ?? true;
    for (const it of items?.[src.entity] || []) {
      if (it.status !== "needs_action") continue;
      const due = it.due ? localDate(it.due) : null;
      const days = due ? daysUntil(due, now) : null;
      if (days === null && !undated) continue;
      if (days !== null && ahead !== null && days > Number(ahead)) continue;
      const time = it.due && String(it.due).length > 10 ? hhmm(new Date(it.due)) : null;
      out.push({
        kind: "todo",
        id: `todo:${src.entity}:${it.uid}`,
        entity: src.entity,
        uid: it.uid,
        title: it.summary || "",
        object: sourceName(hass, src),
        due,
        time,
        days,
        urgency: days === null ? "soon" : days < 0 ? "overdue" : days === 0 ? "today" : "soon",
        priority: "normal",
        assignees: src.persons || [],
      });
    }
  }
  return out;
}

/**
 * Entities whose state is a date (input_datetime, a date or timestamp sensor). `yearly`
 * shows the next anniversary, with the age when the year is known: birthdays. A date
 * that is not yearly and has passed stays as overdue until the entity changes.
 */
function collectDates(hass, cfg, now) {
  const S = hass?.states || {};
  const out = [];
  for (const src of cfg.dates || []) {
    const st = S[src.entity];
    const date = st && localDate(st.state);
    if (!date) continue;
    const ahead = Number(src.days_ahead ?? 14);
    let due = date;
    let age = null;
    if (src.yearly) {
      const [y, m, d] = date.split("-").map(Number);
      let year = now.getFullYear();
      if (daysUntil(`${year}-${pad2(m)}-${pad2(d)}`, now) < 0) year += 1;
      due = `${year}-${pad2(m)}-${pad2(d)}`;
      if (y > 1900 && y < year) age = year - y;
    }
    const days = daysUntil(due, now);
    if (days > ahead) continue;
    out.push({
      kind: "date",
      id: `date:${src.entity}`,
      title: sourceName(hass, src),
      object: "",
      due,
      days,
      age,
      urgency: days < 0 ? "overdue" : days === 0 ? "today" : "soon",
      priority: "normal",
      assignees: src.persons || [],
    });
  }
  return out;
}

/**
 * Sort: urgency, then due date (none first: triggered tasks and appliances; undated to-do
 * items last), time of day, priority, title.
 */
function sortItems(items) {
  const key = (i) => (i.kind === "todo" && !i.due ? "~" : (i.due || "") + (i.time ? `T${i.time}` : ""));
  return [...items].sort((a, b) => {
    const u = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
    if (u) return u;
    const da = key(a);
    const db = key(b);
    if (da !== db) return da < db ? -1 : 1;
    const p = (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
    if (p) return p;
    return String(a.title).localeCompare(String(b.title));
  });
}

/** "I dag", "I morgen", a weekday within a week, else a date. `d` >= 0. */
function dayWord(d, now, L) {
  if (d === 0) return L.today;
  if (d === 1) return L.tomorrow;
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
  if (d < 7) return L.weekdays[due.getDay()];
  return `${due.getDate()}. ${L.months[due.getMonth()]}`;
}

/** Secondary line text for a row. */
function dueText(item, now, L) {
  if (item.kind === "appliance") return L.finished_at(hhmm(item.finishedAt));
  if (item.kind === "event" && item.ongoing) return L.now;
  if (item.status === "triggered" && item.days === null) return L.now;
  const d = item.days;
  if (d === null || d === undefined) return item.status === "overdue" ? L.days_overdue("?") : "";
  if (d < -1) return L.days_overdue(-d);
  if (d === -1) return L.yesterday_overdue;
  const day = dayWord(d, now, L);
  const text = item.time ? L.at(day, item.time) : day;
  return item.age ? `${text}, ${L.years(item.age)}` : text;
}

/** People offered in the "who did it" picker. */
function pickPersons(hass, config) {
  const S = hass?.states || {};
  const ids = config.persons || Object.keys(S).filter((e) => e.startsWith("person.") && S[e].attributes?.user_id);
  return ids
    .filter((e) => S[e])
    .map((e) => ({ id: e, name: S[e].attributes?.friendly_name || e, picture: S[e].attributes?.entity_picture || null }));
}

/**
 * Build everything the card shows from hass + config. Pure; used by tests.
 * `ext` holds what was fetched: { events: {calendar.x: [...]}, todos: {todo.x: [...]} }.
 */
function buildModel(hass, config, now = new Date(), ext = {}) {
  const cfg = { ...DEFAULTS, ...config };
  const L = I18N[pickLang(cfg, hass)];
  const running = [];
  const items = [
    ...collectTasks(hass, cfg, now),
    ...collectEvents(hass, cfg, ext.events, now),
    ...collectTodos(hass, cfg, ext.todos, now),
    ...collectDates(hass, cfg, now),
  ];
  for (const ap of cfg.appliances || []) {
    const s = applianceStatus(hass, ap, now, L);
    if (s.running) running.push(s.running);
    if (s.todo) items.push(s.todo);
  }
  const sorted = sortItems(items).map((it) => ({ ...it, sub: dueText(it, now, L) }));
  return { running, items: sorted };
}

/**
 * The spare parts a completion of this task books, from the maintenance_supporter/objects
 * response: the task's consumes_parts links, resolved on the owning object (a link may
 * point to a part shared from another object). Phase overrides are not shown.
 * Returns [{ name, quantity, unit, stock }]; [] when the task uses no parts.
 */
function partsForTask(objectsResponse, entityId) {
  const objects = objectsResponse?.objects || [];
  const byEntry = new Map(objects.map((o) => [o.entry_id, o]));
  for (const o of objects) {
    const task = (o.tasks || []).find((t) => t.sensor_entity_id === entityId);
    if (!task) continue;
    return (task.consumes_parts || [])
      .map((link) => {
        const owner = byEntry.get(link.entry_id || o.entry_id);
        const part = (owner?.parts || []).find((p) => p.id === link.part_id);
        if (!part) return null;
        const stock = typeof part.stock === "number" ? part.stock : null;
        return { name: part.name || link.part_id, quantity: Number(link.quantity ?? 1), unit: part.unit || "", stock };
      })
      .filter(Boolean);
  }
  return [];
}

/** 1, 1,5, 0,25 in the card's language: no trailing zeros. */
const qty = (n, lang) => new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(Number(n));

/* ---------------------------------------------------------------- styles */

const STYLE = `
  :host {
    --_alert: var(--todo-alert-color, var(--error-color, #db4437));
    --_active: var(--todo-active-color, var(--state-active-color, var(--primary-color)));
    --_muted: var(--todo-muted-color, var(--secondary-text-color));
    --_divider: var(--todo-divider-color, var(--divider-color, rgba(127,127,127,.2)));
  }
  ha-card { padding: 18px 16px 10px; }
  h2 { margin: 0 4px 10px; font-size: 20px; font-weight: 500; color: var(--primary-text-color); }
  h3 { margin: 4px 4px 2px; font-size: 14px; font-weight: 400; color: var(--_muted); }
  .run { display: flex; align-items: center; gap: 12px; padding: 8px 4px 10px; }
  .run ha-icon { color: var(--_active); --mdc-icon-size: 22px; flex: none; }
  .run .txt { flex: 1; min-width: 0; }
  .run .name { font-size: 16px; font-weight: 500; }
  .run .sub { font-size: 13px; color: var(--_muted); }
  .bar { height: 4px; border-radius: 2px; background: var(--_divider); margin-top: 6px; overflow: hidden; }
  .bar > i { display: block; height: 100%; background: var(--_active); }
  .sep { height: 1px; background: var(--_divider); margin: 6px 0 2px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; align-items: center; gap: 12px; padding: 10px 4px; border-top: 1px solid var(--_divider);
       transition: opacity .4s; user-select: none; -webkit-user-select: none; }
  li:first-child { border-top: 0; }
  li.leaving { opacity: .3; }
  .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; background: var(--_muted); opacity: .45; }
  .overdue .dot, .today .dot { opacity: 1; }
  .overdue .dot { background: var(--_alert); }
  .today .dot { background: var(--primary-text-color); }
  .appliance.today .dot { background: var(--_active); }
  .body { flex: 1; min-width: 0; }
  .title { font-size: 16px; font-weight: 500; line-height: 1.25; color: var(--primary-text-color); }
  .meta { font-size: 13px; color: var(--_muted); margin-top: 2px; }
  .overdue .meta { color: var(--_alert); }
  .err { font-size: 13px; color: var(--_alert); margin-top: 2px; }
  .faces { display: flex; flex: none; }
  .face { width: 30px; height: 30px; border-radius: 50%; background: var(--secondary-background-color);
          background-size: cover; background-position: center; border: 2px solid var(--card-background-color, #fff);
          display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 500;
          color: var(--primary-text-color); box-sizing: border-box; }
  .faces.many .face { width: 24px; height: 24px; margin-left: -8px; font-size: 9px; }
  .faces.many .face:first-child { margin-left: 0; }
  button { font: inherit; color: inherit; cursor: pointer; }
  .act { min-height: 44px; min-width: 72px; padding: 0 14px; border-radius: 10px; flex: none;
         border: 1px solid var(--_divider); background: transparent; color: var(--primary-text-color); font-size: 14px; }
  .act:focus-visible, .link:focus-visible, .person:focus-visible, .btn:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
  .empty { padding: 14px 4px 10px; color: var(--_muted); font-size: 15px; }
  .link { border: 0; background: none; color: var(--_muted); font-size: 14px; padding: 10px 4px; min-height: 44px; }
  .hint { font-size: 12px; color: var(--_muted); flex: none; max-width: 110px; text-align: right; line-height: 1.3; }

  dialog { padding: 0; border: 0; border-radius: 18px; background: var(--card-background-color, #fff);
           color: var(--primary-text-color); width: min(520px, calc(100vw - 32px)); box-shadow: 0 8px 32px rgba(0,0,0,.25); }
  dialog::backdrop { background: rgba(0,0,0,.45); }
  .dlg { padding: 24px; }
  .dlg:focus { outline: none; }
  .dlg h4 { margin: 0 0 18px; font-size: 20px; font-weight: 500; line-height: 1.3; }
  .people { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; }
  .person { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 8px; min-width: 84px;
            border-radius: 12px; border: 2px solid transparent; background: var(--secondary-background-color); }
  .person[aria-pressed="true"] { border-color: var(--primary-text-color); }
  .person .face { width: 52px; height: 52px; font-size: 16px; border: 0; }
  .person span { font-size: 14px; }
  .dlg input { width: 100%; box-sizing: border-box; min-height: 44px; padding: 0 12px; border-radius: 10px;
               border: 1px solid var(--_divider); background: transparent; color: inherit; font: inherit; margin-bottom: 20px; }
  .parts { margin: -4px 0 20px; }
  .parts .lbl { font-size: 13px; color: var(--_muted); margin-bottom: 4px; }
  .parts li { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-top: 0; font-size: 15px; }
  .parts .stock { color: var(--_muted); font-size: 13px; }
  .row { display: flex; gap: 12px; justify-content: flex-end; }
  .btn { min-height: 48px; padding: 0 22px; border-radius: 12px; border: 1px solid var(--_divider);
         background: transparent; font-size: 16px; }
  .btn.primary { background: var(--primary-text-color); color: var(--card-background-color, #fff); border-color: transparent; }
  .btn[disabled] { opacity: .4; cursor: default; }
  @media (prefers-reduced-motion: reduce) { li { transition: none; } }
`;

/* ---------------------------------------------------------------- card */

class HomeTasksCard extends HTMLElement {
  static getStubConfig() {
    return { max_items: 8 };
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    for (const ap of config.appliances || []) {
      const type = ap.type || "home_connect";
      if (type === "home_connect" && !ap.prefix) throw new Error(`appliance "${ap.name || "?"}": prefix is required`);
      if (type === "entities" && !(ap.running?.entity && ap.finished?.entity))
        throw new Error(`appliance "${ap.name || "?"}": running.entity and finished.entity are required`);
    }
    for (const key of ["calendars", "todo_lists", "dates"]) {
      if (config[key] !== undefined && !Array.isArray(config[key])) throw new Error(`${key} must be a list`);
      for (const src of config[key] || []) if (!src?.entity) throw new Error(`${key}: every entry needs an entity`);
    }
    this._config = { ...DEFAULTS, ...config };
    this._expanded = false;
    this._dialog = null;
    this._errors = new Map();
    this._leaving = new Set();
    this._ext = { events: {}, todos: {} };
    this._extSig = null;
    this._fetchedAt = 0;
    this._render(); // the next hass update fetches (the signature was reset)
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    // Calendars and to-do lists: their events and items are not in hass.states. Fetch again
    // when the entity changes (a to-do list's state is its open count).
    const extSig = this._externalSignature();
    if (extSig !== this._extSig) {
      this._extSig = extSig;
      this._fetch();
    }
    const sig = this._signature();
    if (first || sig !== this._sig) {
      this._sig = sig;
      this._render();
    }
  }

  connectedCallback() {
    clearInterval(this._tick);
    this._tick = setInterval(() => {
      // Calendars change without their entity changing: fetch every 15 minutes and at midnight.
      const now = new Date();
      if (now - this._fetchedAt > FETCH_EVERY_MS || localDay(now) !== localDay(new Date(this._fetchedAt))) this._fetch();
      this._render();
    }, 60000);
  }

  _externalSignature() {
    const S = this._hass?.states || {};
    const cfg = this._config || {};
    return [...(cfg.calendars || []), ...(cfg.todo_lists || [])]
      .map((src) => `${src.entity}|${S[src.entity]?.state}|${S[src.entity]?.last_updated}`)
      .join("|");
  }

  /** Fetch calendar events and to-do items. One fetch at a time; a request during one runs after it. */
  async _fetch() {
    const hass = this._hass;
    const cfg = this._config;
    if (!hass || !cfg || !(cfg.calendars.length || cfg.todo_lists.length)) return;
    if (this._fetching) {
      this._fetchAgain = true;
      return;
    }
    this._fetching = true;
    this._fetchedAt = Date.now();
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const events = {};
    const todos = {};
    const jobs = [
      ...cfg.calendars.map(async (src) => {
        const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + Number(src.days_ahead ?? 7) + 1);
        const q = `start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(to.toISOString())}`;
        try {
          events[src.entity] = await hass.callApi("GET", `calendars/${src.entity}?${q}`);
        } catch (err) {
          events[src.entity] = this._ext.events[src.entity] || [];
          console.warn(`home-tasks-card: ${src.entity}:`, err?.message || err);
        }
      }),
      ...cfg.todo_lists.map(async (src) => {
        try {
          todos[src.entity] = (await hass.callWS({ type: "todo/item/list", entity_id: src.entity })).items || [];
        } catch (err) {
          todos[src.entity] = this._ext.todos[src.entity] || [];
          console.warn(`home-tasks-card: ${src.entity}:`, err?.message || err);
        }
      }),
    ];
    await Promise.all(jobs);
    this._ext = { events, todos };
    this._fetching = false;
    this._render();
    if (this._fetchAgain) {
      this._fetchAgain = false;
      this._fetch();
    }
  }

  disconnectedCallback() {
    clearInterval(this._tick);
  }

  getCardSize() {
    return 4;
  }

  getGridOptions() {
    return { columns: 12, rows: "auto", min_columns: 6 };
  }

  /** Re-render only when something the card reads has changed. */
  _signature() {
    const S = this._hass?.states || {};
    const parts = [];
    for (const [eid, st] of Object.entries(S)) {
      if (eid.startsWith("sensor.") && st.attributes?.maintenance_type !== undefined) {
        parts.push(eid, st.state, st.attributes.next_due, st.attributes.responsible_user);
      }
    }
    for (const ap of this._config?.appliances || []) {
      const ids =
        (ap.type || "home_connect") === "home_connect"
          ? ["operation_state", "program_progress", "program_finish_time"].map((s) => `sensor.${ap.prefix}_${s}`)
          : [ap.running?.entity, ap.finished?.entity, ap.phase, ap.remaining, ap.progress];
      for (const id of ids) if (id) parts.push(id, S[id]?.state, S[id]?.last_changed);
    }
    for (const src of this._config?.dates || []) parts.push(src.entity, S[src.entity]?.state);
    return parts.join("|");
  }

  get _L() {
    return I18N[pickLang(this._config, this._hass)];
  }

  _face(name, pic) {
    return pic
      ? `<span class="face" title="${esc(name)}" style="background-image:${esc(cssUrl(pic))}"></span>`
      : `<span class="face" title="${esc(name)}">${esc(initials(name))}</span>`;
  }

  _faces(ids, many) {
    const S = this._hass?.states || {};
    const faces = ids.map((id) => this._face(S[id]?.attributes?.friendly_name || id, S[id]?.attributes?.entity_picture));
    return `<span class="faces${many ? " many" : ""}">${faces.join("")}</span>`;
  }

  _render() {
    if (!this._config) return;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
      this.shadowRoot.addEventListener("pointerdown", (e) => this._onDown(e));
      this.shadowRoot.addEventListener("pointerup", () => this._cancelHold());
      this.shadowRoot.addEventListener("pointerleave", () => this._cancelHold(), true);
      this.shadowRoot.addEventListener("pointercancel", () => this._cancelHold());
      this.shadowRoot.addEventListener("contextmenu", (e) => {
        if (e.target.closest("li[data-kind=task]")) e.preventDefault();
      });
    }
    if (!this._hass) {
      this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card></ha-card>`;
      return;
    }
    const L = this._L;
    const cfg = this._config;
    const model = buildModel(this._hass, cfg, new Date(), this._ext);
    this._model = model;
    for (const id of [...this._leaving]) if (!model.items.some((i) => i.id === id)) this._leaving.delete(id);

    const running = model.running
      .map((r) => {
        const sub = [r.phase, r.finishAt ? L.finishes_at(hhmm(r.finishAt)) : null].filter(Boolean).join(", ");
        const bar =
          r.progress !== null && r.progress !== undefined
            ? `<div class="bar"><i style="width:${Math.max(0, Math.min(100, r.progress))}%"></i></div>`
            : "";
        return `<div class="run"><ha-icon icon="${esc(r.icon || "mdi:progress-clock")}"></ha-icon>
          <div class="txt"><div class="name">${esc(r.name)}</div><div class="sub">${esc(sub)}</div>${bar}</div></div>`;
      })
      .join("");

    const limit = Math.max(1, cfg.max_items);
    const shown = this._expanded ? model.items : model.items.slice(0, limit);
    const hidden = model.items.length - shown.length;

    const rows = shown
      .map((it) => {
        const meta = it.object ? `${it.object}, ${it.sub.toLowerCase()}` : it.sub;
        const err = this._errors.get(it.id);
        let right = "";
        if (it.kind === "task") {
          right = `<button class="act" data-act="done" data-id="${esc(it.id)}">${esc(L.done)}</button>`;
        } else if (it.kind === "todo") {
          right = `<button class="act" data-act="todo" data-id="${esc(it.id)}">${esc(L.done)}</button>`;
        } else if (it.kind === "event" || it.kind === "date") {
          right = ""; // nothing to do: it is over when the day is
        } else if (it.action) {
          right = `<button class="act" data-act="emptied" data-id="${esc(it.id)}">${esc(L.emptied)}</button>`;
        } else {
          right = `<span class="hint">${esc(L.opens_door)}</span>`;
        }
        const faces = it.assignees?.length ? this._faces(it.assignees, it.assignees.length > 1) : "";
        return `<li class="${it.kind} ${it.urgency}${this._leaving.has(it.id) ? " leaving" : ""}" data-kind="${it.kind}" data-id="${esc(it.id)}">
          <span class="dot"></span>
          <div class="body"><div class="title">${esc(it.title)}</div><div class="meta">${esc(meta)}</div>${
            err ? `<div class="err">${esc(L.failed)} ${esc(err)}</div>` : ""
          }</div>
          ${faces}${right}</li>`;
      })
      .join("");

    const more =
      hidden > 0
        ? `<button class="link" data-act="more">${esc(L.more(hidden))}</button>`
        : this._expanded && model.items.length > limit
          ? `<button class="link" data-act="less">${esc(L.less)}</button>`
          : "";

    const list = model.items.length ? `<ul>${rows}</ul>${more}` : `<div class="empty">${esc(L.nothing)}</div>`;

    this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card>
      <h2>${esc(cfg.title || L.title)}</h2>
      ${running ? `<h3>${esc(L.in_progress)}</h3>${running}<div class="sep"></div>` : ""}
      ${list}
    </ha-card>${this._dialogHtml()}`;
    // <dialog> + showModal(): the top layer escapes any transform/overflow on the dashboard grid.
    const dlg = this.shadowRoot.querySelector("dialog");
    if (dlg) {
      dlg.addEventListener("cancel", (e) => {
        e.preventDefault();
        this._dialog = null;
        this._render();
      });
      if (!dlg.open) dlg.showModal();
    }
  }

  _item(id) {
    return this._model?.items.find((i) => i.id === id);
  }

  _dialogHtml() {
    const d = this._dialog;
    if (!d) return "";
    const L = this._L;
    const it = this._item(d.id);
    if (!it) return "";
    if (d.type === "done") {
      const people = pickPersons(this._hass, this._config)
        .map((p) => {
          const face = this._face(p.name, p.picture);
          return `<button class="person" data-act="pick" data-person="${esc(p.id)}" aria-pressed="${
            d.who === p.id
          }">${face}<span>${esc(p.name)}</span></button>`;
        })
        .join("");
      const ask = this._config.ask_who;
      const lang = pickLang(this._config, this._hass);
      const parts = d.parts?.length
        ? `<div class="parts"><div class="lbl">${esc(L.uses)}</div><ul>${d.parts
            .map(
              (p) =>
                `<li><span>${esc(qty(p.quantity, lang))}${p.unit ? ` ${esc(p.unit)}` : " ×"} ${esc(p.name)}</span>${
                  p.stock !== null ? `<span class="stock">${esc(L.in_stock(qty(p.stock, lang)))}</span>` : ""
                }</li>`,
            )
            .join("")}</ul></div>`
        : "";
      // Until someone is picked, Done is disabled; autofocus on it would make the browser
      // focus the first person instead, which looks like a choice. Focus the dialog then.
      const waiting = ask && !d.who;
      return `<dialog data-act="close" aria-label="${esc(L.who_did(it.title))}"><div class="dlg" tabindex="-1"${
        waiting ? " autofocus" : ""
      }>
        <h4>${esc(ask ? L.who_did(it.title) : it.title)}</h4>
        ${ask ? `<div class="people">${people}</div>` : ""}
        ${parts}
        <div class="row"><button class="btn" data-act="close">${esc(L.cancel)}</button>
        <button class="btn primary" data-act="confirm" ${waiting ? "disabled" : "autofocus"}>${esc(
          L.done,
        )}</button></div></div></dialog>`;
    }
    if (d.type === "todo") {
      return `<dialog data-act="close"><div class="dlg">
        <h4>${esc(L.todo_done_q(it.title))}</h4>
        <div class="row"><button class="btn" data-act="close">${esc(L.cancel)}</button>
        <button class="btn primary" data-act="confirm" autofocus>${esc(L.done)}</button></div></div></dialog>`;
    }
    if (d.type === "emptied") {
      return `<dialog data-act="close"><div class="dlg">
        <h4>${esc(L.is_emptied(it.name))}</h4>
        <div class="row"><button class="btn" data-act="close">${esc(L.cancel)}</button>
        <button class="btn primary" data-act="confirm" autofocus>${esc(L.emptied)}</button></div></div></dialog>`;
    }
    if (d.type === "skip") {
      return `<dialog data-act="close"><div class="dlg">
        <h4>${esc(L.skip_q(it.title))}</h4>
        <input type="text" placeholder="${esc(L.reason)}" aria-label="${esc(L.reason)}" value="${esc(d.reason || "")}">
        <div class="row"><button class="btn" data-act="close">${esc(L.cancel)}</button>
        <button class="btn primary" data-act="confirm" autofocus>${esc(L.skip)}</button></div></div></dialog>`;
    }
    return "";
  }

  _onDown(e) {
    const li = e.target.closest("li[data-kind=task]");
    if (!li || e.target.closest("button")) return;
    this._cancelHold();
    this._holdTimer = setTimeout(() => {
      this._heldAt = Date.now();
      this._open({ type: "skip", id: li.dataset.id });
    }, HOLD_MS);
  }

  _cancelHold() {
    clearTimeout(this._holdTimer);
  }

  _open(dialog) {
    this._dialog = dialog;
    this._render();
  }

  _onClick(e) {
    // Swallow the click that ends a long press (it may or may not arrive).
    if (this._heldAt && Date.now() - this._heldAt < 400) return;
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    // A click on the backdrop lands on <dialog> itself; clicks inside land on .dlg.
    if (act === "close" && el.tagName === "DIALOG" && e.target !== el) return;
    if (act === "more" || act === "less") {
      this._expanded = act === "more";
      return this._render();
    }
    if (act === "done") {
      const it = this._item(el.dataset.id);
      this._open({ type: "done", id: el.dataset.id, who: it?.responsible || null, parts: null });
      return this._loadParts(el.dataset.id);
    }
    if (act === "todo") return this._open({ type: "todo", id: el.dataset.id });
    if (act === "emptied") return this._open({ type: "emptied", id: el.dataset.id });
    if (act === "pick") {
      this._dialog.who = el.dataset.person;
      return this._render();
    }
    if (act === "close") {
      this._dialog = null;
      return this._render();
    }
    if (act === "confirm") return this._confirm();
  }

  /**
   * Show the spare parts the completion books (from Maintenance Supporter's own objects
   * command). Fetched when the dialog opens, so the stock is current. Shows nothing when it
   * fails: an older Maintenance Supporter, or a task without parts.
   */
  async _loadParts(id) {
    try {
      const res = await this._hass.callWS({ type: "maintenance_supporter/objects", compact: true });
      const parts = partsForTask(res, id);
      if (this._dialog?.type === "done" && this._dialog.id === id && parts.length) {
        this._dialog.parts = parts;
        this._render();
      }
    } catch (err) {
      console.warn("home-tasks-card: parts:", err?.message || err);
    }
  }

  async _confirm() {
    const d = this._dialog;
    const it = d && this._item(d.id);
    if (!it) return;
    if (d.type === "skip") d.reason = this.shadowRoot.querySelector("dialog input")?.value || "";
    this._dialog = null;
    this._errors.delete(it.id);
    this._leaving.add(it.id);
    this._render();
    try {
      if (d.type === "done") {
        const data = { entity_id: it.id };
        if (this._config.ask_who && d.who) data.completed_by = d.who;
        await this._hass.callService("maintenance_supporter", "complete", data);
      } else if (d.type === "skip") {
        const data = { entity_id: it.id };
        if (d.reason) data.reason = d.reason;
        await this._hass.callService("maintenance_supporter", "skip", data);
      } else if (d.type === "todo") {
        await this._hass.callService("todo", "update_item", { item: it.uid, status: "completed" }, { entity_id: it.entity });
        this._fetch();
      } else if (d.type === "emptied") {
        const a = it.action || {};
        const [domain, service] = String(a.action || a.service || "").split(".");
        if (!domain || !service) throw new Error("emptied_action.action is missing");
        await this._hass.callService(domain, service, a.data || {}, a.target);
      }
    } catch (err) {
      this._leaving.delete(it.id);
      this._errors.set(it.id, err?.message || String(err));
      this._render();
    }
  }
}

HomeTasksCard._internals = {
  CARD_VERSION,
  DEFAULTS,
  I18N,
  pickLang,
  daysUntil,
  taskTitle,
  collectTasks,
  applianceStatus,
  sortItems,
  dueText,
  localDate,
  collectEvents,
  collectTodos,
  collectDates,
  partsForTask,
  pickPersons,
  buildModel,
};

if (!customElements.get("home-tasks-card")) {
  customElements.define("home-tasks-card", HomeTasksCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "home-tasks-card",
    name: "Home Tasks Card",
    description: "Maintenance Supporter tasks, appliances, calendars and to-do lists in one list for a shared tablet.",
    documentationURL: "https://github.com/trikkssitt/home-tasks-card",
  });
  console.info(`%chome-tasks-card ${CARD_VERSION}`, "font-weight:600");
}
