export type EventSpotSeed = {
  id: string; country: string; city: string; name: string; lat: number; lng: number;
  spotKind: "permanent" | "limited"; rewardKind: "gold_seedling" | "mixed";
  rewardSummary: string; startAt: number; endAt: number; cooldownNote: string;
  eligibilityNote: string; coordinateNote: string;
  verificationStatus: "official" | "community";
  sourceTitle: string; sourceUrl: string; lastVerifiedAt: number;
};

const seconds = (value: string) => Math.floor(Date.parse(value) / 1000);
const sourceTitle = "午夜咖啡館｜Pikmin Bloom 金色花苗 Special Spots 清單";
const sourceUrl = "https://collectworldmap.pixnet.net/blog/posts/929003961241043773";
const lastVerifiedAt = seconds("2026-09-05T00:00:00Z");
type SpotInput = Omit<EventSpotSeed, "spotKind" | "startAt" | "endAt" | "verificationStatus" | "sourceTitle" | "sourceUrl" | "lastVerifiedAt" | "eligibilityNote" | "coordinateNote"> & Partial<Pick<EventSpotSeed, "startAt" | "endAt" | "eligibilityNote" | "coordinateNote" | "verificationStatus" | "sourceTitle" | "sourceUrl" | "lastVerifiedAt">>;

// The user selected this community list as the canonical catalogue.  The game
// map remains authoritative for interaction radius and availability.
const make = (spotKind: "permanent" | "limited", spot: SpotInput): EventSpotSeed => ({
  ...spot, spotKind, startAt: spot.startAt ?? 0, endAt: spot.endAt ?? 0,
  eligibilityNote: spot.eligibilityNote ?? "需在 Special Spot 附近，並以遊戲顯示為準",
  coordinateNote: spot.coordinateNote ?? (spot.sourceUrl === ""
    ? "使用者提供座標，尚未實地複核；請以遊戲地圖確認"
    : "來源頁列示的座標；請以遊戲地圖確認"),
  verificationStatus: spot.verificationStatus ?? "community",
  sourceTitle: spot.sourceTitle ?? sourceTitle,
  sourceUrl: spot.sourceUrl ?? sourceUrl,
  lastVerifiedAt: spot.lastVerifiedAt ?? lastVerifiedAt,
});
const permanent = (spot: SpotInput) => make("permanent", spot);
const limited = (spot: SpotInput) => make("limited", spot);

// User-supplied GPS/rewards; official notice confirms seven spots and 14-day
// cooldown. Use the official Central-time window, including the DST change:
// Oct 3 is CDT (UTC-5); Nov 1 at 18:00 is CST (UTC-6).
const nashville = (id: string, lat: number, lng: number, reward: string) => limited({
  id: `us-nashville-mini-walk-${id}`, country: "美國", city: "田納西州－納許維爾 Nashville",
  name: `田納西 MINI WALK — ${reward}`, lat, lng, rewardKind: "gold_seedling",
  rewardSummary: `${reward}飾品金色花苗`, cooldownNote: "每個地點每 14 天可領取 1 次",
  startAt: seconds("2026-10-03T10:00:00-05:00"), endAt: seconds("2026-11-01T18:00:00-06:00"),
  eligibilityNote: "官方公告（美國中部時間）：2026/10/03 10:00–2026/11/01 18:00；台灣時間：2026/10/03 23:00–2026/11/02 08:00；實際開放以遊戲為準",
  coordinateNote: "座標與飾品對應由使用者提供，非官方座標；尚未實地複核，請以遊戲地圖確認",
  verificationStatus: "community", sourceTitle: "Pikmin Bloom Nashville 2026 MINI WALK 官方公告；座標由使用者提供",
  sourceUrl: "https://pikminbloom.com/zh_hant/news/oct26-nashville", lastVerifiedAt: seconds("2026-10-02T00:00:00Z"),
});

export const EVENT_SPOT_SEED: EventSpotSeed[] = [
  nashville("gift-sticker", 36.1590240, -86.7765040, "禮物貼紙"),
  nashville("orchestra", 36.1601300, -86.7757420, "管弦樂器"),
  nashville("chocolate", 36.1609840, -86.7753650, "巧克力"),
  nashville("photo-button", 36.1624460, -86.7740530, "照片鈕扣"),
  nashville("ice-cream-2024", 36.1627440, -86.7759540, "冰淇淋2024"),
  nashville("brass", 36.1615850, -86.7778660, "銅管樂器"),
  nashville("restaurant", 36.1607850, -86.7798360, "餐廳"),
  // Nintendo permanent locations
  permanent({ id: "jp-nintendo-tokyo", country: "日本", city: "東京", name: "Nintendo TOKYO（澀谷 PARCO 6F）", lat: 35.661989, lng: 139.698784, rewardKind: "gold_seedling", rewardSummary: "任天堂直營店金色花苗", cooldownNote: "每 30 天 1 次" }),
  permanent({ id: "jp-nintendo-osaka", country: "日本", city: "大阪", name: "Nintendo OSAKA（大丸梅田店 13F）", lat: 34.70135, lng: 135.497, rewardKind: "gold_seedling", rewardSummary: "任天堂直營店金色花苗", cooldownNote: "每 30 天 1 次" }),
  permanent({ id: "jp-nintendo-kyoto", country: "日本", city: "京都", name: "Nintendo KYOTO（京都高島屋 S.C. 7F）", lat: 35.003075, lng: 135.768344, rewardKind: "gold_seedling", rewardSummary: "任天堂直營店金色花苗", cooldownNote: "每 30 天 1 次" }),
  permanent({ id: "jp-nintendo-museum", country: "日本", city: "宇治", name: "Nintendo Museum（任天堂博物館）", lat: 34.892904, lng: 135.784188, rewardKind: "mixed", rewardSummary: "博物館限定金色花苗、花牌飾品金色花苗", cooldownNote: "每 30 天 1 次", eligibilityNote: "需預約及購票入館；以遊戲顯示為準" }),
  permanent({ id: "us-nintendo-new-york", country: "美國", city: "紐約", name: "Nintendo NEW YORK（洛克斐勒中心）", lat: 40.758042, lng: -73.9786, rewardKind: "gold_seedling", rewardSummary: "任天堂直營店金色花苗", cooldownNote: "每 30 天 1 次" }),

  // Miyajima event — the selected source gives no date range.
  limited({ id: "jp-miyajima-sa-shop", country: "日本", city: "廿日市", name: "宮島 SA（下行線）特設商店", lat: 34.35412, lng: 132.31685, rewardKind: "gold_seedling", rewardSummary: "紅色照片徽章飾品金色花苗", cooldownNote: "活動全期間限領 1 次", eligibilityNote: "文章標示為活動點；請以遊戲顯示為準" }),
  limited({ id: "jp-miyajima-sa-torii", country: "日本", city: "廿日市", name: "宮島 SA（下行線）鳥居地標", lat: 34.35445, lng: 132.3164, rewardKind: "mixed", rewardSummary: "隨機顏色運勢飾品金色花苗", cooldownNote: "活動全期間限領 1 次", eligibilityNote: "文章標示為活動點；請以遊戲顯示為準" }),

  // IKEA Taiwan — marked time-limited by the selected source, without an end date.
  limited({ id: "tw-ikea-taipei-city", country: "台灣", city: "台北", name: "IKEA 台北城市店", lat: 25.053043, lng: 121.547896, rewardKind: "gold_seedling", rewardSummary: "工具飾品金色花苗", cooldownNote: "每 7 天 1 次", eligibilityNote: "文章標示為時間限定；請以遊戲顯示為準" }),
  limited({ id: "tw-ikea-neihu", country: "台灣", city: "台北", name: "IKEA 內湖店", lat: 25.061003, lng: 121.577915, rewardKind: "gold_seedling", rewardSummary: "工具飾品金色花苗", cooldownNote: "每 7 天 1 次", eligibilityNote: "文章標示為時間限定；請以遊戲顯示為準" }),
  limited({ id: "tw-ikea-xinzhuang", country: "台灣", city: "新北", name: "IKEA 新莊店", lat: 25.041472, lng: 121.465305, rewardKind: "gold_seedling", rewardSummary: "工具飾品金色花苗", cooldownNote: "每 7 天 1 次", eligibilityNote: "文章標示為時間限定；請以遊戲顯示為準" }),
  limited({ id: "tw-ikea-xindian", country: "台灣", city: "新北", name: "IKEA 新店店", lat: 24.972151, lng: 121.530928, rewardKind: "gold_seedling", rewardSummary: "工具飾品金色花苗", cooldownNote: "每 7 天 1 次", eligibilityNote: "文章標示為時間限定；請以遊戲顯示為準" }),
  limited({ id: "tw-ikea-taoyuan", country: "台灣", city: "桃園", name: "IKEA 桃園店", lat: 25.013313, lng: 121.217437, rewardKind: "gold_seedling", rewardSummary: "工具飾品金色花苗", cooldownNote: "每 7 天 1 次", eligibilityNote: "文章標示為時間限定；請以遊戲顯示為準" }),
  limited({ id: "tw-ikea-taichung", country: "台灣", city: "台中", name: "IKEA 台中店", lat: 24.14783, lng: 120.643133, rewardKind: "gold_seedling", rewardSummary: "工具飾品金色花苗", cooldownNote: "每 7 天 1 次", eligibilityNote: "文章標示為時間限定；請以遊戲顯示為準" }),
  limited({ id: "tw-ikea-chiayi", country: "台灣", city: "嘉義", name: "IKEA 嘉義城市店", lat: 23.478116, lng: 120.438024, rewardKind: "gold_seedling", rewardSummary: "工具飾品金色花苗", cooldownNote: "每 7 天 1 次", eligibilityNote: "文章標示為時間限定；請以遊戲顯示為準" }),
  limited({ id: "tw-ikea-kaohsiung", country: "台灣", city: "高雄", name: "IKEA 高雄店", lat: 22.605726, lng: 120.303909, rewardKind: "gold_seedling", rewardSummary: "工具飾品金色花苗", cooldownNote: "每 7 天 1 次", eligibilityNote: "文章標示為時間限定；請以遊戲顯示為準" }),

  // Seattle Aquarium MINI WALK, 2026-05-23 through 2026-09-07.
  limited({ id: "us-seattle-aquarium-coral", country: "美國", city: "西雅圖", name: "西雅圖水族館 MINI WALK — 珊瑚", lat: 47.607915, lng: -122.342669, rewardKind: "gold_seedling", rewardSummary: "珊瑚飾品金色花苗", cooldownNote: "每 7 天 1 次", startAt: seconds("2026-05-23T00:00:00-07:00"), endAt: seconds("2026-09-07T23:59:59-07:00") }),
  limited({ id: "us-seattle-aquarium-golden-sticker", country: "美國", city: "西雅圖", name: "西雅圖水族館 MINI WALK — 金色貼紙", lat: 47.60733, lng: -122.342643, rewardKind: "gold_seedling", rewardSummary: "金色貼紙飾品金色花苗", cooldownNote: "每 7 天 1 次", startAt: seconds("2026-05-23T00:00:00-07:00"), endAt: seconds("2026-09-07T23:59:59-07:00") }),
  limited({ id: "us-seattle-aquarium-painting", country: "美國", city: "西雅圖", name: "西雅圖水族館 MINI WALK — 彩繪", lat: 47.606748, lng: -122.341519, rewardKind: "gold_seedling", rewardSummary: "彩繪（畫布）飾品金色花苗", cooldownNote: "每 7 天 1 次", startAt: seconds("2026-05-23T00:00:00-07:00"), endAt: seconds("2026-09-07T23:59:59-07:00") }),
  limited({ id: "us-seattle-aquarium-theme-park", country: "美國", city: "西雅圖", name: "西雅圖水族館 MINI WALK — 主題樂園", lat: 47.606127, lng: -122.342523, rewardKind: "gold_seedling", rewardSummary: "主題樂園飾品金色花苗", cooldownNote: "每 7 天 1 次", startAt: seconds("2026-05-23T00:00:00-07:00"), endAt: seconds("2026-09-07T23:59:59-07:00") }),
  limited({ id: "us-seattle-aquarium-cafe", country: "美國", city: "西雅圖", name: "西雅圖水族館 MINI WALK — 咖啡廳", lat: 47.606163, lng: -122.340889, rewardKind: "gold_seedling", rewardSummary: "咖啡廳飾品金色花苗", cooldownNote: "每 7 天 1 次", startAt: seconds("2026-05-23T00:00:00-07:00"), endAt: seconds("2026-09-07T23:59:59-07:00") }),
  limited({ id: "us-seattle-aquarium-chef-hat", country: "美國", city: "西雅圖", name: "西雅圖水族館 MINI WALK — 廚師帽", lat: 47.604035, lng: -122.339552, rewardKind: "gold_seedling", rewardSummary: "廚師帽（餐廳）飾品金色花苗", cooldownNote: "每 7 天 1 次", startAt: seconds("2026-05-23T00:00:00-07:00"), endAt: seconds("2026-09-07T23:59:59-07:00") }),
  limited({ id: "us-seattle-aquarium-mini-instruments", country: "美國", city: "西雅圖", name: "西雅圖水族館 MINI WALK — 迷你樂器", lat: 47.603828, lng: -122.337651, rewardKind: "gold_seedling", rewardSummary: "迷你樂器飾品金色花苗", cooldownNote: "每 7 天 1 次", startAt: seconds("2026-05-23T00:00:00-07:00"), endAt: seconds("2026-09-07T23:59:59-07:00") }),
  limited({ id: "us-seattle-aquarium-sweets", country: "美國", city: "西雅圖", name: "西雅圖水族館 MINI WALK — 甜點店", lat: 47.603479, lng: -122.336193, rewardKind: "gold_seedling", rewardSummary: "甜點店飾品金色花苗", cooldownNote: "每 7 天 1 次", startAt: seconds("2026-05-23T00:00:00-07:00"), endAt: seconds("2026-09-07T23:59:59-07:00") }),
  limited({ id: "us-seattle-aquarium-ice-cream", country: "美國", city: "西雅圖", name: "西雅圖水族館 MINI WALK — 冰淇淋", lat: 47.60091, lng: -122.336194, rewardKind: "gold_seedling", rewardSummary: "冰淇淋飾品金色花苗", cooldownNote: "每 7 天 1 次", startAt: seconds("2026-05-23T00:00:00-07:00"), endAt: seconds("2026-09-07T23:59:59-07:00") }),

  // Seattle PAX event, 2026-09-04 through 2026-09-06 (user-provided locations).
  limited({ id: "us-seattle-pax-red-badge", country: "美國", city: "西雅圖", name: "PAX 活動金盆 — 徽章（紅色皮克敏）", lat: 47.61171612, lng: -122.3316535, rewardKind: "gold_seedling", rewardSummary: "徽章（紅色皮克敏）飾品金色花苗", cooldownNote: "重置頻率未提供；請以遊戲顯示為準", startAt: seconds("2026-09-04T00:00:00-07:00"), endAt: seconds("2026-09-06T23:59:59-07:00"), sourceTitle: "使用者提供：PAX 活動金盆座標", sourceUrl: "" }),
  limited({ id: "us-seattle-pax-mini-book", country: "美國", city: "西雅圖", name: "PAX 活動金盆 — 迷你書", lat: 47.6113093, lng: -122.3350483, rewardKind: "gold_seedling", rewardSummary: "迷你書飾品金色花苗", cooldownNote: "重置頻率未提供；請以遊戲顯示為準", startAt: seconds("2026-09-04T00:00:00-07:00"), endAt: seconds("2026-09-06T23:59:59-07:00"), sourceTitle: "使用者提供：PAX 活動金盆座標", sourceUrl: "" }),
  limited({ id: "us-seattle-pax-coffee-1", country: "美國", city: "西雅圖", name: "PAX 活動金盆 — 咖啡杯 1", lat: 47.61009846, lng: -122.3345829, rewardKind: "gold_seedling", rewardSummary: "咖啡杯飾品金色花苗", cooldownNote: "重置頻率未提供；請以遊戲顯示為準", startAt: seconds("2026-09-04T00:00:00-07:00"), endAt: seconds("2026-09-06T23:59:59-07:00"), sourceTitle: "使用者提供：PAX 活動金盆座標", sourceUrl: "" }),
  limited({ id: "us-seattle-pax-coffee-2", country: "美國", city: "西雅圖", name: "PAX 活動金盆 — 咖啡杯 2", lat: 47.61100009, lng: -122.3367215, rewardKind: "gold_seedling", rewardSummary: "咖啡杯飾品金色花苗", cooldownNote: "重置頻率未提供；請以遊戲顯示為準", startAt: seconds("2026-09-04T00:00:00-07:00"), endAt: seconds("2026-09-06T23:59:59-07:00"), sourceTitle: "使用者提供：PAX 活動金盆座標", sourceUrl: "" }),
  limited({ id: "us-seattle-pax-coffee-3", country: "美國", city: "西雅圖", name: "PAX 活動金盆 — 咖啡杯 3", lat: 47.60900736, lng: -122.3357333, rewardKind: "gold_seedling", rewardSummary: "咖啡杯飾品金色花苗", cooldownNote: "重置頻率未提供；請以遊戲顯示為準", startAt: seconds("2026-09-04T00:00:00-07:00"), endAt: seconds("2026-09-06T23:59:59-07:00"), sourceTitle: "使用者提供：PAX 活動金盆座標", sourceUrl: "" }),
  limited({ id: "us-seattle-pax-coffee-4", country: "美國", city: "西雅圖", name: "PAX 活動金盆 — 咖啡杯 4", lat: 47.60826827, lng: -122.340682, rewardKind: "gold_seedling", rewardSummary: "咖啡杯飾品金色花苗", cooldownNote: "重置頻率未提供；請以遊戲顯示為準", startAt: seconds("2026-09-04T00:00:00-07:00"), endAt: seconds("2026-09-06T23:59:59-07:00"), sourceTitle: "使用者提供：PAX 活動金盆座標", sourceUrl: "" }),
  limited({ id: "us-seattle-pax-coffee-5", country: "美國", city: "西雅圖", name: "PAX 活動金盆 — 咖啡杯 5", lat: 47.6074079, lng: -122.3389773, rewardKind: "gold_seedling", rewardSummary: "咖啡杯飾品金色花苗", cooldownNote: "重置頻率未提供；請以遊戲顯示為準", startAt: seconds("2026-09-04T00:00:00-07:00"), endAt: seconds("2026-09-06T23:59:59-07:00"), sourceTitle: "使用者提供：PAX 活動金盆座標", sourceUrl: "" }),
  limited({ id: "us-seattle-pax-lure", country: "美國", city: "西雅圖", name: "PAX 活動金盆 — 擬餌", lat: 47.60864093, lng: -122.3406847, rewardKind: "gold_seedling", rewardSummary: "擬餌飾品金色花苗", cooldownNote: "重置頻率未提供；請以遊戲顯示為準", startAt: seconds("2026-09-04T00:00:00-07:00"), endAt: seconds("2026-09-06T23:59:59-07:00"), sourceTitle: "使用者提供：PAX 活動金盆座標", sourceUrl: "" }),
  limited({ id: "us-seattle-pax-cake", country: "美國", city: "西雅圖", name: "PAX 活動金盆 — 蛋糕", lat: 47.60347, lng: -122.33618, rewardKind: "gold_seedling", rewardSummary: "蛋糕飾品金色花苗", cooldownNote: "重置頻率未提供；請以遊戲顯示為準", startAt: seconds("2026-09-04T00:00:00-07:00"), endAt: seconds("2026-09-06T23:59:59-07:00"), sourceTitle: "使用者提供：PAX 活動金盆座標", sourceUrl: "" }),

  // Hong Kong permanent locations
  permanent({ id: "hk-toysrus-harbour-city", country: "香港", city: "尖沙咀", name: "Toys \"R\" Us 尖沙咀店（海運大廈）", lat: 22.294715, lng: 114.165673, rewardKind: "gold_seedling", rewardSummary: "金色貼紙飾品金色花苗（紅／黃／藍隨機）", cooldownNote: "每天 1 次（00:00 重置）" }),
  permanent({ id: "hk-nsew-k11-musea", country: "香港", city: "尖沙咀", name: "nsew — K11 MUSEA", lat: 22.29468, lng: 114.17415, rewardKind: "gold_seedling", rewardSummary: "紅色照片鈕扣徽章飾品金色花苗", cooldownNote: "每 30 天 1 次" }),
  permanent({ id: "hk-nsew-the-wai", country: "香港", city: "大圍", name: "nsew — 圍方（The Wai）", lat: 22.37255, lng: 114.17872, rewardKind: "gold_seedling", rewardSummary: "紅色照片鈕扣徽章飾品金色花苗", cooldownNote: "每 30 天 1 次" }),
  permanent({ id: "hk-nsew-kai-tak", country: "香港", city: "九龍城", name: "nsew — 啟德體育園", lat: 22.32185, lng: 114.1953, rewardKind: "gold_seedling", rewardSummary: "紅色照片鈕扣徽章飾品金色花苗", cooldownNote: "每 30 天 1 次" }),
];
