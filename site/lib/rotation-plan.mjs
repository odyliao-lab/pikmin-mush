export const ROTATION_TIME_ZONE = "Asia/Taipei";
export const ROTATION_SWITCH_MINUTES = [4 * 60, 12 * 60, 20 * 60];
export const ROTATION_SWITCH_MINUTE = ROTATION_SWITCH_MINUTES[0];
export const ROTATION_EPOCH_DATE = "2026-07-22";

// Each eight-hour slot uses packs whose *least advanced* city has reached the
// selected Taipei calendar date and at least 01:00 local time. Taiwan and Japan
// remain intentionally excluded. Distinct packs in a slot prevent Agent overlap.
const ROUTES = {
  asia: [
    { id: "asia-01", label: "亞洲／大洋洲 01", packs: ["th", "my", "sg"], cityCount: 17 },
    { id: "asia-02", label: "亞洲／大洋洲 02", packs: ["au", "ph"], cityCount: 18 },
    { id: "asia-03", label: "亞洲／大洋洲 03", packs: ["in", "vn"], cityCount: 20 },
    { id: "asia-04", label: "亞洲／大洋洲 04", packs: ["kr", "id", "nz"], cityCount: 24 },
  ],
  emea: [
    { id: "emea-01", label: "歐洲／中東／非洲 01", packs: ["gb", "pl", "ro", "at", "pt", "tn", "il", "rs", "qa"], cityCount: 48 },
    { id: "emea-02", label: "歐洲／中東／非洲 02", packs: ["fr", "de", "eg", "sa", "gr", "dz", "jo", "bg"], cityCount: 45 },
    { id: "emea-03", label: "歐洲／中東／非洲 03", packs: ["se", "no", "es", "ma", "hu", "hr", "ae", "cz", "si"], cityCount: 46 },
    { id: "emea-04", label: "歐洲／中東／非洲 04", packs: ["it", "fi", "nl", "dk", "ch", "be", "is", "ie", "sk"], cityCount: 46 },
  ],
  americas: [
    { id: "americas-01", label: "美洲 01", packs: ["us-west", "ar", "ve", "bo", "sv", "bz"], cityCount: 39 },
    { id: "americas-02", label: "美洲 02", packs: ["us-central", "mx", "ec", "cr", "hn"], cityCount: 37 },
    { id: "americas-03", label: "美洲 03", packs: ["us-east", "co", "ca", "pa", "gt"], cityCount: 37 },
    { id: "americas-04", label: "美洲 04", packs: ["br", "pe", "cl", "uy", "py", "ni"], cityCount: 40 },
  ],
};
export const ROTATION_DAYS = Object.values(ROUTES);

// Used only when fewer than four Agents are available, so no country pack is
// silently dropped just because a phone is paused or temporarily offline.
const PACK_CITY_COUNTS = {
  in: 12, kr: 8, th: 8, my: 8, sg: 1, id: 8, ph: 8, vn: 8, au: 10, nz: 8,
  br: 12, ec: 6, ar: 10, co: 8, pe: 8, cl: 8, uy: 4, py: 4, bo: 5, ve: 6,
  se: 6, no: 6, dk: 5, fi: 6, is: 4, ae: 4, sa: 5, il: 4, jo: 4, qa: 3,
  de: 6, at: 5, ch: 5, cz: 4, pl: 6, hu: 5, it: 7, es: 6, pt: 5, gr: 5,
  hr: 5, gb: 10, fr: 10, nl: 6, be: 5, ie: 4, ro: 6, bg: 4, rs: 4,
  sk: 4, si: 4, eg: 6, ma: 6, dz: 5, tn: 5, gt: 4, hn: 4, sv: 4,
  ni: 4, cr: 5, pa: 5, mx: 10, bz: 2, "us-east": 12, "us-central": 12,
  "us-west": 12, ca: 8,
};

// Multi-zone packs use their westernmost/least advanced representative. The
// slot boundaries are conservative even across the catalogue's other cities.
const PACK_TIME_ZONES = {
  in: "Asia/Kolkata", kr: "Asia/Seoul", th: "Asia/Bangkok", my: "Asia/Kuala_Lumpur",
  sg: "Asia/Singapore", id: "Asia/Jakarta", ph: "Asia/Manila", vn: "Asia/Ho_Chi_Minh",
  au: "Australia/Perth", nz: "Pacific/Auckland", ae: "Asia/Dubai", sa: "Asia/Riyadh",
  il: "Asia/Jerusalem", jo: "Asia/Amman", qa: "Asia/Qatar", fi: "Europe/Helsinki",
  ro: "Europe/Bucharest", bg: "Europe/Sofia", se: "Europe/Stockholm",
  no: "Europe/Oslo", dk: "Europe/Copenhagen", is: "Atlantic/Reykjavik",
  de: "Europe/Berlin", at: "Europe/Vienna", ch: "Europe/Zurich", cz: "Europe/Prague",
  pl: "Europe/Warsaw", hu: "Europe/Budapest", it: "Europe/Rome", es: "Europe/Madrid",
  pt: "Europe/Lisbon", gr: "Europe/Athens", hr: "Europe/Zagreb", gb: "Europe/London",
  fr: "Europe/Paris", nl: "Europe/Amsterdam", be: "Europe/Brussels", ie: "Europe/Dublin",
  rs: "Europe/Belgrade", sk: "Europe/Bratislava", si: "Europe/Ljubljana",
  eg: "Africa/Cairo", ma: "Africa/Casablanca", dz: "Africa/Algiers", tn: "Africa/Tunis",
  br: "America/Sao_Paulo", ec: "America/Guayaquil", ar: "America/Argentina/Buenos_Aires",
  co: "America/Bogota", pe: "America/Lima", cl: "America/Santiago", uy: "America/Montevideo",
  py: "America/Asuncion", bo: "America/La_Paz", ve: "America/Caracas",
  gt: "America/Guatemala", hn: "America/Tegucigalpa", sv: "America/El_Salvador",
  ni: "America/Managua", cr: "America/Costa_Rica", pa: "America/Panama",
  mx: "America/Tijuana", bz: "America/Belize", "us-east": "America/New_York",
  "us-central": "America/Chicago", "us-west": "America/Los_Angeles", ca: "America/Vancouver",
};

const DAY_MS = 86_400_000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60_000;
const EARLY_EMEA_DATE = "2026-09-24";

function dateOrdinal(dateKey) {
  return Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / DAY_MS);
}

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function datePartsInTimeZone(now, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(now));
  const value = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minute: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

function assertPacksHaveCrossedMidnight(packs, window, now) {
  // A one-time, date-bound operator request brings the noon slot forward on
  // 2026-09-24 only. It never relaxes subsequent automatic rotations.
  if (window.earlyPreview) return;
  const notReady = packs.map((pack) => {
    const timeZone = PACK_TIME_ZONES[pack];
    if (!timeZone) return `${pack}(缺少時區)`;
    const local = datePartsInTimeZone(now, timeZone);
    return local.date === window.localDate && local.minute >= 60
      ? null : `${pack}(${local.date} ${String(Math.floor(local.minute / 60)).padStart(2, "0")}:${String(local.minute % 60).padStart(2, "0")})`;
  }).filter(Boolean);
  if (notReady.length) throw new Error(`尚未安全跨日，拒絕派送：${notReady.join("、")}`);
}

function assignmentsFor(agentIds, window, cycle, now) {
  const routes = ROUTES[window.slot];
  let selected;
  if (agentIds.length === routes.length) {
    selected = mod(cycle, 2) ? [...routes].reverse() : routes;
  } else {
    const packs = routes.flatMap((route) => route.packs).sort((left, right) =>
      (PACK_CITY_COUNTS[right] ?? 0) - (PACK_CITY_COUNTS[left] ?? 0) ||
      left.localeCompare(right));
    selected = agentIds.map((_, index) => ({
      id: `${window.slot}-balanced-${index + 1}`,
      label: `${window.slot} 均衡路線 ${index + 1}`,
      packs: [], cityCount: 0,
    }));
    for (const pack of packs) {
      const count = PACK_CITY_COUNTS[pack];
      if (!count) throw new Error(`輪替城市數未設定：${pack}`);
      const route = selected.reduce((smallest, candidate) =>
        candidate.cityCount < smallest.cityCount ? candidate : smallest);
      route.packs.push(pack);
      route.cityCount += count;
    }
    if (mod(cycle, 2)) selected.reverse();
  }
  for (const route of selected) assertPacksHaveCrossedMidnight(route.packs, window, now);
  return agentIds.map((agentId, index) => ({ agentId, ...selected[index] }));
}

export function rotationWindow(now = Date.now()) {
  const taipei = new Date(now + TAIPEI_OFFSET_MS);
  const minute = taipei.getUTCHours() * 60 + taipei.getUTCMinutes();
  const today = taipei.toISOString().slice(0, 10);
  let localDate = today;
  let slot = "asia";
  let slotIndex = 0;
  let nextDate = today;
  let nextMinute = ROTATION_SWITCH_MINUTES[1];
  if (minute < ROTATION_SWITCH_MINUTES[0]) {
    localDate = new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
    slot = "americas";
    slotIndex = 2;
    nextMinute = ROTATION_SWITCH_MINUTES[0];
  } else if (minute >= ROTATION_SWITCH_MINUTES[2]) {
    slot = "americas";
    slotIndex = 2;
    nextDate = new Date(Date.parse(`${today}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
    nextMinute = ROTATION_SWITCH_MINUTES[0];
  } else if (minute >= ROTATION_SWITCH_MINUTES[1]) {
    slot = "emea";
    slotIndex = 1;
    nextMinute = ROTATION_SWITCH_MINUTES[2];
  }
  const earlyPreview = today === EARLY_EMEA_DATE &&
    minute >= 10 * 60 && minute < ROTATION_SWITCH_MINUTES[1];
  if (earlyPreview) {
    slot = "emea";
    slotIndex = 1;
    nextMinute = ROTATION_SWITCH_MINUTES[2];
  }
  const dayOffset = dateOrdinal(localDate) - dateOrdinal(ROTATION_EPOCH_DATE);
  return {
    scheduleDate: `${localDate}-${slot}`,
    localDate, slot, slotOffset: dayOffset * 3 + slotIndex, dayOffset,
    earlyPreview,
    nextSwitchAt: Date.parse(`${nextDate}T00:00:00Z`) + nextMinute * 60_000 - TAIPEI_OFFSET_MS,
  };
}

export function planDailyRotation(agentIds, now = Date.now()) {
  const agents = [...new Set(agentIds.map(String).filter(Boolean))].sort();
  const window = rotationWindow(now);
  if (!agents.length) return { ...window, assignments: [] };
  if (agents.length > 4) throw new Error("自動輪替最多支援 4 個啟用 Agent");
  return {
    ...window, cycle: window.dayOffset, dayIndex: 0,
    assignments: assignmentsFor(agents, window, window.dayOffset, now),
  };
}

export function planManualRedeploy(agentIds, now = Date.now()) {
  const agents = [...new Set(agentIds.map(String).filter(Boolean))].sort();
  const window = rotationWindow(now);
  if (!agents.length) return { ...window, assignments: [] };
  if (agents.length > 4) throw new Error("手動重新分配最多支援 4 個啟用 Agent");
  return {
    ...window, cycle: window.dayOffset + 1, dayIndex: 0,
    assignments: assignmentsFor(agents, window, window.dayOffset + 1, now)
      .map((route) => ({ ...route, id: `${route.id}-manual` })),
  };
}
