// ============================================================================
// faults.js — pull the real machine fault out of an alert ticket.
//
// Zendesk files most robot alerts under one category, "Generic Error", which
// on its own says nothing: it is over half of all tickets. The actual fault is
// inside the ticket text, in the payload the alert system embeds:
//
//   Automatic alert for garmin, freight100-1311: error_status is
//   {"type":"GENERIC_ERROR","message":"Forcing ABORT on condition-dependent…"}
//
// This module lifts that message out, strips the parts that vary per incident
// (robot ids, timestamps), and maps it to a stable signature and family. On the
// live feed it resolves ~97% of Generic Error tickets.
// ============================================================================

/** Zendesk truncates long subjects, so the closing brace is often missing. */
export function rawFaultMessage(issue) {
  if (!issue) return null;
  const m = issue.match(/"message"\s*:\s*"([\s\S]*?)(?:"\s*\}|"\s*\||$)/);
  if (m && m[1].trim()) return m[1].trim();
  const s = issue.match(/\bstatus is ([A-Z_]{3,})/);
  if (s) return "status is " + s[1];
  return null;
}

/** Remove the per-incident noise so two occurrences of one fault match. */
function normalize(msg) {
  return msg
    .replace(/freight\s*\d*\s*-\s*\d+/gi, "")
    .replace(/\bAMR[- ]?\d+/gi, "")
    .replace(/\(\s*[\d.]+\s*\)/g, "")
    .replace(/\b\d{6,}\b/g, "")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const FAMILIES = {
  navigation: "Navigation & abort",
  docking:    "Docking & cart",
  payload:    "Payload & RollerTop",
  motor:      "Motor & breaker",
  battery:    "Battery",
  sensor:     "Sensors & comms",
  other:      "Unclassified",
};

// Order matters: the first match wins, so specific patterns precede general
// ones (precision undock before undock, canceled/failed before timed-out).
const RULES = [
  [/Forcing ABORT on condition-dependent failure/i, "navigation", "Abort — no collision-free state"],
  [/Aborting on error:\s*Targeting expired/i,       "navigation", "Abort — targeting expired"],
  [/\bTargeting expired\b/i,                        "navigation", "Abort — targeting expired"],
  [/\bControl feedback expired\b/i,                 "navigation", "Control feedback expired"],
  [/\bRequest expired\b/i,                          "navigation", "Request expired"],

  [/Did not complete precision undock/i,            "docking",    "Precision undock failed"],
  [/Did not complete undock/i,                      "docking",    "Undock failed"],
  [/Cart dock mechanism timed out/i,                "docking",    "Cart dock mechanism timed out"],
  [/Could not escape from cart/i,                   "docking",    "Could not escape from cart"],
  [/Could not detach from cart/i,                   "docking",    "Could not detach from cart"],
  [/out of undocking retries/i,                     "docking",    "Out of undocking retries"],

  [/Did not complete task with payload attached/i,  "payload",    "Task incomplete with payload attached"],
  [/Payload might be in unsafe configuration/i,     "payload",    "Payload in unsafe configuration"],
  [/LOAD RollerTop action timed-?out/i,             "payload",    "RollerTop LOAD timed out"],
  [/UNLOAD RollerTop action timed-?out/i,           "payload",    "RollerTop UNLOAD timed out"],
  [/LOAD RollerTop action was cancell?ed/i,         "payload",    "RollerTop LOAD cancelled"],
  [/UNLOAD RollerTop action was cancell?ed/i,       "payload",    "RollerTop UNLOAD cancelled"],
  [/LOAD RollerTop action failed/i,                 "payload",    "RollerTop LOAD failed"],
  [/UNLOAD RollerTop action failed/i,               "payload",    "RollerTop UNLOAD failed"],

  [/Breaker and table age fault types/i,            "motor",      "Breaker + table age fault"],
  [/charge_level field of the battery_state/i,      "battery",    "Battery charge_level unreadable"],

  [/Lost connection to camera\s*(\w+)?/i,           "sensor",     "Camera connection lost"],
  [/Connectivity problem detected for camera/i,     "sensor",     "Camera connectivity problem"],
  [/LASER dropout/i,                                "sensor",     "Laser dropout"],
  [/could not initialize bluetooth/i,               "sensor",     "Bluetooth radio failed to start"],
  [/status is OFFLINE/i,                            "sensor",     "Robot offline"],
];

// Motor and breaker faults name the board and the specific fault; both matter
// diagnostically, so they are kept in the label rather than rolled up.
const MOTOR_RE = /(Motor|Breaker) error on (\w+)\s*:\s*([A-Z_ ]+)/i;

/**
 * Classify one ticket.
 * Returns null when the ticket carries no machine fault (a human-written
 * ticket, or an alert whose subject was cut before the payload).
 */
export function classifyFault(issue) {
  const raw = rawFaultMessage(issue);
  if (!raw) return null;
  const msg = normalize(raw);

  const motor = msg.match(MOTOR_RE);
  if (motor) {
    const board = motor[2];
    const fault = motor[3].trim().toLowerCase();
    return {
      id: `motor:${board}:${fault}`.replace(/\s+/g, "-"),
      label: `${motor[1] === "Breaker" ? "Breaker" : "Motor"} ${board} — ${fault}`,
      family: "motor",
      message: raw,
    };
  }

  for (const [re, family, label] of RULES) {
    if (re.test(msg)) {
      return { id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"), label, family, message: raw };
    }
  }

  // Unrecognised but still a machine fault — group by its opening words so new
  // firmware messages cluster instead of scattering one row per ticket.
  const stem = msg.slice(0, 46);
  return {
    id: "other:" + stem.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    label: stem + (msg.length > 46 ? "…" : ""),
    family: "other",
    message: raw,
  };
}

/**
 * Roll a set of tickets up into ranked signatures and families.
 * `coverage` says how much of the set carried a readable fault, so the UI can
 * be honest about what it could not classify.
 */
export function summariseFaults(rows) {
  const sigs = new Map();
  const families = new Map();
  let classified = 0;

  for (const r of rows) {
    const f = classifyFault(r.issue);
    if (!f) continue;
    classified++;

    if (!sigs.has(f.id)) {
      sigs.set(f.id, {
        id: f.id, label: f.label, family: f.family,
        count: 0, robots: new Set(), customers: new Set(),
        rows: [], unresolved: 0, message: f.message, firstSeen: r.dt, lastSeen: r.dt,
      });
    }
    const s = sigs.get(f.id);
    s.count++;
    s.rows.push(r);
    if (r.robot_id) s.robots.add(String(r.robot_id));
    if (r.customer) s.customers.add(r.customer);
    if (!["solved", "closed"].includes((r.status || "").toLowerCase())) s.unresolved++;
    if (r.dt && r.dt < s.firstSeen) s.firstSeen = r.dt;
    if (r.dt && r.dt > s.lastSeen) s.lastSeen = r.dt;

    families.set(f.family, (families.get(f.family) || 0) + 1);
  }

  const signatures = [...sigs.values()]
    .map(s => ({ ...s, robots: [...s.robots], customers: [...s.customers],
                 robotCount: s.robots.size, customerCount: s.customers.size }))
    .sort((a, b) => b.count - a.count);

  const familyList = [...families.entries()]
    .map(([id, count]) => ({ id, label: FAMILIES[id] || id, count }))
    .sort((a, b) => b.count - a.count);

  return {
    signatures, families: familyList,
    classified, total: rows.length,
    coverage: rows.length ? Math.round((classified / rows.length) * 100) : 0,
  };
}
