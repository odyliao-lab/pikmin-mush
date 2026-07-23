export const ROTATION_TIME_ZONE = "Asia/Taipei";
export const ROTATION_SWITCH_MINUTE = 7 * 60 + 30;
export const ROTATION_EPOCH_DATE = "2026-07-22";

// Five balanced days cover every configured country pack exactly once.
// Each day has three non-overlapping routes of 27–31 cities, roughly twice the
// former per-Agent workload while keeping daily route sizes within two cities.
export const ROTATION_DAYS = [
  [
    { id: "global-01", label: "全球路線 01", packs: ["jp", "bo", "ae", "bg"], cityCount: 31 },
    { id: "global-02", label: "全球路線 02", packs: ["us-east", "eg", "pa", "ni", "il"], cityCount: 31 },
    { id: "global-03", label: "全球路線 03", packs: ["us-central", "ro", "cr", "sv", "ie"], cityCount: 31 },
  ],
  [
    { id: "global-04", label: "全球路線 04", packs: ["br", "nl", "tn", "hn", "is"], cityCount: 31 },
    { id: "global-05", label: "全球路線 05", packs: ["us-west", "es", "dz", "gt", "uy"], cityCount: 31 },
    { id: "global-06", label: "全球路線 06", packs: ["in", "de", "be", "cz", "jo"], cityCount: 31 },
  ],
  [
    { id: "global-07", label: "全球路線 07", packs: ["gb", "ph", "hr", "py", "qa"], cityCount: 30 },
    { id: "global-08", label: "全球路線 08", packs: ["fr", "id", "at", "si", "bz"], cityCount: 29 },
    { id: "global-09", label: "全球路線 09", packs: ["au", "co", "pt", "sk", "sg"], cityCount: 28 },
  ],
  [
    { id: "global-10", label: "全球路線 10", packs: ["mx", "it", "no", "rs"], cityCount: 27 },
    { id: "global-11", label: "全球路線 11", packs: ["ar", "ma", "pl", "dk"], cityCount: 27 },
    { id: "global-12", label: "全球路線 12", packs: ["my", "pe", "ec", "hu"], cityCount: 27 },
  ],
  [
    { id: "global-13", label: "全球路線 13", packs: ["th", "tw", "ve", "sa"], cityCount: 27 },
    { id: "global-14", label: "全球路線 14", packs: ["cl", "nz", "fi", "ch"], cityCount: 27 },
    { id: "global-15", label: "全球路線 15", packs: ["kr", "vn", "se", "gr"], cityCount: 27 },
  ],
];

const DAY_MS = 86_400_000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60_000;

function dateOrdinal(dateKey) {
  return Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / DAY_MS);
}

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

export function rotationWindow(now = Date.now()) {
  const taipei = new Date(now + TAIPEI_OFFSET_MS);
  const minute = taipei.getUTCHours() * 60 + taipei.getUTCMinutes();
  const effective = new Date(taipei.getTime() -
    (minute < ROTATION_SWITCH_MINUTE ? DAY_MS : 0));
  const scheduleDate = effective.toISOString().slice(0, 10);
  const nextLocalDate = new Date(`${scheduleDate}T00:00:00Z`);
  nextLocalDate.setUTCDate(nextLocalDate.getUTCDate() + 1);
  nextLocalDate.setUTCHours(7, 30, 0, 0);
  return {
    scheduleDate,
    dayOffset: dateOrdinal(scheduleDate) - dateOrdinal(ROTATION_EPOCH_DATE),
    nextSwitchAt: nextLocalDate.getTime() - TAIPEI_OFFSET_MS,
  };
}

export function planDailyRotation(agentIds, now = Date.now()) {
  const agents = [...new Set(agentIds.map(String).filter(Boolean))].sort();
  if (!agents.length) return { ...rotationWindow(now), assignments: [] };
  const bundles = ROTATION_DAYS.flat();
  if (agents.length > bundles.length) {
    throw new Error(`自動輪替最多支援 ${bundles.length} 個啟用 Agent`);
  }
  const window = rotationWindow(now);
  const primaryDay = mod(window.dayOffset, ROTATION_DAYS.length);
  const cycle = Math.floor(window.dayOffset / ROTATION_DAYS.length);
  const selected = [];
  for (let offset = 0; selected.length < agents.length; offset += 1) {
    const routes = ROTATION_DAYS[mod(primaryDay + offset, ROTATION_DAYS.length)];
    const ordered = mod(cycle, 2) ? [...routes].reverse() : routes;
    for (const bundle of ordered) {
      if (!selected.some((item) => item.id === bundle.id)) selected.push(bundle);
      if (selected.length === agents.length) break;
    }
  }
  return {
    ...window,
    cycle,
    dayIndex: primaryDay,
    assignments: agents.map((agentId, index) => ({ agentId, ...selected[index] })),
  };
}
