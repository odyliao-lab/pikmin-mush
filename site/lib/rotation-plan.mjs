import { MAX_ENABLED_AGENTS } from "./fleet-policy.mjs";
export const ROTATION_TIME_ZONE = "Asia/Taipei";
export const ROTATION_SWITCH_MINUTES = [4 * 60, 12 * 60, 20 * 60];
export const ROTATION_SWITCH_MINUTE = ROTATION_SWITCH_MINUTES[0];
export const ROTATION_EPOCH_DATE = "2026-07-22";

// Each eight-hour slot uses packs whose *least advanced* city has reached the
// selected Taipei calendar date and at least 01:00 local time. Taiwan and Japan
// remain intentionally excluded. Target leases prevent duplicate point ownership.
const ROUTES = {
  asia: [
    { id: "asia-01", label: "亞洲／大洋洲 01", packs: ["th", "my", "sg", "kh"], cityCount: 31 },
    { id: "asia-02", label: "亞洲／大洋洲 02", packs: ["au", "ph", "la"], cityCount: 35 },
    { id: "asia-03", label: "亞洲／大洋洲 03", packs: ["in", "vn", "lk", "bd"], cityCount: 51 },
    { id: "asia-04", label: "亞洲／大洋洲 04", packs: ["kr", "id", "nz", "np"], cityCount: 48 },
  ],
  emea: [
    { id: "emea-01", label: "歐洲／中東／非洲 01", packs: ["gb", "pl", "ro", "at", "pt", "tn", "il", "rs", "qa", "za", "na", "bw", "lt", "lu"], cityCount: 86 },
    { id: "emea-02", label: "歐洲／中東／非洲 02", packs: ["fr", "de", "eg", "sa", "gr", "dz", "jo", "bg", "ke", "ls", "sz", "lv", "mt"], cityCount: 73 },
    { id: "emea-03", label: "歐洲／中東／非洲 03", packs: ["se", "no", "es", "ma", "hu", "hr", "ae", "cz", "si", "ua", "zw", "zm", "ee"], cityCount: 70 },
    { id: "emea-04", label: "歐洲／中東／非洲 04", packs: ["it", "fi", "nl", "dk", "ch", "be", "is", "ie", "sk", "mz", "cy"], cityCount: 64 },
  ],
  americas: [
    { id: "americas-01", label: "美洲 01", packs: ["us-west", "ar", "ve", "bo", "sv", "bz", "do"], cityCount: 61 },
    { id: "americas-02", label: "美洲 02", packs: ["us-central", "mx", "ec", "cr", "hn", "jm"], cityCount: 63 },
    { id: "americas-03", label: "美洲 03", packs: ["us-east", "co", "ca", "pa", "gt", "pr"], cityCount: 66 },
    { id: "americas-04", label: "美洲 04", packs: ["br", "pe", "cl", "uy", "py", "ni"], cityCount: 57 },
  ],
};
export const ROTATION_DAYS = Object.values(ROUTES);

// Used for every fleet size, so no country pack is
// silently dropped just because a phone is paused or temporarily offline.
const PACK_CITY_COUNTS = {
  ua: 2, ke: 3, za: 11, na: 3, bw: 2, ls: 1, sz: 2, zw: 2, zm: 4, mz: 3,
  in: 26, kr: 15, th: 14, my: 12, sg: 1, id: 17, ph: 14, vn: 14, au: 18, nz: 12,
  br: 22, ec: 8, ar: 15, co: 12, pe: 11, cl: 12, uy: 4, py: 4, bo: 5, ve: 6,
  se: 9, no: 8, dk: 5, fi: 8, is: 4, ae: 4, sa: 5, il: 4, jo: 4, qa: 3,
  de: 14, at: 5, ch: 5, cz: 4, pl: 11, hu: 5, it: 13, es: 12, pt: 7, gr: 8,
  hr: 5, gb: 17, fr: 17, nl: 8, be: 5, ie: 6, ro: 9, bg: 4, rs: 4,
  sk: 4, si: 4, eg: 6, ma: 8, dz: 5, tn: 5, gt: 6, hn: 4, sv: 4,
  ni: 4, cr: 6, pa: 5, mx: 19, bz: 2, "us-east": 24, "us-central": 23,
  "us-west": 24, ca: 16,
  kh: 4, la: 3, lk: 5, bd: 6, np: 4,
  lt: 4, lv: 3, ee: 3, lu: 1, mt: 1, cy: 3,
  do: 5, jm: 3, pr: 3,
};

// Multi-zone packs use their westernmost/least advanced representative. The
// slot boundaries are conservative even across the catalogue's other cities.
const PACK_TIME_ZONES = {
  ua: "Europe/Kyiv", ke: "Africa/Nairobi", za: "Africa/Johannesburg",
  na: "Africa/Windhoek", bw: "Africa/Gaborone", ls: "Africa/Maseru", sz: "Africa/Mbabane",
  zw: "Africa/Harare", zm: "Africa/Lusaka", mz: "Africa/Maputo",
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
  kh: "Asia/Phnom_Penh",
  la: "Asia/Vientiane",
  lk: "Asia/Colombo",
  bd: "Asia/Dhaka",
  np: "Asia/Kathmandu",
  lt: "Europe/Vilnius",
  lv: "Europe/Riga",
  ee: "Europe/Tallinn",
  lu: "Europe/Luxembourg",
  mt: "Europe/Malta",
  cy: "Asia/Nicosia",
  do: "America/Santo_Domingo",
  jm: "America/Jamaica",
  pr: "America/Puerto_Rico",
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

function assignmentsFor(agentIds, window, cycle, now, workloads = {}) {
  const routes = ROUTES[window.slot];
  const weight = pack => workloads[pack] ?? PACK_CITY_COUNTS[pack];
  for (const pack of routes.flatMap(route => route.packs))
    if (!Number.isFinite(weight(pack)) || weight(pack) <= 0) throw new Error(`無效區域工作量：${pack}`);
  let selected;
  {
    const packs = routes.flatMap((route) => route.packs).sort((left, right) =>
      weight(right) - weight(left) ||
      left.localeCompare(right));
    selected = agentIds.map((_, index) => ({
      id: `${window.slot}-balanced-${index + 1}-${REGION_PLAN_REVISION}`,
      label: `${window.slot} 均衡路線 ${index + 1}`,
      packs: [], cityCount: 0, workload: 0,
    }));
    for (const pack of packs) {
      const count = PACK_CITY_COUNTS[pack];
      if (!count) throw new Error(`輪替城市數未設定：${pack}`);
      const route = selected.reduce((smallest, candidate) =>
        candidate.workload < smallest.workload ? candidate : smallest);
      route.packs.push(pack);
      route.cityCount += count;
      route.workload += weight(pack);
    }
    // If a future smaller slot has fewer packs than eligible Agents, share large packs
    // instead of leaving extra devices without a route. Existing country tags
    // and atomic target leases already allow two devices to consume different
    // points from one pack.
    for (const empty of selected.filter(route => !route.packs.length)) {
      const donor = selected.filter(route => route.packs.length)
        .reduce((largest, route) => route.cityCount > largest.cityCount ? route : largest);
      const pack = donor.packs[0];
      const participants = selected.filter(route => route.packs.includes(pack));
      empty.packs.push(pack);
      for (const route of [...participants, empty]) {
        route.cityCount = PACK_CITY_COUNTS[pack] / (participants.length + 1);
        route.workload = weight(pack) / (participants.length + 1);
        route.label += "（共享國家包，獨立掃描點）";
      }
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

export function planDailyRotation(agentIds, now = Date.now(), workloads = {}) {
  const agents = [...new Set(agentIds.map(String).filter(Boolean))].sort();
  const window = rotationWindow(now);
  if (!agents.length) return { ...window, assignments: [] };
  if (agents.length > MAX_ENABLED_AGENTS) throw new Error(`自動輪替最多支援 ${MAX_ENABLED_AGENTS} 個啟用 Agent`);
  return {
    ...window, cycle: window.dayOffset, dayIndex: 0,
    assignments: assignmentsFor(agents, window, window.dayOffset, now, workloads),
  };
}

export function planManualRedeploy(agentIds, now = Date.now(), workloads = {}) {
  const agents = [...new Set(agentIds.map(String).filter(Boolean))].sort();
  const window = rotationWindow(now);
  if (!agents.length) return { ...window, assignments: [] };
  if (agents.length > MAX_ENABLED_AGENTS) throw new Error(`手動重新分配最多支援 ${MAX_ENABLED_AGENTS} 個啟用 Agent`);
  return {
    ...window, cycle: window.dayOffset + 1, dayIndex: 0,
    assignments: assignmentsFor(agents, window, window.dayOffset + 1, now, workloads)
      .map((route) => ({ ...route, id: `${route.id}-manual` })),
  };
}

// The operator requested deployment now, but a fleet-wide redistribution only
// at the next regular switch. This date-bound hold expires at 20:00 Taipei;
// ordinary roster balancing and explicit manual redeploy remain unchanged later.
export const REGION_PLAN_REVISION = "20261118-three-slot-city-expansion";
export const REGION_EXPANSION_EFFECTIVE_AT = Date.parse("2026-10-30T20:00:00+08:00");
export function holdCurrentRegionAssignments(now = Date.now()) {
  return now < REGION_EXPANSION_EFFECTIVE_AT &&
    rotationWindow(now).scheduleDate === "2026-10-30-emea";
}
