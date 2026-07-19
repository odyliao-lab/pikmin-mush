# Pikmin_Dev — Claude 接手移交清單

> 最後盤點：2026-07-18 10:06（Asia/Taipei）  
> 正式網站：<https://mush.odyliao.cc/>  
> 管理後台：<https://mush.odyliao.cc/admin>  
> GitHub：<https://github.com/odyliao-lab/pikmin-mush>  
> 實作基準 commit：`9976bf53a5945ef76289bea5dc3aa7514170c5a7`

本文件是 Claude 的第一入口。先完成「接手前檢查」，再閱讀
[`SPEC_GLOBAL_FLEET.md`](SPEC_GLOBAL_FLEET.md) 與
[`SPEC_autoscan.md`](SPEC_autoscan.md)。不要從舊的單機架構重新實作。

---

## 1. 接手前檢查（必做）

工作目錄固定使用：

```text
F:\Codex\Pikmin_Dev
```

### 1.1 同步並確認 Git

```powershell
Set-Location F:\Codex\Pikmin_Dev
git fetch origin main --prune
git status --short
git branch --show-current
git rev-parse HEAD
git rev-parse origin/main
```

驗收：

- 分支必須是 `main`。
- `git status --short` 必須為空；若不為空，先辨識變更來源，不要 reset 使用者資料。
- `HEAD` 必須等於 `origin/main`。
- 不要改回 `G:\我的雲端硬碟\Pikmin_Dev`；那是舊工作區。

### 1.2 確認正式 API 與 Agent

```powershell
$data = Invoke-RestMethod https://mush.odyliao.cc/api/mushrooms
$data.agent
$data.agents
$data.status
```

正常狀態：

- `agent.backend` 是 `agent-cloud-v2`。
- `agent.online_count >= 1`。
- `agents` 內至少有 `id = primary`，版本目前為 `2.0.0`。
- 執行掃描時 `status.source = agent-fleet-v2`、`status.running = true`。

### 1.3 確認目前裝置（需要實機維修時）

目前 ADB：

```text
C:\Program Files\Netease\MuMuPlayer\nx_main\adb.exe
```

目前序號：

```text
7lw8ibvghe6dtof6
```

檢查：

```powershell
$adb = 'C:\Program Files\Netease\MuMuPlayer\nx_main\adb.exe'
& $adb -s 7lw8ibvghe6dtof6 get-state
& $adb -s 7lw8ibvghe6dtof6 shell `
  "su -c 'ps -ef | grep pikmin_scanner_agent | grep -v grep'"
```

`agent.sh` 應只有一個父程序；它產生的短暫 `sleep`/`curl` 子程序是正常的。

---

## 2. 2026-07-18 已確認的正式狀態

盤點當下：

- Git 本機 `main` 與 GitHub `origin/main` 都在實作基準
  `9976bf53a5945ef76289bea5dc3aa7514170c5a7`。
- 工作樹乾淨。
- 正式 API 可連線。
- 公開 API 回傳 454 個有效蘑菇。
- Fleet：1/1 Agent 在線。
- `primary` Agent 版本 `2.0.0`。
- 正式循環工作正在執行，共 2,842 個 target。
- 狀態來源為 `agent-fleet-v2`，當時完成計數為 193。
- 正在掃描 `厄瓜多－曼塔 Manta`。
- 舊工作已自動轉成逐點租約佇列，掃描沒有因 v2 上線而刪除。

注意：v2 排程會按距離重新排序，手機 log 中的 target sequence 可能出現
`188 → 177 → 176`，不代表倒退；後台 `current_index` 表示「已完成數」，不是
「目前 sequence」。

---

## 3. 最終目標

使用者的終極目標：

> 同時運行多個 Android Agent，分區掃描世界主要國家與城市，提高蘑菇資料更新頻率，
> 由同一個雲端後台排程、監控、去重與呈現。

目前短中期國家包只是測試資料。未來重點是歐洲與美洲多國，架構必須能增加：

- 國家與城市數量；
- Agent 數量；
- 同時執行的區域或 campaign；
- 優先級與資料新鮮度排程；
- Agent 故障接手；
- 每國、每城市與每 Agent 的監控。

---

## 4. 現行架構

```text
                         Codex Sites / D1
                 ┌──────────────────────────┐
                 │ 公開地圖 /admin          │
                 │ scan_jobs / scan_targets │
                 │ scan_agents / mushrooms  │
                 │ 租約、派工、ACK、去重     │
                 └────────────┬─────────────┘
                              │ HTTPS
             ┌────────────────┼────────────────┐
             ↓                ↓                ↓
       Android Agent 1  Android Agent 2  Android Agent N
       Zygisk + 遊戲     Zygisk + 遊戲     Zygisk + 遊戲
       GPS override      GPS override      GPS override
             └────────────────┬────────────────┘
                              ↓
                       mushrooms.tsv 上傳
```

### 4.1 雲端端

- `site/`：Vinext/React + Cloudflare Worker。
- Codex Sites project：
  `appgprj_6a5a56aaa2e08191b31a17cdc443aa93`
- D1 binding：`DB`
- R2：未使用。
- 正式自訂網域：`mush.odyliao.cc`
- `/admin` 使用 ChatGPT Sign-in，並以 `ADMIN_EMAILS` 進行伺服器端 allowlist。
- Agent API 使用 Bearer Token；Token 不可提交 Git。

### 4.2 Android 端

- 遊戲 package：`com.nianticlabs.pikmin`
- Zygisk 模組從遊戲記憶體擷取蘑菇，寫入：

```text
/data/user/0/com.nianticlabs.pikmin/files/mushrooms.tsv
```

- GPS 控制檔：

```text
/data/user/0/com.nianticlabs.pikmin/files/teleport.txt
```

- Agent 模組：

```text
/data/adb/modules/pikmin_scanner_agent/
```

- Agent 會主動連雲端，不需要 Windows、USB、固定 IP 或同網段。

---

## 5. 先讀哪些檔案

依序閱讀：

1. `CLAUDE_HANDOFF.md`：本文件。
2. `SPEC_GLOBAL_FLEET.md`：未來全球化與多 Agent 規格。
3. `SPEC_ON_DEVICE_DISPLAY.md`：手機免電腦 virtual display、開機、恢復與多機部署規格。
4. `README.md`：專案入口。
5. `SPEC_autoscan.md`：Zygisk hook、RVA、TSV 與歷史單機規格。
6. `site/lib/fleet.ts`：v2 Agent 認證、租約與派工核心。
7. `site/lib/scan-plans.ts`：國家、城市、網格與冷卻規則。
8. `site/lib/cloud.ts`、`site/db/schema.ts`：D1 schema 與資料存取。
9. `phone_agent/agent.sh`：手機端 v2 協定與自動恢復。
10. `site/app/api/agent/v2/**`：v2 task/control/ack。
11. `site/app/admin/admin-client.tsx`：Fleet 管理後台。
12. `DEV_HISTORY.md`：走過的死路；遇到相同問題時再讀。

---

## 6. 目錄責任

| 路徑 | 責任 |
|---|---|
| `module/cpp/` | Zygisk hook、蘑菇擷取、GPS override |
| `module/arm64-v8a.so` | 目前編譯產物 |
| `phone_agent/` | Android 常駐 Agent、Magisk service |
| `site/` | 正式網站、D1、API、管理後台 |
| `scanner/` | 舊 Windows 相容／維修模式，不是正式主流程 |
| `reference/dump.cs` | IL2CPP 符號 dump |
| `site/lib/fleet.ts` | 多 Agent 排程核心 |
| `site/lib/scan-plans.ts` | 國家城市目錄與網格計畫 |
| `site/drizzle/` | D1 migrations，部署必須包含 |

---

## 7. 已完成能力

### 7.1 公開地圖

- 手機友善 Pikmin 風格。
- 僅保留等級 2–4：一般、大、巨大；等級 1 在 Agent 與雲端入口即排除。
- 蘑菇類型中文對照。
- 等級與低參加人數圖示差異。
- 清單多條件篩選、類型多選、排序。
- 預設發現時間新到舊。
- 20 秒自動刷新，預設開啟。
- 複製 GPS、複製簡短資訊。
- 國家－城市顯示。
- 參加人數、容量、總戰力、開始與結束時間、更新時間。
- 顯示掃描進度與目前城市。

### 7.2 雲端掃描後台

- ChatGPT 登入與管理員 allowlist。
- 國家包、獨立城市與自訂 bbox。
- 半徑、網格、等待、跳點延遲、跨城市冷卻與循環。
- 暫停、續跑、停止。
- Fleet 在線數、Agent 清單、版本與區域偏好。
- 建立獨立 Agent 憑證；Token 只顯示一次。
- 停用 Agent 時立即釋放其 lease。

### 7.3 多 Agent v2

- 每個 Agent 有獨立 `AGENT_ID`。
- `primary` 可繼續使用 Sites 的舊 `AGENT_TOKEN`。
- 新 Agent Token 只保存 SHA-256 hash。
- 每個 target 只能由一個 Agent 取得 lease。
- lease 為 6 分鐘；control polling 會續租。
- Agent 離線或 lease 過期會重新排隊。
- 同一 Agent 重複 claim 時先拿回自己的未過期 lease。
- ACK 使用 target ID + lease token，具備冪等與 stale 防護。
- 失敗 target 最多嘗試 3 次，之後標記 failed，避免整輪卡死。
- 停用節點會釋放工作給其他 Agent。
- 舊 `/api/agent/scan-task` 與 `/scan-ack` 仍透過 v2 lease 相容。
- 舊的 active job 若沒有 `scan_targets`，會依 checkpoint 自動 materialize。

### 7.4 Agent 自動恢復

- 遊戲不在前景時拉回前景。
- 遊戲未執行時自動啟動。
- GPS 寫入後回讀驗證。
- 自動送 Enter/DPAD Center 確認速度提示。
- 等待期間每 5 秒查詢 pause/stop 並續租。
- 沒有新增 TSV rows 時，同座標重啟遊戲 session。
- 上傳使用 byte offset；網路失敗不推進 offset。
- ACK 失敗寫入 `scan.pending`，恢復後重送。

### 7.5 手機自主虛擬顯示

- `LOCAL_DISPLAY=1` 時，由 Magisk `service.sh` 在 boot completed 後啟動 display daemon。
- scrcpy 4.1 device server 在手機本機建立 trusted、always-unlocked virtual display。
- `localvd-drain` 只連手機本機 abstract socket，不需要 PC、ADB 或網路串流。
- 遊戲在虛擬 display resumed，實體 display 可關閉或操作其他 App。
- Server／drain 死亡時，daemon 驗證 PID 身分後重建 display 並更新 `game.display`。
- Worker replacement 會等待舊程序與 display 完全消失，避免殘留 socket 或重複 display。
- `service.sh` 會先等 display healthy 才啟動 Agent，避免遊戲競態回到 display 0。
- 安裝失敗會自動設回 `LOCAL_DISPLAY=0`、停止 daemon、回到 display 0 並重啟 Agent；原始
  安裝錯誤仍會向外拋出。
- Windows 與 on-device owner 是雙向互斥；Windows scrcpy 身分必須同時符合 PID、程序名、
  ADB serial 與 serial-scoped marker。
- 已通過 Doze、ADB 中斷、server SIGKILL 與兩次 reboot 實機驗證。
- 完整架構、狀態機、安裝、故障診斷與第二 Agent 流程見 `SPEC_ON_DEVICE_DISPLAY.md`。

---

## 8. v2 Agent 協定

所有請求：

```http
Authorization: Bearer <TOKEN>
X-Agent-Id: <AGENT_ID>
X-Agent-Version: 2.0.0
```

### 8.1 Claim task

```http
GET /api/agent/v2/task
```

無工作：

```text
0<TAB>wait
```

有工作：

```text
job_id
target
target_id
sequence
total_points
lat
lng
dwell_s
hop_delay_s
cooldown_s
cycle
lease_token
country
city
```

實際以 Tab 串成一行。不可任意改欄位順序；若要升級，新增 v3 endpoint。

### 8.2 Control / lease renewal

```http
GET /api/agent/v2/control
  ?job_id=...
  &target_id=...
  &lease=...
```

回傳：

- `run`
- `pause`
- `stop`

### 8.3 ACK

```http
POST /api/agent/v2/ack
  ?job_id=...
  &target_id=...
  &lease=...
  &ok=1
  &rows=...
  &bytes=...
```

可能回傳：

- `ok`
- `duplicate`
- `retry`
- `stale`
- `stop`
- `missing`

### 8.4 TSV upload

```http
POST /api/agent/upload
Content-Type: application/octet-stream
```

每個 Agent 在 `scan_agents.partial_text` 保留未完成尾行，不能共用單一 partial buffer。

---

## 9. D1 資料模型

### `mushrooms`

蘑菇主資料，`id` primary key；不同 Agent 上傳同一 ID 時 upsert。

### `scan_agents`

Fleet 節點：

- `id`
- `display_name`
- `token_hash`
- `enabled`
- `region_tags_json`
- `agent_version`
- `last_seen`
- `current_lat/current_lng`
- `current_job_id/current_target_id`
- `uploaded_rows/uploaded_bytes`
- `partial_text`

### `scan_jobs`

目前仍是「全系統同時只有一個 active job」：

- `config_json`
- `plan_json`
- `total_points`
- `current_index`：v2 中表示完成數
- `cycle`
- `loop`
- `captured_rows/captured_bytes`

### `scan_targets`

逐點工作：

- `(job_id, sequence)` unique
- `cycle`
- `country/city/lat/lng`
- `status`：queued / leased / completed / failed / cancelled
- `lease_agent_id`
- `lease_token`
- `lease_expires_at`
- `attempts`
- `captured_rows/captured_bytes`

### `scan_logs`

每個 job 最多保留最近 300 筆 log。

### 舊表

- `agent_state`：保留 primary 舊 command API 相容。
- `scanner_status`：公開地圖右下角進度。

不要直接刪除舊表；先移除所有舊 API 與 Windows 維修依賴，再做獨立 migration。

---

## 10. 國家與城市目錄

目前唯一入口：

```text
site/lib/scan-plans.ts
COUNTRY_PACK_CATALOG
```

目前國家：

- 日本
- 印度
- 澳洲
- 紐西蘭
- 巴西
- 厄瓜多
- 阿根廷

已有少量獨立城市：台北、東京、首爾、香港、新加坡、曼谷、倫敦、巴黎、
紐約、洛杉磯、舊金山、雪梨。

短期新增國家可直接加 catalog entry；大規模歐美擴充應依
`SPEC_GLOBAL_FLEET.md` 改成 ISO code + 外部資料檔，避免 `scan-plans.ts` 無限膨脹。

---

## 11. Build、測試與部署

### 11.1 本機驗證

```powershell
Set-Location F:\Codex\Pikmin_Dev\site
npm run lint
npm test
```

Agent shell：

```powershell
Set-Location F:\Codex\Pikmin_Dev
& 'C:\Program Files\Git\bin\bash.exe' -n phone_agent/agent.sh
```

Schema 變更：

```powershell
Set-Location F:\Codex\Pikmin_Dev\site
npm run db:generate
```

必須人工檢查新 migration，不能只依賴 `ensureSchema()`。

### 11.2 GitHub

```powershell
git add <files>
git commit -m "<message>"
git push origin main
git fetch origin main
git rev-parse HEAD
git rev-parse origin/main
```

### 11.3 Codex Sites

`site/.openai/hosting.json` 已有 project ID，絕對不要再次 `create_site`。

發布順序：

1. `npm test`
2. commit GitHub
3. `git subtree split --prefix site`
4. 取得短效 Sites source credential
5. push subtree 到 Sites source `main`
6. 使用 Sites `package-site.sh`
7. save version
8. deploy saved version
9. poll 到 `succeeded`
10. 測試 `mush.odyliao.cc/api/mushrooms`

部署 archive 不要提交 Git。

### 11.4 更新手機 Agent

`service.sh` 的行為是：如果 PID 還活著就直接退出，它不是 restart 指令。

更新時：

1. push 新 `agent.sh` 到 `/data/local/tmp/`
2. root copy 到模組目錄
3. chmod 700
4. 確認目前是否有 active target
5. 安全停止舊父程序
6. 執行 `service.sh`
7. 確認只有一個父 Agent
8. log 必須顯示 `started id=... version=...`

不要同時啟動兩個相同 `AGENT_ID`，否則兩個程序會爭用同一 lease 與 offset。

### 11.5 安裝手機自主 display

每支新 ARM64 root 手機完成 Agent config/token 後執行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\phone_agent\install-local-display.ps1 `
  -Serial ANDROID_ADB_SERIAL
```

安裝器會保留 private config/token、編譯 native drain、同步部署並重啟新版 `agent.sh`、
部署 scrcpy server、設定 `LOCAL_DISPLAY=1` 並等待 healthy。On-device daemon 與 Windows
Supervisor 不可同時管理同一手機；若該 serial 的 Scheduled Task、已記錄的 Supervisor
程序或手動 headless scrcpy 仍存在，安裝器會直接拒絕部署，必須先停止並移除。反方向
安裝 Windows Supervisor 或手動啟動 `headless-agent.ps1` 時，只要 `LOCAL_DISPLAY=1` 也會拒絕。

---

## 12. Secrets 與權限

不得提交：

- `github_info.txt`
- 正式 GitHub token
- Sites source credential
- `AGENT_TOKEN`
- 新 Agent 明文 Token
- 手機端正式 `config` / `token`
- `.env`

正式 Sites variables：

- `AGENT_TOKEN`：primary legacy secret
- `ADMIN_EMAILS`：管理員 email allowlist

新 Agent token hash 存 D1，明文只在建立憑證時回傳一次。

若 Token 遺失，目前做法是停用舊 Agent，重新建立新憑證；尚未提供 rotate API。

---

## 13. 已驗證的多 Agent 測試

本機整合測試曾完成：

1. 建立第二 Agent 獨立 Token。
2. 建立 4-point custom job。
3. primary 與 secondary 同時 claim。
4. 驗證 target ID 不相同。
5. 兩邊 control 都回 `run`。
6. ACK 後完成數與 captured rows 正確。
7. pause 後 control 回 `pause`。
8. resume 後可 ACK。
9. 第二個單點 job 由 secondary claim。
10. 後台停用 secondary。
11. primary 成功 reclaim 同一 target。
12. job 完成。
13. 舊 v1 `/scan-task` 仍回 HTTP 200。

正式環境已驗證：

- primary v2 成功 claim 既有 2,842-point job。
- 舊工作自動 materialize。
- GPS 實際移動。
- recovery restart 後新增 8 rows 並 ACK。
- 隨即 claim 下一個 target。

目前只有一個真實 Android Agent；第二實體 Agent 尚未接入。

---

## 14. 已知限制與陷阱

### P0：目前只有一個 active job

`activeJob()` 只取一筆，後台也禁止建立第二個 active job。多 Agent 是平行處理同一 job，
還不是多 campaign。全球化前必須解決。

### P0：大 plan materialize 成本

目前最多 10,000 targets，建立 job 時同步分批 INSERT。50–100 國家可能超過單次
Worker request 的合理時間。需要 campaign/region 分批 materialize 或 lazy queue。

### P0：真實第二節點尚未驗證

模擬並發已通過，但尚未以第二台 Android 實測：

- 不同 token；
- 各自 TSV offset；
- 同時大距離冷卻；
- 長時間 lease renew；
- 一台掉線後另一台接手。

### `current_index` 語意已改

v1 是下一 sequence；v2 是完成數。不要用它定位當前 target。

### 距離排程會讓 sequence 看似倒退

候選 target 依區域偏好、距離、最後 sequence 排序；log sequence 不保證遞增。

### region tags 目前只是偏好

Agent 標籤不會禁止它接其他國家。需要 hard assignment 時必須新增明確 policy。

### primary manual command 是 legacy

`/api/agent/command`、controller status 仍以 `agent_state id=1` 為中心，只適合 primary。
新 Agent 目前沒有獨立 restart/status command queue。

### Agent 上線門檻

`AGENT_ONLINE_MS = 15,000`；touch 實際寫入節流為約 5 秒。

### Lease

`LEASE_MS = 6 分鐘`。目前單點最壞可能包含：

- 跨城市冷卻 120 秒；
- dwell 120 秒；
- recovery 約 32 秒；
- hop delay 60 秒。

接近 lease 上限，但 control polling 每 5 秒會續租。不可移除 interruptible wait 中的 control。

### 遊戲 session 不刷新

只寫 GPS 有時地圖不刷新。Agent 在無 rows 時必須同座標重啟遊戲，不能刪掉此恢復流程。

### Zygisk RVA 綁遊戲版本

目前 hook 基於 Pikmin Bloom v148 / versionCode 1782528808。遊戲更新後 RVA 可能全部失效。
完整細節見 `SPEC_autoscan.md`。

### g_seen / TSV

模組會去重，TSV 是累積檔。不要每點刪 TSV；曾造成 open file inode 問題與資料永久遺失。

### Secure surface

遊戲畫面截圖可能全黑；不要把影像辨識當成唯一 UI 自動化方式。

### 帳號與服務風險

定位覆寫、root、模擬器、自動化與非官方存取可能違反 Niantic 規範並造成帳號限制。
擴大 Agent 數量前，使用者需理解並自行承擔此風險。

---

## 15. Claude 第一個開發回合建議

不要立刻新增 30 個國家。第一回合建議：

1. 完整閱讀本文件與 `SPEC_GLOBAL_FLEET.md`。
2. `git fetch` 並確認 SHA。
3. 跑 lint/test/bash syntax。
4. 讀正式 public API，不要先停止現有掃描。
5. 檢查 `scan_jobs` 單 active job 限制。
6. 優先建立可重複執行的 Fleet 整合測試。
7. 接入第二台真實 Android Agent。
8. 完成 12–24 小時雙 Agent soak test。
9. 通過後才擴充歐美 country catalog。

---

## 16. 移交完成驗收清單

- [ ] Claude 使用 `F:\Codex\Pikmin_Dev`
- [ ] `HEAD == origin/main`
- [ ] 工作樹乾淨
- [ ] `npm run lint` 通過
- [ ] `npm test` 通過
- [ ] `bash -n phone_agent/agent.sh` 通過
- [ ] `mush.odyliao.cc/api/mushrooms` 正常
- [ ] primary Agent 在線且版本至少 2.0.0
- [ ] 現有 active job 未被誤停
- [ ] 沒有將任何 Token 提交 Git
- [ ] 了解 `current_index` 是完成數
- [ ] 了解 `service.sh` 不會重啟存活中的 Agent
- [ ] 了解新增國家前要先完成第二實體 Agent soak test

