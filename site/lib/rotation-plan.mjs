export const ROTATION_TIME_ZONE = "Asia/Taipei";
export const ROTATION_SWITCH_MINUTE = 7 * 60 + 30;
export const ROTATION_EPOCH_DATE = "2026-07-22";

// Ten balanced days cover every currently configured country pack exactly once.
// Bundles keep neighboring countries together and daily pairs differ by at most
// two cities, so two Agents receive similar workloads without sharing a region.
export const ROTATION_DAYS = [
  [
    { id: "middle-east", label: "中東五國", packs: ["ae", "sa", "il", "jo", "qa"], cityCount: 20 },
    { id: "japan", label: "日本", packs: ["jp"], cityCount: 18 },
  ],
  [
    { id: "oceania", label: "澳洲・紐西蘭", packs: ["au", "nz"], cityCount: 18 },
    { id: "south-america-south", label: "阿根廷・厄瓜多", packs: ["ar", "ec"], cityCount: 16 },
  ],
  [
    { id: "nordic-east", label: "丹麥・芬蘭・冰島", packs: ["dk", "fi", "is"], cityCount: 15 },
    { id: "southern-europe-west", label: "葡萄牙・希臘・克羅埃西亞", packs: ["pt", "gr", "hr"], cityCount: 15 },
  ],
  [
    { id: "central-america-south", label: "尼加拉瓜・哥斯大黎加・巴拿馬", packs: ["ni", "cr", "pa"], cityCount: 14 },
    { id: "southern-europe-core", label: "義大利・西班牙", packs: ["it", "es"], cityCount: 13 },
  ],
  [
    { id: "india", label: "印度", packs: ["in"], cityCount: 12 },
    { id: "brazil", label: "巴西", packs: ["br"], cityCount: 12 },
  ],
  [
    { id: "nordic-west", label: "瑞典・挪威", packs: ["se", "no"], cityCount: 12 },
    { id: "north-africa-west", label: "埃及・摩洛哥", packs: ["eg", "ma"], cityCount: 12 },
  ],
  [
    { id: "central-america-north", label: "瓜地馬拉・宏都拉斯・薩爾瓦多", packs: ["gt", "hn", "sv"], cityCount: 12 },
    { id: "us-east", label: "美國東部", packs: ["us-east"], cityCount: 12 },
  ],
  [
    { id: "us-central", label: "美國中部", packs: ["us-central"], cityCount: 12 },
    { id: "us-west", label: "美國西部", packs: ["us-west"], cityCount: 12 },
  ],
  [
    { id: "central-europe-west", label: "德國・奧地利", packs: ["de", "at"], cityCount: 11 },
    { id: "central-europe-east", label: "波蘭・匈牙利", packs: ["pl", "hu"], cityCount: 11 },
  ],
  [
    { id: "north-africa-central", label: "阿爾及利亞・突尼西亞", packs: ["dz", "tn"], cityCount: 10 },
    { id: "alpine", label: "瑞士・捷克", packs: ["ch", "cz"], cityCount: 9 },
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
    const pair = ROTATION_DAYS[mod(primaryDay + offset, ROTATION_DAYS.length)];
    const ordered = mod(cycle, 2) ? [...pair].reverse() : pair;
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
