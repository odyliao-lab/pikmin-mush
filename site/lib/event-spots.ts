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

// Current-year claim window, not the termination of this permanent annual event.
// Preserve the user's 10:00 local start and disclose the official 09:00 discrepancy.
const oceanExpo = (id: string, name: string, lat: number, lng: number, reward: string, postcard = false) => limited({
  id: `jp-ocean-expo-mini-walk-${id}`, country: "日本", city: "沖繩－海洋博公園",
  name: `海洋博公園漫步各地迷你活動 — ${name}`, lat, lng,
  rewardKind: postcard ? "mixed" : "gold_seedling", rewardSummary: reward,
  startAt: seconds("2026-10-07T10:00:00+09:00"), endAt: seconds("2026-12-31T23:59:59+09:00"),
  cooldownNote: "每個曆年可參加 1 次；各特殊地點與任務獎勵各領取 1 次；次年 1/1 00:00 可再參加",
  eligibilityNote: "常設活動；本列為 2026 年度領取期限。使用者提供日本時間 10/07 10:00 開始（台灣 09:00），官方公告為日本時間 09:00；年度截止日本 12/31 23:59（台灣 22:59）。需親自到場、使用 v154 以上；滑動 4 個特殊地點的任務獎勵為藍色金色禮物貼紙金色花苗，並非每個點位獎勵。",
  coordinateNote: "座標與各地點獎勵由使用者提供，非官方精確座標；尚未實地複核，請以遊戲地圖確認",
  verificationStatus: "community", sourceTitle: "Pikmin Bloom 海洋博公園漫步各地迷你活動官方公告；點位與獎勵由使用者提供",
  sourceUrl: "https://pikminbloom.com/zh_hant/news/oct26-oceanexpominiwalk", lastVerifiedAt: seconds("2026-10-09T00:00:00Z"),
});

// Melbourne is on AEDT (UTC+11) during this event; GPS is user-supplied.
const paxAus = (id: string, venue: string, lat: number, lng: number, reward: string, ticketed: boolean) => limited({
  id: `au-melbourne-pax-2026-${id}`, country: "澳洲", city: "墨爾本 Melbourne",
  name: `PAX Aus 2026 — ${venue}`, lat, lng, rewardKind: "gold_seedling",
  rewardSummary: `${reward}飾品金色花苗`,
  startAt: seconds("2026-10-09T10:00:00+11:00"), endAt: seconds("2026-10-11T18:00:00+11:00"),
  cooldownNote: "活動期間每位玩家每個特殊地點限領 1 棵金色花苗",
  eligibilityNote: `${ticketed ? "僅限持票區域，需持票入場" : "一般大眾可前往"}；地點為墨爾本會展中心（MCEC）。墨爾本當地時間 2026/10/09 10:00–10/11 18:00（AEDT，UTC+11）；台灣時間 10/09 07:00–10/11 15:00。進入會場另有散步 2,000 步地點挑戰，獎勵為黃色金色禮物貼紙金色花苗，非本點位獎勵；活動可能變更，以遊戲與現場規則為準。`,
  coordinateNote: "精確座標由使用者提供，非官方座標；尚未實地複核，請以遊戲地圖確認",
  verificationStatus: "community", sourceTitle: "Pikmin Bloom PAX Aus 2026 官方公告；座標由使用者提供",
  sourceUrl: "https://pikminbloom.com/news/oct26-paxaus", lastVerifiedAt: seconds("2026-10-10T00:00:00Z"),
});

// Official notice/map verify the window, six venues and rewards, but publish no
// precise GPS. In particular, do not guess which indoor coordinate is spot 1/2.
const melbourneMiniWalk = (id: string, venue: string, lat: number, lng: number, reward: string, indoor = false) => limited({
  id: `au-melbourne-mini-walk-2026-${id}`, country: "澳洲", city: "墨爾本 Melbourne",
  name: `墨爾本迷你散步 MINI WALK — ${venue}`, lat, lng, rewardKind: "gold_seedling",
  rewardSummary: indoor ? "巧克力／宇宙飛船飾品金色花苗（兩點對應待確認）" : `${reward}飾品金色花苗`,
  startAt: seconds("2026-10-29T10:00:00+11:00"), endAt: seconds("2026-11-01T22:00:00+11:00"),
  cooldownNote: "整場活動每位玩家每個特殊地點限領 1 棵金色花苗，並非每日重置",
  eligibilityNote: "免費、開放所有玩家，需到特殊地點附近互動。遊戲內活動：墨爾本 AEDT（UTC+11）2026/10/29 10:00–11/01 22:00；台灣時間 10/29 07:00–11/01 19:00。主攤位在 Melbourne Central 的 Shot Tower Square；攤位當地開放時間 10/29–30 10:00–21:00、10/31–11/01 10:00–19:00（台灣分別 07:00–18:00、07:00–16:00），與遊戲內活動時段不同。依各場地實際開放與遊戲顯示為準；皮克敏顏色可能隨機。活動可能變更或取消。",
  coordinateNote: `精確座標由使用者提供，非官方 GPS，尚未實地或遊戲複核。${indoor ? "兩個 Melbourne Central 點位的獎勵對應尚未確認；官方地圖 #1：Level 1 Pikmin 攤位為宇宙飛船，#2：Level 2 Godiva 為巧克力；請以遊戲地圖辨識，並非同一點可領兩種。" : "場地與飾品依官方活動地圖核對；請以遊戲地圖確認實際互動位置。"}`,
  verificationStatus: "community", sourceTitle: "Pikmin Bloom Melbourne 2026 MINI WALK 官方公告及活動地圖；精確座標由使用者提供",
  sourceUrl: "https://pikminbloom.com/en/news/oct26-melbournecentral", lastVerifiedAt: seconds("2026-10-29T00:00:00Z"),
});

// The community coordinates match the pins on the official event map to seven decimal places.
const tokaidoStops = [
  ["tokyo", "東京站", [35.6822802, 139.7661476], "東京國立近代美術館", [35.6906377, 139.7550278]],
  ["shinagawa", "品川站", [35.6288593, 139.7379915], "Maxell Aqua Park 品川", [35.6281780, 139.7351310]],
  ["shin-yokohama", "新橫濱站", [35.5078647, 139.6170956], "新橫濱王子大飯店", [35.5101394, 139.6197957]],
  ["odawara", "小田原站", [35.2558456, 139.1563041], "小田原城（本丸廣場）", [35.2507954, 139.1540851]],
  ["atami", "熱海站", [35.1034314, 139.0782296], "來宮神社", [35.0996974, 139.0679640]],
  ["mishima", "三島站", [35.1259658, 138.9119300], "樂壽園", [35.1254127, 138.9112493]],
  ["shin-fuji", "新富士站", [35.1424522, 138.6629979], "ASTY 新富士", [35.1423371, 138.6629092]],
  ["shizuoka", "靜岡站", [34.9722261, 138.3884892], "駿府城公園（東御門）", [34.9778736, 138.3848578]],
  ["kakegawa", "掛川站", [34.7698336, 138.0148986], "掛川城公園（售票處）", [34.7746625, 138.0144413]],
  ["hamamatsu", "濱松站", [34.7042891, 137.7342601], "濱松城（天守門）", [34.7117290, 137.7251796]],
  ["toyohashi", "豐橋站", [34.7634514, 137.3827775], "Sushi & Unagi Hanego", [34.7649779, 137.3830174]],
  ["mikawa-anjo", "三河安城站", [34.9685571, 137.0605798], "ASTY 三河安城", [34.9687992, 137.0604646]],
  ["nagoya", "名古屋站", [35.1709683, 136.8831933], "則武之森", [35.1783934, 136.8814255]],
  ["gifu-hashima", "岐阜羽島站", [35.3160042, 136.6857446], "Bellmart Kiosk 岐阜羽島", [35.3160633, 136.6856561]],
  ["maibara", "米原站", [35.3144629, 136.2906111], "青岸寺", [35.3141208, 136.2951059]],
  ["kyoto", "京都站", [34.9862168, 135.7587771], "京都鐵道博物館", [34.9866399, 135.7416907]],
  ["shin-osaka", "新大阪站", [34.7329765, 135.4999923], "大阪梅田原創混合果汁（Eki Marche 新大阪外店）", [34.7335110, 135.5012965]],
] as const;

const tokaidoSpot = (id: string, name: string, [lat, lng]: readonly [number, number], postcard: string) => limited({
  id: `jp-tokaido-shinkansen-2026-${id}`,
  country: "日本",
  city: "東海道新幹線",
  name,
  lat,
  lng,
  rewardKind: "mixed",
  rewardSummary: `${postcard}；金色票券、照片鈕扣徽章花苗任務`,
  startAt: seconds("2026-11-20T00:00:00+09:00"),
  endAt: seconds("2027-02-28T23:59:59+09:00"),
  cooldownNote: "活動期間兩項任務與獎勵各限一次；每個特殊地點限領一張明信片",
  eligibilityNote: "台灣時間 2026/11/19 23:00～2027/02/28 22:59（日本時間 11/20 00:00～02/28 23:59）。走 3,000 步得金色票券金色花苗；下滑 2 個聯名特殊地點得照片鈕扣徽章大花苗，首次下滑也計入。17 座車站與 17 處周邊地點各有專屬明信片。社群另提 1 枚活動布章與 2 張額外限定明信片，領取條件待確認。請使用 v157 以上版本。",
  coordinateNote: "社群更新的座標與官方活動地圖標記一致，實際互動位置以遊戲內顯示為準。",
  verificationStatus: "official",
  sourceTitle: "Pikmin Bloom 東海道新幹線聯名官方公告與地圖",
  sourceUrl: "https://pikminbloom.com/zh_hant/news/nov26-jrtokai",
  lastVerifiedAt: seconds("2026-11-20T00:00:00+08:00"),
});

export const EVENT_SPOT_SEED: EventSpotSeed[] = [
  ...tokaidoStops.flatMap(([id, station, stationGps, nearby, nearbyGps], index) => {
    const title = `東海道新幹線 ${String(index + 1).padStart(2, "0")}｜${station}`;
    return [
      tokaidoSpot(id, title, stationGps, "本站專屬新幹線明信片"),
      tokaidoSpot(`${id}-nearby`, `${title}周邊 · ${nearby}`, nearbyGps, "周邊地點專屬明信片"),
    ];
  }),
  limited({ id: "kr-lotte-2026-jamsil", country: "韓國", city: "首爾－蠶室", name: "樂天皮克敏活動 — 蠶室（社群分享座標）", lat: 37.513180, lng: 127.101810, rewardKind: "gold_seedling", rewardSummary: "紅色照片鈕扣徽章金色花苗＋場次明信片", startAt: seconds("2026-11-13T10:30:00+09:00"), endAt: seconds("2026-11-22T20:30:00+09:00"), cooldownNote: "官方寫每位玩家整個活動期間限領1株；跨場是否共用次數以遊戲為準", eligibilityNote: "台灣時間11/13–11/22，每日09:30–19:30（韓國10:30–20:30）。Lotte World Mall B1 Event Hall，首爾松坡區Olympic-ro 300；向下滑動特殊地點領取，建議v156以上。各場徽章與明信片圖樣不同。社群圖片另提活動布章，官方公告未明列，是否可得以遊戲顯示為準。", coordinateNote: "使用者提供的Threads社群圖片（water0129）分享座標37.513180,127.101810，取代原場館參考點37.513134,127.101721；非官方GPS，尚未由本站進遊戲複核。", sourceTitle: "Pikmin Bloom樂天活動官方公告；座標來自使用者提供的water0129社群圖片", sourceUrl: "https://www.pikminbloom.com/zh_hant/news/oct26-lotte", lastVerifiedAt: seconds("2026-11-13T00:00:00+08:00") }),
  limited({ id: "kr-lotte-2026-busan-main", country: "韓國", city: "釜山", name: "樂天皮克敏活動 — 釜山本店（場館參考點）", lat: 35.156632, lng: 129.055996, rewardKind: "gold_seedling", rewardSummary: "紅色照片鈕扣徽章金色花苗＋場次明信片", startAt: seconds("2026-12-04T10:30:00+09:00"), endAt: seconds("2026-12-13T20:30:00+09:00"), cooldownNote: "官方寫每位玩家整個活動期間限領1株；跨場是否共用次數以遊戲為準", eligibilityNote: "台灣時間12/04–12/13，每日09:30–19:30。Lotte Department Store Busan B1 Event Hall，釜山鎮區Gaya-daero 772；向下滑動特殊地點領取，建議v156以上。各場徽章與明信片圖樣不同。", coordinateNote: "場館導航參考座標，非遊戲金盆精確GPS、尚未遊戲複核。公開座標來源：https://tw.pogoskill.com/pikmin-bloom/pikmin-bloom-lotte-korea-2026-guide.html", sourceTitle: "Pikmin Bloom樂天活動官方公告；座標為公開場館參考定位", sourceUrl: "https://www.pikminbloom.com/zh_hant/news/oct26-lotte", lastVerifiedAt: seconds("2026-11-12T00:00:00+08:00") }),
  limited({ id: "us-new-york-pikmin4-spaceship-202611", country: "美國", city: "紐約", name: "皮克敏4宇宙船金盆活動 — 紐約", lat: 40.75818, lng: -73.97940, rewardKind: "gold_seedling", rewardSummary: "皮克敏4宇宙船飾品金色花苗", startAt: seconds("2026-11-12T13:00:00+08:00"), endAt: seconds("2026-11-26T10:00:00+08:00"), cooldownNote: "領取次數與重置頻率未提供；請以遊戲顯示為準", eligibilityNote: "使用者提供的活動期間（台灣時間）：2026/11/12 13:00–2026/11/26 10:00；需在活動點附近，實際開放及領取條件以遊戲顯示為準", sourceTitle: "使用者提供：皮克敏4宇宙船金盆活動座標與台灣時間", sourceUrl: "", lastVerifiedAt: seconds("2026-11-12T00:00:00+08:00") }),
  limited({ id: "us-san-francisco-pikmin4-spaceship-202611", country: "美國", city: "舊金山", name: "皮克敏4宇宙船金盆活動 — 舊金山", lat: 37.78759, lng: -122.40857, rewardKind: "gold_seedling", rewardSummary: "皮克敏4宇宙船飾品金色花苗", startAt: seconds("2026-11-12T16:00:00+08:00"), endAt: seconds("2026-11-26T13:00:00+08:00"), cooldownNote: "領取次數與重置頻率未提供；請以遊戲顯示為準", eligibilityNote: "使用者提供的活動期間（台灣時間）：2026/11/12 16:00–2026/11/26 13:00；需在活動點附近，實際開放及領取條件以遊戲顯示為準", sourceTitle: "使用者提供：皮克敏4宇宙船金盆活動座標與台灣時間", sourceUrl: "", lastVerifiedAt: seconds("2026-11-12T00:00:00+08:00") }),
  melbourneMiniWalk("carlton-gardens", "Carlton Gardens（官方地圖 #6）", -37.8062290, 144.9703030, "四葉幸運草"),
  melbourneMiniWalk("state-library", "State Library Victoria（官方地圖 #3）", -37.8100005, 144.9644355, "迷你書"),
  melbourneMiniWalk("central-a", "Melbourne Central 點位 A（獎勵對應待確認）", -37.8106646, 144.9630521, "", true),
  melbourneMiniWalk("bakemono-bakers", "Bakemono Bakers（官方地圖 #4）", -37.8108850, 144.9639360, "糕點"),
  melbourneMiniWalk("central-b", "Melbourne Central 點位 B（獎勵對應待確認）", -37.8101367, 144.9631035, "", true),
  melbourneMiniWalk("hardware-societe", "Hardware Société（官方地圖 #5）", -37.8119920, 144.9604610, "下午茶"),
  paxAus("chess", "桌遊大廳（棋子）", -37.826408, 144.952772, "棋子", true),
  paxAus("popcorn", "電影院（爆米花）", -37.82472, 144.95225, "爆米花", false),
  paxAus("blue-mario", "Pikmin Bloom 攤位（藍色超級瑪利歐鑰匙圈）", -37.825547, 144.953019, "藍色超級瑪利歐鑰匙圈", false),
  paxAus("rock-game-pak", "Nintendo 攤位（岩石遊戲卡匣）", -37.825357, 144.954512, "岩石遊戲卡匣", true),
  oceanExpo("churaumi-aquarium", "沖繩美麗海水族館", 26.693512, 127.877850, "活動明信片", true),
  oceanExpo("okichan-theater", "Okichan 劇場", 26.692926, 127.875831, "活動明信片", true),
  oceanExpo("okinawa-village", "沖繩鄉土村", 26.690939, 127.877518, "夏季貼紙飾品金色花苗"),
  oceanExpo("tropical-dream-center", "熱帶夢幻中心", 26.687729, 127.876157, "紅色照片鈕扣徽章飾品金色花苗"),
  oceanExpo("oceanic-culture-museum", "海洋文化館", 26.690656, 127.877971, "珊瑚飾品金色花苗"),
  oceanExpo("emerald-beach", "翡翠海灘", 26.698471, 127.878590, "衝浪板鑰匙圈飾品金色花苗"),
  oceanExpo("sunset-square", "夕陽廣場", 26.684883, 127.875184, "活動明信片", true),
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
