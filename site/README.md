# Pikmin Mushroom Radar 網站與API

這是蘑菇雷達、活動金盆、管理後台及Android Agent雲端協定的正式網站原始碼，已不是空白Vinext starter。整體架構與機隊驗收入口見 [主README](../README.md)。文件審視：2026-11-12。

## 開發入口

需求為Node.js **>=22.13.0**、npm。依 `package-lock.json` 安裝，不臨時升級依賴；實際版本以 `package.json`／lockfile為準。

```powershell
# 從repo根目錄
Set-Location .\site
Copy-Item .env.example .env.local  # 僅首次建立；已有設定不覆蓋
npm ci
npm run dev
```

Vite／Cloudflare plugin依 `.openai/hosting.json` 模擬D1 binding `DB`；本機工具狀態留在 `.wrangler/`。專案使用 `vite.config.ts`，沒有根 `wrangler.jsonc`；`.env.local` 不提交，也不複製正式token到公開工作樹。

本機不自行偽造Sites身分標頭來繞過正式登入。`ADMIN_EMAILS` 範例欄位不擴增管理權限；實際唯一管理員規則在 `lib/cloud.ts`。正式身份標頭由Sites平台注入，登入不代表每個API都接受cookie或同一憑證。

## 來源與路由

| 路徑 | 用途 |
| --- | --- |
| `app/` | Vinext／React頁面與API route handlers |
| `public/map.html` | Leaflet蘑菇地圖／清單、活動合併篩選及萬聖節／輝煌名稱 |
| `public/event-spots.html` | 活動金盆地圖與待座標卡片 |
| `lib/event-spots.ts`、`public/event-spot-notices.json` | 已定位目錄與精確GPS未定活動 |
| `lib/fleet.ts`、`fleet-policy.mjs` | Agent認證、lease與最多12個啟用節點政策 |
| `lib/scan-plans.ts`、`rotation*.mjs`／`rotation.ts` | 城市包、陸地遮罩及04／12／20時段輪替 |
| `lib/cloud.ts`、`db/schema.ts`、`drizzle/` | D1存取、schema與版本migration |
| `worker/index.ts`、`public/_headers` | Worker入口、安全標頭與固定inline-script CSP hash |
| `tests/` | Node行為／契約／資料回歸測試 |

- 公開頁面為 `/`、`/map.html`、`/event-spots`（或 `.html`）；`/admin` 需Sites身份及唯一管理員授權。
- `/api/mushrooms` 提供分頁清單；精確GPS／bbox需管理員、GPS密碼或授權controller。未授權回應不含精確座標與私有agents資料。地圖上的Agent位置來源是已派／最近target，不是裝置定位。
- `/api/event-spots` 是公開已定位目錄；網頁另外合併靜態待座標JSON，所以API筆數與畫面活動總數不同。
- `/api/agent/v2/task`、`/control`、`/ack` 與 `/api/agent/upload` 使用各Agent自己的Bearer及X-Agent-Id。
- `/api/admin/metrics`、`/api/controller/maintenance` 等授權邊界各依route實作。controller不因此取得全部admin寫入能力；401／403不換token繞過。

## 目錄、資料與修改注意

11/12目錄為57個座標點＋4張待座標卡；有效日期篩選不等於全部筆數。韓國兩點只有場館導航參考、未經遊戲複核；四張待座標卡使用null，不產生marker或GPS操作。來源官方不等於座標官方。新加坡活動日期精度不代表遊戲啟閉分鐘已公布。

修改已定位目錄必須提高 `lib/catalogue-seed.mjs` 的CATALOGUE_REVISION。D1僅接受更高revision的原子同步，舊Worker不反向覆蓋新目錄；seed惰性放在event-spots路徑，不阻斷蘑菇上傳。待座標卡屬靜態資產，日期未知保持未知。

修改map或event-spots inline script時，需同步HTML meta、`public/_headers` 及 `worker/index.ts` 的精確CSP hash，不以unsafe-inline／unsafe-eval放寬政策。保留GPS授權、分頁相容、資料欄位與既有舊版成對Agent支援。

`npm run db:generate` 是從 `db/schema.ts` 產生migration，並非正式部署或允許改寫既有migration。新schema必須與已發布資料相容；不為測試清正式DB。receipt-v1是逐台opt-in協定，站端支援不代表舊uploader已使用，見 [上傳協定](../docs/UPLOAD_RECEIPTS.md)。

## 驗證與發布

```powershell
# 在site目錄；npm test包含build及全部Node tests
npm test
# CI亦執行靜態檢查與production lockfile audit
npm run lint
node scripts/audit-lockfile.mjs
```

完整CI入口為 [security-ci.yml](../.github/workflows/security-ci.yml)，另含獨立maintenance-worker與Android測試。不要把網站測試、建置或CI視為實機native／上傳／ACK及耐久驗收。

GitHub main是唯一開發來源；Sites是發布鏡像。按 [RELEASE_GATES.md](../docs/RELEASE_GATES.md) 核對來源、測試及差異，準備精確來源與archive，以即時取得的短效credential發布到既有project。`.openai/hosting.json` 的project_id是既有網站綁定，不另建站、不改公開範圍。保留其他維護中的來源差異，不盲目覆蓋鏡像。

發布後記錄GitHub／hosting SHA、saved version與成功deployment，實際驗證公開路由、相關API及合法授權後台。舊交接的固定磁碟路徑、分支及版本僅供歷史參考。**純README修改不需要網站重新發布，即使位於site目錄。**

優先以相容的向前修正版回退。程式回退不會自動撤回已套用migration或更高revision目錄；資料撤回需明確的新revision，不能降revision或刪觀測資料。完整回退限制見release gates。
