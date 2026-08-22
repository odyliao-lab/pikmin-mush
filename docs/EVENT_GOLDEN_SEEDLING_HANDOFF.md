# Pikmin Bloom 活動金盆交接手冊

本文件交接 `Pikmin 蘑菇探險隊`網站中的「活動金盆」功能。此功能與蘑菇掃描機隊無直接依賴；它提供一份**人工審核、可追溯來源**的 Pikmin Bloom Special Spot／活動金色花苗資訊地圖。

## 1. 功能目標與邊界

使用者可在公開網站開啟 `/event-spots.html`，查看活動或常設金盆點，並可：

- 以地圖和清單查看資源點。
- 依國家、有效狀態、關鍵字篩選。
- 點選清單定位地圖，或直接複製 `緯度,經度`。
- 查看獎勵、活動期間、資格／冷卻限制、座標註記，以及官方來源連結。

本功能**不是**掃描器、GPS 控制器或自動領取工具。不要加入虛擬定位、路徑規劃、靠近或自動互動等能力；位置只供使用者自行在遊戲內確認。遊戲地圖顯示與官方當期公告才是最終依據。

## 2. 使用者可見入口

- 蘑菇首頁：`/map.html` 標題列的「活動金盆」。
- 活動金盆頁：`/event-spots.html`。
- 公開資料 API：`GET /api/event-spots`。

API 查詢參數：

| 參數 | 值 | 預設 | 說明 |
| --- | --- | --- | --- |
| `status` | `active`、`all`、`ended` | `active` | `active` 包含常設點與尚未結束的限時點。 |
| `country` | 國家名稱 | 無 | 目前採用資料庫中的中文國名，例如 `日本`。 |

例如：`/api/event-spots?status=all&country=日本`

## 3. 實作位置

| 類別 | 檔案 | 用途 |
| --- | --- | --- |
| 初始資料 | `site/lib/event-spots.ts` | `EVENT_SPOT_SEED`：人工核實的官方首批資料。 |
| 資料表型別 | `site/db/schema.ts` | Drizzle 的 `eventSpots` schema。 |
| D1 初始化／種子 | `site/lib/cloud.ts` | 建表、相容性探測與安全的重複 seed。 |
| 公開 API | `site/app/api/event-spots/route.ts` | 僅讀取、無快取的資料輸出。 |
| 前台頁面 | `site/public/event-spots.html` | Leaflet 地圖、篩選、定位、GPS 複製。 |
| CSP 路由 | `site/worker/index.ts`、`site/public/_headers` | 允許此頁面已雜湊的 inline script 與 Leaflet。 |
| Migration | `site/drizzle/0011_swift_monster_badoon.sql` | 正式 D1 schema migration。 |
| 回歸測試 | `site/tests/rendered-html.test.mjs` | 入口、資料、API 和 CSP script hash 檢查。 |

## 4. 資料規格與維護原則

`event_spots` 主要欄位：

- 識別與地點：`id`、`country`、`city`、`name`、`lat`、`lng`。
- 類型與獎勵：`spot_kind`（`permanent`／`limited`）、`reward_kind`、`reward_summary`。
- 時效：`start_at`、`end_at`，Unix 秒；`0` 表示常設或未設定。
- 使用限制：`cooldown_note`、`eligibility_note`、`coordinate_note`。
- 可追溯性：`verification_status`、`source_title`、`source_url`、`last_verified_at`、`updated_at`。

新增或更新資料時必須遵守：

1. 只收錄可追溯的官方公告／官方 Help Center，或清楚標示為待人工複核的資料。不可把社群 GPS、搜尋結果摘要或掃描資料當成官方金盆點。
2. 對場館座標與遊戲內 Spot 實際點位不完全相同的案例，務必填 `coordinate_note`，明示「以遊戲地圖確認」。
3. 限時活動必填開始與結束時間；活動過期後保留資料，前台預設隱藏，但可透過 `status=all` 檢視歷史。
4. 不可暗示任一點必定可領取。獎勵條件、入館／購票、每 30 天限制或一次性活動限制都必須保留。
5. 新增 seed 後應更新 `lastVerifiedAt`；既有資料更新目前採 `INSERT OR IGNORE` 保護，不會覆寫資料庫中日後人工修正的資料。

## 5. 首批日本資料

首批資料位於 `EVENT_SPOT_SEED`，共 7 筆：

- Nintendo TOKYO、Nintendo OSAKA、Nintendo KYOTO、Nintendo FUKUOKA。
- Nintendo Museum（宇治）。
- Niantic Park（明治公園）。
- 宮島服務區 Pikmin Terrace（限時，2026-05-01 至 2027-03-31 JST）。

每筆均附 source URL。後續新增日本點時，先確認活動仍有效，再以相同資料結構加入；不要將 Sapporo Walk、合作店家或其他活動清單直接推論為「金色花苗」而未查明獎勵。

## 6. 重要：D1 migration 與 seed 的順序

部署時，Sites 可能先套用 Drizzle migration，讓 `event_spots` 表已存在。若只在「資料表不存在」時 seed，正式環境會發生 API 成功但回傳空清單的問題。

目前 `ensureSchema()` 在 schema 探測或初始化後，**一定會呼叫** `seedEventSpots(db)`；seed 使用 `INSERT OR IGNORE`，因此可安全重試，且不會覆寫既有同 ID 資料。維護時不得將這段改回僅在 `initializeSchema()` 裡執行。

## 7. 修改前台時的 CSP 注意事項

`event-spots.html` 使用嚴格 CSP。任何 inline `<script>` 變更都必須更新：

- `site/worker/index.ts` 的 `EVENT_SPOTS_SCRIPT_HASH`。
- `site/public/_headers` 的同一個 `sha256-...`。

測試會從 HTML 計算 script hash 並比對兩處設定。最安全的流程是先修改頁面，再執行：

```powershell
Set-Location site
npm test
```

若 hash 不一致，測試會失敗；不要為了省事改成 CSP `unsafe-inline`。

## 8. 驗證與部署

程式變更後至少執行：

```powershell
Set-Location site
npm test
```

部署後驗證：

```powershell
Invoke-WebRequest 'https://mush.odyliao.cc/api/event-spots?status=active' |
  Select-Object -ExpandProperty Content
Invoke-WebRequest 'https://mush.odyliao.cc/event-spots.html' |
  Select-Object -ExpandProperty StatusCode
```

預期 API 為 HTTP 200 且 `spots` 有首批資料。正式部署遵循專案既有 Codex Sites 流程：先把變更透過 PR 合併至 `main`，建立 `site/` subtree source、封裝建置產物與 migration，儲存版本、部署、輪詢成功，再以自訂網域驗證。不得在 Git、文件、聊天或程式碼中保留 Sites 短效憑證。

## 9. 建議後續工作

1. 建立受保護的後台 CRUD，讓管理者可新增／修正／下架點位，而不是只改 seed。
2. 增加 `reviewed`／`needs_review` 狀態及複核日期提醒，避免過期活動留在有效清單。
3. 擴充台灣、日本其他官方合作活動，再逐步新增其他國家；每一批先以官方來源審核。
4. 在資料量增加後加入國家／城市索引、來源篩選與輕量 API 快取，但公開 API 不可暴露管理憑證或內部掃描資料。
5. 如需要使用者回報點位，應放入獨立「待驗證」資料流，不直接併入官方清單。
