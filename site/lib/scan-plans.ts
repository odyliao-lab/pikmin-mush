export type ScanRegion = {
  name: string;
  country: string;
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
};

export type ScanTarget = {
  country: string;
  city: string;
  lat: number;
  lng: number;
  regionIndex: number;
  pointIndex: number;
  cooldownS: number;
};

export type ScanConfig = {
  mode: "auto" | "custom";
  cityIds: string[];
  countryPacks: string[];
  radiusKm: number;
  gridStepM: number;
  dwellS: number;
  hopDelayS: number;
  cooldownS: number;
  loop: boolean;
  custom?: {
    latMin: number;
    latMax: number;
    lngMin: number;
    lngMax: number;
  };
};

type Center = [name: string, lat: number, lng: number];

export const CITY_CHOICES = [
  ["taipei", "台北 Taipei", "台灣", 25.020, 25.060, 121.500, 121.560],
  ["tokyo", "東京 Tokyo", "日本", 35.655, 35.705, 139.720, 139.790],
  ["seoul", "首爾 Seoul", "韓國", 37.545, 37.595, 126.950, 127.020],
  ["hong-kong", "香港 Hong Kong", "中國", 22.265, 22.315, 114.145, 114.215],
  ["singapore", "新加坡 Singapore", "新加坡", 1.270, 1.320, 103.825, 103.895],
  ["bangkok", "曼谷 Bangkok", "泰國", 13.725, 13.775, 100.500, 100.570],
  ["london", "倫敦 London", "英國", 51.485, 51.535, -0.155, -0.075],
  ["paris", "巴黎 Paris", "法國", 48.835, 48.885, 2.315, 2.385],
  ["new-york", "紐約 New York", "美國", 40.690, 40.740, -74.030, -73.950],
  ["los-angeles", "洛杉磯 Los Angeles", "美國", 34.025, 34.075, -118.280, -118.210],
  ["san-francisco", "舊金山 San Francisco", "美國", 37.750, 37.800, -122.450, -122.380],
  ["sydney", "雪梨 Sydney", "澳洲", -33.895, -33.845, 151.175, 151.245],
] as const;

const JAPAN: Center[] = [
  ["札幌 Sapporo",43.0618,141.3545],["仙台 Sendai",38.2682,140.8694],
  ["東京 Tokyo",35.6812,139.7671],["橫濱 Yokohama",35.4437,139.6380],
  ["新潟 Niigata",37.9161,139.0364],["金澤 Kanazawa",36.5613,136.6562],
  ["靜岡 Shizuoka",34.9756,138.3828],["名古屋 Nagoya",35.1815,136.9066],
  ["京都 Kyoto",35.0116,135.7681],["大阪 Osaka",34.6937,135.5023],
  ["神戶 Kobe",34.6901,135.1955],["岡山 Okayama",34.6551,133.9195],
  ["廣島 Hiroshima",34.3853,132.4553],["高松 Takamatsu",34.3428,134.0466],
  ["福岡 Fukuoka",33.5902,130.4017],["熊本 Kumamoto",32.8031,130.7079],
  ["鹿兒島 Kagoshima",31.5966,130.5571],["那霸 Naha",26.2124,127.6809],
];

const AUSTRALIA: Center[] = [
  ["雪梨 Sydney",-33.8688,151.2093],["墨爾本 Melbourne",-37.8136,144.9631],
  ["布里斯本 Brisbane",-27.4698,153.0251],["伯斯 Perth",-31.9523,115.8613],
  ["阿德雷德 Adelaide",-34.9285,138.6007],["坎培拉 Canberra",-35.2809,149.1300],
  ["黃金海岸 Gold Coast",-28.0167,153.4000],["紐卡索 Newcastle",-32.9283,151.7817],
  ["荷巴特 Hobart",-42.8821,147.3272],["達爾文 Darwin",-12.4634,130.8456],
];

const NEW_ZEALAND: Center[] = [
  ["奧克蘭 Auckland",-36.8509,174.7645],["威靈頓 Wellington",-41.2866,174.7756],
  ["基督城 Christchurch",-43.5321,172.6362],["漢密爾頓 Hamilton",-37.7870,175.2793],
  ["陶朗加 Tauranga",-37.6878,176.1651],["但尼丁 Dunedin",-45.8788,170.5028],
  ["北帕默斯頓 Palmerston North",-40.3523,175.6082],["皇后鎮 Queenstown",-45.0312,168.6626],
];

const INDIA: Center[] = [
  ["新德里 New Delhi",28.6139,77.2090],["孟買 Mumbai",19.0760,72.8777],
  ["班加羅爾 Bengaluru",12.9716,77.5946],["欽奈 Chennai",13.0827,80.2707],
  ["加爾各答 Kolkata",22.5726,88.3639],["海得拉巴 Hyderabad",17.3850,78.4867],
  ["艾哈邁達巴德 Ahmedabad",23.0225,72.5714],["浦那 Pune",18.5204,73.8567],
  ["斋浦爾 Jaipur",26.9124,75.7873],["蘇拉特 Surat",21.1702,72.8311],
  ["勒克瑙 Lucknow",26.8467,80.9462],["科欽 Kochi",9.9312,76.2673],
];

const BRAZIL: Center[] = [
  ["聖保羅 Sao Paulo",-23.5505,-46.6333],["里約熱內盧 Rio de Janeiro",-22.9068,-43.1729],
  ["巴西利亞 Brasilia",-15.7939,-47.8828],["薩爾瓦多 Salvador",-12.9777,-38.5016],
  ["福塔雷薩 Fortaleza",-3.7319,-38.5267],["貝洛奧里藏特 Belo Horizonte",-19.9167,-43.9345],
  ["瑪瑙斯 Manaus",-3.1190,-60.0217],["庫里奇巴 Curitiba",-25.4284,-49.2733],
  ["累西腓 Recife",-8.0476,-34.8770],["阿雷格里港 Porto Alegre",-30.0346,-51.2177],
  ["貝倫 Belem",-1.4558,-48.4902],["戈亞尼亞 Goiania",-16.6869,-49.2648],
];

const ECUADOR: Center[] = [
  ["基多 Quito",-0.1807,-78.4678],["瓜亞基爾 Guayaquil",-2.1710,-79.9224],
  ["昆卡 Cuenca",-2.9001,-79.0059],["聖多明各 Santo Domingo",-0.2530,-79.1754],
  ["曼塔 Manta",-0.9677,-80.7089],["洛哈 Loja",-3.9931,-79.2042],
];

const ARGENTINA: Center[] = [
  ["布宜諾斯艾利斯 Buenos Aires",-34.6037,-58.3816],["科爾多瓦 Cordoba",-31.4201,-64.1888],
  ["羅薩里奧 Rosario",-32.9442,-60.6505],["門多薩 Mendoza",-32.8895,-68.8458],
  ["拉普拉塔 La Plata",-34.9215,-57.9545],["圖庫曼 Tucuman",-26.8083,-65.2176],
  ["馬德普拉塔 Mar del Plata",-38.0055,-57.5426],["薩爾塔 Salta",-24.7821,-65.4232],
  ["聖菲 Santa Fe",-31.6333,-60.7000],["內烏肯 Neuquen",-38.9516,-68.0591],
];

export const COUNTRY_PACKS: Record<string, Center[]> = {
  日本: JAPAN,
  澳洲: AUSTRALIA,
  紐西蘭: NEW_ZEALAND,
  印度: INDIA,
  巴西: BRAZIL,
  厄瓜多: ECUADOR,
  阿根廷: ARGENTINA,
};

export const COUNTRY_PACK_LABELS = Object.entries(COUNTRY_PACKS).map(
  ([name, cities]) => ({ name, count: cities.length }),
);

function finite(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} 必須是數字`);
  return number;
}

function bounded(value: unknown, min: number, max: number, label: string) {
  const number = finite(value, label);
  if (number < min || number > max) {
    throw new Error(`${label} 必須介於 ${min} 到 ${max}`);
  }
  return number;
}

export function normalizeScanConfig(input: unknown): ScanConfig {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const mode = body.mode === "custom" ? "custom" : "auto";
  const customBody = (body.custom && typeof body.custom === "object" ?
    body.custom : {}) as Record<string, unknown>;
  const config: ScanConfig = {
    mode,
    cityIds: Array.isArray(body.cityIds) ? body.cityIds.map(String) : [],
    countryPacks: Array.isArray(body.countryPacks) ? body.countryPacks.map(String) : [],
    radiusKm: bounded(body.radiusKm ?? 2, 0.5, 10, "城市半徑"),
    gridStepM: bounded(body.gridStepM ?? 600, 100, 2000, "網格間距"),
    dwellS: bounded(body.dwellS ?? 8, 3, 120, "每點等待"),
    hopDelayS: bounded(body.hopDelayS ?? 2, 0, 60, "跳點延遲"),
    cooldownS: bounded(body.cooldownS ?? 45, 0, 300, "跨城市冷卻"),
    loop: body.loop !== false,
  };
  if (mode === "custom") {
    const latMin = bounded(customBody.latMin, -90, 90, "南界");
    const latMax = bounded(customBody.latMax, -90, 90, "北界");
    const lngMin = bounded(customBody.lngMin, -180, 180, "西界");
    const lngMax = bounded(customBody.lngMax, -180, 180, "東界");
    if (latMin > latMax || lngMin > lngMax) throw new Error("GPS 範圍上下界不正確");
    config.custom = { latMin, latMax, lngMin, lngMax };
  }
  return config;
}

function centerRegion(name: string, country: string, lat: number, lng: number, radiusKm: number) {
  const dlat = radiusKm / 111.32;
  const dlng = radiusKm / (111.32 * Math.max(0.2, Math.abs(Math.cos(lat * Math.PI / 180))));
  return { name, country, latMin: lat - dlat, latMax: lat + dlat,
    lngMin: lng - dlng, lngMax: lng + dlng };
}

function center(region: ScanRegion) {
  return {
    lat: (region.latMin + region.latMax) / 2,
    lng: (region.lngMin + region.lngMax) / 2,
  };
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const radius = 6371;
  const dlat = (b.lat - a.lat) * Math.PI / 180;
  const dlng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dlat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dlng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function optimize(regions: ScanRegion[], start?: { lat: number; lng: number } | null) {
  const remaining = [...regions];
  const ordered: ScanRegion[] = [];
  let cursor = start ?? null;
  while (remaining.length) {
    let best = 0;
    if (cursor) {
      best = remaining.reduce((winner, region, index) =>
        distanceKm(cursor!, center(region)) < distanceKm(cursor!, center(remaining[winner]))
          ? index : winner, 0);
    }
    const [region] = remaining.splice(best, 1);
    ordered.push(region);
    cursor = center(region);
  }
  return ordered;
}

function grid(region: ScanRegion, stepM: number) {
  const latCenter = (region.latMin + region.latMax) / 2;
  const latStep = stepM / 111_320;
  const lngStep = stepM / (111_320 * Math.max(0.2, Math.abs(Math.cos(latCenter * Math.PI / 180))));
  const rows = Math.max(1, Math.floor((region.latMax - region.latMin) / latStep) + 1);
  const cols = Math.max(1, Math.floor((region.lngMax - region.lngMin) / lngStep) + 1);
  const points: Array<{ lat: number; lng: number }> = [];
  for (let row = 0; row < rows; row += 1) {
    const lat = Math.min(region.latMax, region.latMin + row * latStep);
    const lngs = Array.from({ length: cols }, (_, column) =>
      Math.min(region.lngMax, region.lngMin + column * lngStep));
    if (row % 2) lngs.reverse();
    for (const lng of lngs) points.push({ lat, lng });
  }
  return points;
}

export function buildScanPlan(
  config: ScanConfig,
  currentLocation?: { lat: number; lng: number } | null,
) {
  let regions: ScanRegion[] = [];
  if (config.mode === "custom" && config.custom) {
    regions = [{ name: "自訂區域", country: "", ...config.custom }];
  } else {
    for (const id of config.cityIds) {
      const city = CITY_CHOICES.find((entry) => entry[0] === id);
      if (!city) continue;
      regions.push({ name: city[1], country: city[2], latMin: city[3],
        latMax: city[4], lngMin: city[5], lngMax: city[6] });
    }
    for (const country of config.countryPacks) {
      for (const [name, lat, lng] of COUNTRY_PACKS[country] ?? []) {
        regions.push(centerRegion(name, country, lat, lng, config.radiusKm));
      }
    }
  }
  const unique = new Map(regions.map((region) => [`${region.country}\0${region.name}`, region]));
  regions = optimize([...unique.values()], currentLocation);
  if (!regions.length) throw new Error("至少選擇一座城市或國家城市包");

  const targets: ScanTarget[] = [];
  let previous = currentLocation ?? null;
  regions.forEach((region, regionIndex) => {
    const regionCenter = center(region);
    const travelCooldown = previous
      ? Math.max(config.cooldownS, Math.min(120, distanceKm(previous, regionCenter) / 10))
      : 0;
    grid(region, config.gridStepM).forEach((point, pointIndex) => {
      targets.push({
        country: region.country,
        city: region.name,
        lat: Number(point.lat.toFixed(7)),
        lng: Number(point.lng.toFixed(7)),
        regionIndex,
        pointIndex,
        cooldownS: pointIndex === 0 ? Math.round(travelCooldown) : 0,
      });
    });
    previous = regionCenter;
  });
  if (targets.length > 10_000) {
    throw new Error(`掃描範圍產生 ${targets.length} 點，超過 10,000 點上限`);
  }
  if (config.loop && targets.length && regions.length > 1) {
    const wrap = Math.max(config.cooldownS,
      Math.min(120, distanceKm(center(regions.at(-1)!), center(regions[0])) / 10));
    targets[0].cooldownS = Math.max(targets[0].cooldownS, Math.round(wrap));
  }
  return { regions, targets };
}
