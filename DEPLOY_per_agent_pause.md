# 部署 Runbook：後台每-agent 暫停/繼續掃描

> 對象：在 Codex 環境執行部署的人（Claude Code 環境沒有 Codex Sites 部署工具，無法代跑最後上線步驟）。
> 分支：`feat/per-agent-pause-scan`（commit `5ec23c9`）
> 相關規格：[`CLAUDE_HANDOFF.md`](CLAUDE_HANDOFF.md) §11.3 部署流程、§16 驗收清單。

---

## 1. 這個功能是什麼

在管理後台 Fleet 頁面，每張 Agent 卡片新增一個乾淨的「**暫停掃描 / 繼續掃描**」開關，
和既有的「停用/啟用節點（除役）」分開：

- 暫停時：Agent **保持在線**（不像停用會變離線）、**保留 lease 與憑證**，只是拿不到新工作；
  進行中的掃描會在下一次 control polling（約 5 秒內）收到 `pause` 而停下。
- 繼續時：恢復派工。

這是雲端層的暫停，和手機端的 ADB 急停腳本
（[`phone_agent/pause-agent.ps1`](phone_agent/pause-agent.ps1)）互補。

---

## 2. 改了哪些檔案

| 檔案 | 變更 |
|---|---|
| `site/db/schema.ts` | `scan_agents` 新增 `paused` 欄位 |
| `site/drizzle/0005_military_red_hulk.sql` | migration：`ALTER TABLE scan_agents ADD paused` |
| `site/lib/cloud.ts` | `ensureSchema` 內新增自我修復的 `patchColumns`（見下方 §4） |
| `site/lib/fleet.ts` | `ScanAgentRow.paused`；`claimTask` 在 paused 時不派工但仍 touch 保持在線；`publicAgent` 輸出 `paused` |
| `site/app/api/agent/v2/control/route.ts` | Agent paused 時回 `pause` |
| `site/app/api/admin/agents/action/route.ts` | 新增 `pause` / `resume` action（只切 `paused`，保留 lease/憑證） |
| `site/app/admin/admin-client.tsx`、`admin.module.css` | 每張卡片的暫停/繼續按鈕 + 已暫停狀態 |

本機驗證：`npm run lint`、`npm test`（含 build/型別檢查）皆通過。**未跑 live 端到端**，
請務必依 §5 在部署後驗證。

---

## 3. 部署步驟（Codex Sites，依 HANDOFF §11.3）

```bash
# 0. 先合併功能分支到 main
git checkout main
git merge --no-ff feat/per-agent-pause-scan
git push origin main
git rev-parse HEAD            # 應等於 origin/main

# 1. 本機驗證
cd site
npm run lint
npm test

# 2. 打包並部署（Codex Sites）
git subtree split --prefix site       # 取得 site 子樹
# 取得短效 Sites source 憑證
# push subtree 到 Sites source main
# 使用 Sites package-site.sh
# save version → deploy saved version → poll 到 succeeded
```

部署 archive 不要提交 Git（HANDOFF §11.3）。

---

## 4. 為什麼不需要手動改 D1

此專案沒有 runtime migrate，`ensureSchema()` 用 `CREATE TABLE IF NOT EXISTS`，
**對既有表加不了欄位**。因此在 `ensureSchema` 內加了 `patchColumns()`：每個 worker isolate
第一次會嘗試 `ALTER TABLE scan_agents ADD COLUMN paused INTEGER NOT NULL DEFAULT 0`，
欄位已存在時忽略錯誤。

結果：**部署後第一個打到 API 的請求就會自動把 `paused` 欄位補進正式 D1**，
不需要手動連 D1 執行 migration。migration 0005 只是把同一件事記錄成 Drizzle 版本檔。

---

## 5. 部署後驗證（務必執行）

### 5.1 基本存活
```bash
curl -s https://mush.odyliao.cc/api/mushrooms | head
```
確認回應正常、`agent.online_count >= 1`、`status.running = true`。

### 5.2 新欄位已上線
```bash
curl -s https://mush.odyliao.cc/api/mushrooms | grep -o '"paused":[a-z]*' | head
```
應能看到 `"paused":false`（舊版沒有這個欄位）。

### 5.3 後台功能
登入 `/admin`，對 `primary` 卡片按「**暫停掃描**」：
- 卡片狀態變「已暫停」；
- 約 5 秒內手機 `agent.log` 出現 `pause`、停止推進掃描點；
- 按「**繼續掃描**」後恢復。

### 5.4 API 直接確認（用 primary 的 `AGENT_TOKEN`）
```bash
# 暫停狀態下應回 pause；繼續後回 run（或 job 已結束時回 stop）
curl -s -H "Authorization: Bearer <AGENT_TOKEN>" -H "X-Agent-Id: primary" \
  "https://mush.odyliao.cc/api/agent/v2/control?job_id=<現行job_id>&target_id=1&lease=x"
```

---

## 6. 回滾

- 這是**新增欄位 + 新增行為**，未刪改既有表或 v2 協定，向後相容。
- 若後台行為異常：重新部署上一個 saved version 即可。`paused` 欄位留著無害
  （預設 0＝不暫停），不需 down migration。
- 手機端隨時可用 `phone_agent/pause-agent.ps1` / `resume-agent.ps1` 作為不依賴後台的急停手段。

---

## 7. 目前狀態（2026-07-18）

- [x] 程式碼與 migration 完成，lint/test 通過
- [x] commit 在 `feat/per-agent-pause-scan`（`5ec23c9`），已 push 到 GitHub
- [ ] 合併到 `main`
- [ ] Codex Sites 部署
- [ ] 部署後驗證（§5）
