# 全球多 Agent 蘑菇掃描 — 後續開發設計規格

> 狀態：Design v1  
> 基礎版本：Agent Fleet v2（implementation baseline `9976bf5`）  
> 對象：Claude / 後續維護者

---

## 1. 目標

將目前「多 Agent 平行處理單一 scan job」演進成可長期運行的全球城市掃描平台。

目標能力：

- 5–20 個 Android Agent 起步，未來可再擴充。
- 50+ 國家、數百至數千主要城市。
- 多個 campaign 同時存在，例如東亞、歐洲、北美、南美。
- 依資料新鮮度、優先級、Agent 區域與移動成本派工。
- Agent 當機、離線、停用或軟封時自動轉移。
- 可查看每國、每城市、每 Agent 的更新時效與吞吐量。
- 不讓單一大型 job 或單一 D1 request 成為擴充瓶頸。
- v2 Agent 可持續運作，未完成節點可逐步升級。

---

## 2. 非目標

近期不做：

- 不直接模擬或逆向重建遊戲後端 client。
- 不讓 Codex Sites 執行 Android 遊戲。
- 不保證掃描所有地球座標；以主要城市和高價值區域為主。
- 不以無限制提高移動速度換取更新率。
- 不自動建立或管理遊戲帳號。
- 不一次移除 v1 相容 API。

---

## 3. 現況與缺口

### 現況

- 一個 `scan_jobs` active job。
- job 內有完整 `plan_json`。
- plan 一次 materialize 成所有 `scan_targets`。
- 多 Agent 用 lease 平行 claim。
- target 按 region tag、距離與 sequence 排序。
- loop 完成後重設相同 targets。

### 全球化缺口

1. 無法同時執行歐洲、亞洲、美洲不同 campaign。
2. 大 plan 同步 INSERT，規模受限。
3. 國家資料寫在 TypeScript，維護大量城市不方便。
4. 只有 target 完成數，缺乏城市 freshness。
5. region tag 是 soft preference，沒有 assignment policy。
6. 沒有 Agent 獨立 command queue、token rotate 與事件歷史。
7. 沒有 API 級自動化整合測試。
8. 沒有長時間雙實機 soak test。

---

## 4. 建議目標架構

```text
Country Catalog
      ↓
Campaigns ──> Regions / Cities ──> Lazy Target Windows
                                        ↓
                                  Priority Scheduler
                             ┌───────────┼───────────┐
                             ↓           ↓           ↓
                          Agent A     Agent B     Agent C
                             ↓           ↓           ↓
                        Upload + ACK + Agent Events
                                        ↓
                         Mushrooms / Freshness / Metrics
```

核心原則：

- Campaign 與 target 分離。
- 城市是長期資產，target 是短期工作。
- 不一次產生全世界所有 target。
- 排程以 freshness 與移動成本為中心。
- 所有 claim 都必須有 lease 與冪等 token。

---

## 5. 國家與城市資料規格

### 5.1 從 TypeScript 拆成版本化資料

建議：

```text
site/data/catalog/
  countries.json
  asia/jp.json
  europe/fr.json
  europe/de.json
  north-america/us.json
  ...
```

### 5.2 Country

```ts
type CountryDefinition = {
  id: string;           // ISO 3166-1 alpha-2，小寫，例如 "fr"
  nameZh: string;
  nameEn: string;
  continent: string;    // europe / asia / north-america ...
  enabled: boolean;
  defaultPriority: number;
  defaultRadiusKm: number;
  defaultGridStepM: number;
  citiesFile: string;
};
```

### 5.3 City

```ts
type CityDefinition = {
  id: string;           // 穩定 ID，例如 "fr-paris"
  countryId: string;
  nameZh: string;
  nameEn: string;
  lat: number;
  lng: number;
  tier: 1 | 2 | 3;      // 城市重要性
  radiusKm?: number;
  gridStepM?: number;
  priority?: number;
  enabled: boolean;
  timezone?: string;
};
```

規則：

- ID 一經發布不可因翻譯改名。
- UI 顯示名稱與排程識別碼分離。
- CI 驗證座標範圍、重複 ID、國家引用與城市數。
- catalog 應附 `version`，讓 job 記錄建立時使用的版本。

---

## 6. 建議 D1 v3 模型

不要直接刪現有表；先新增並雙寫。

### `scan_campaigns`

```text
id
name
status              draft / active / paused / completed / cancelled
mode                once / continuous
priority
country_ids_json
policy_json
catalog_version
created_at / updated_at
```

### `scan_regions`

每個城市或 bbox 一筆：

```text
id
campaign_id
country_id
city_id
name
lat_min / lat_max / lng_min / lng_max
priority
desired_refresh_s
last_started_at
last_completed_at
last_success_at
next_due_at
failure_streak
status
```

### `scan_targets`

沿用但增加：

```text
campaign_id
region_id
generation
priority
due_at
distance_bucket
last_agent_id
```

不要讓 `(job_id, sequence)` 成為長期全域識別；v3 使用穩定 target UUID 或
`region_id + generation + point_index`。

### `agent_assignments`

```text
agent_id
scope_type           continent / country / campaign
scope_id
mode                 prefer / allow / deny / exclusive
priority_bonus
created_at
```

### `agent_commands`

每 Agent 獨立命令：

```text
id
agent_id
op                   restart / sync / status / upgrade / stop-after-target
args_json
status
created_at
claimed_at
completed_at
result_json
```

### `agent_events`

保留有限期限：

```text
id
agent_id
job_id
target_id
level
event_type
message
metrics_json
created_at
```

### `city_freshness`

可由 scan_regions 派生，也可做快取：

```text
city_id
last_scan_at
last_success_at
mushrooms_seen
avg_duration_s
failure_streak
freshness_score
```

---

## 7. Scheduler v3

### 7.1 Claim 輸入

- Agent ID
- 目前 GPS
- assignment policies
- 最近跨城市時間
- failure/softban state
- capability/version

### 7.2 Candidate 篩選

先 hard filter：

1. campaign active
2. target queued 且 due
3. 不在 deny scope
4. Agent 版本符合最低要求
5. 無其他有效 lease

### 7.3 評分

建議：

```text
score =
  campaign_priority
  + region_priority
  + overdue_seconds * freshness_weight
  + assignment_bonus
  - estimated_travel_seconds * travel_weight
  - recent_failure_penalty
  - softban_risk_penalty
```

使用可解釋分數；將主要分項寫入 claim event，方便調整。

### 7.4 區域黏著

Agent 進入一座城市後，優先完成該城市鄰近 targets，避免：

- 每點跨城市；
- 過多速度提示；
- 冷卻時間浪費；
- 多 Agent 在同一城市交錯。

可給 Agent 一個短期 region lease，再由它 claim region 內 point lease。

### 7.5 Work stealing

- prefer scope 沒有到期工作時，可接 allow scope。
- exclusive scope 不允許其他 Agent 接手，除非 owner 離線超過設定時間。
- Agent 掉線後先等待 lease expiry，再開放其他 Agent。

---

## 8. Lazy materialization

目前一次最多 10,000 targets。全球化改為：

1. campaign 建立 scan_regions，不立即產生所有 points。
2. scheduler 保持每個 active region 只有有限 window，例如 50–200 queued targets。
3. window 低於 threshold 時再補。
4. region 完成後計算下一次 `next_due_at`。
5. continuous campaign 只更新 generation，不批次 reset 全世界 targets。

驗收：

- 建立 1,000 城市 campaign 的 API 回應應小於 2 秒。
- 不應在單一 HTTP request 寫入數萬列。
- 中途部署或 worker retry 不得產生重複 target。

---

## 9. Agent v3 建議

保持 v2 endpoint 不變，新增：

```text
GET  /api/agent/v3/task
GET  /api/agent/v3/control
POST /api/agent/v3/ack
POST /api/agent/v3/heartbeat
GET  /api/agent/v3/command
POST /api/agent/v3/command-ack
```

### v3 task 建議 JSON

Tab 格式對 shell 簡單，但擴欄位脆弱。v3 可回小型 JSON：

```json
{
  "job_id": 123,
  "target_id": "uuid",
  "lease_token": "...",
  "lease_expires_at": 1780000000000,
  "location": {"lat": 48.85, "lng": 2.35},
  "country_id": "fr",
  "city_id": "fr-paris",
  "timing": {"cooldown_s": 45, "dwell_s": 8, "hop_delay_s": 2},
  "policy": {"restart_on_empty": true}
}
```

Android `/system/bin/sh` 沒有保證具備 `jq`；若採 JSON，Agent 需：

- 內建可靠 parser；或
- 模組附帶 toybox 相容 parser；或
- 保留 v2 Tab protocol。

不要用脆弱的 grep/sed 解析任意 JSON。

---

## 10. Agent 生命週期與安全

### 10.1 Enrollment

目前後台回傳一次性 Token。v3 建議：

- 顯示 created_at、last_used_at。
- Token rotate，舊 Token 有短暫 grace period。
- revoke，不只 enabled=false。
- 顯示 token fingerprint，不顯示 hash。
- 可設定最低 Agent 版本。

### 10.2 升級

不可直接讓雲端下載任意 shell 並 root 執行。若做遠端更新：

- manifest 簽章；
- SHA-256；
- allowlisted release URL；
- staged rollout；
- rollback；
- Agent 必須在 target 邊界更新。

### 10.3 Rate limit

- Agent ID + IP + token fingerprint。
- task polling 可使用 adaptive backoff。
- 無 active campaign 時由 2 秒退到 10–30 秒。
- 避免每次 poll 都做 D1 write；目前已有約 5 秒 heartbeat 節流。

---

## 11. 觀測與後台

### Fleet 頁面

- 在線／離線／停用／softban suspect。
- 最後心跳、版本、GPS、目前城市與 target。
- 最近成功擷取時間。
- 每小時 points、rows、bytes。
- 空 capture 比例與 recovery 次數。
- 重啟遊戲次數。
- Token fingerprint 與 rotate/revoke。

### 世界新鮮度頁面

- 國家／城市最後成功時間。
- 綠：在 SLA 內。
- 黃：接近過期。
- 紅：超過 SLA。
- 灰：從未掃描。

### Campaign 頁面

- 完成率不能只看 points；要顯示 region 與 freshness。
- active leases。
- queue depth。
- failed targets。
- 平均與 P95 target duration。

---

## 12. 歐美擴充順序

先用 Tier 1 城市驗證，不要一開始塞入所有行政區。

### Wave 1

- 美國
- 加拿大
- 英國
- 法國
- 德國
- 西班牙
- 義大利
- 荷蘭

### Wave 2

- 葡萄牙
- 比利時
- 瑞士
- 奧地利
- 愛爾蘭
- 丹麥
- 瑞典
- 挪威
- 芬蘭
- 波蘭
- 捷克

### Wave 3

- 墨西哥
- 智利
- 哥倫比亞
- 秘魯
- 烏拉圭
- 其他有實際需求的國家

每一 wave 必須先：

1. 驗證 catalog。
2. 計算 target 數與單輪時間。
3. 確認 Agent capacity。
4. 設定城市 tier 和 refresh SLA。
5. 小範圍跑 24 小時。

---

## 13. 容量規劃

估算：

```text
target_duration =
  dwell_s
  + hop_delay_s
  + average_recovery_cost
  + average_city_cooldown_cost

fleet_points_per_hour =
  online_agents * 3600 / target_duration

refresh_period =
  total_due_targets / fleet_points_per_hour
```

不能只用理論 dwell。實際 recovery restart 約增加 32 秒，且目前不少點需要 recovery。

後台應以真實歷史建立：

- 每 Agent points/hour
- 每 country points/hour
- recovery rate
- empty capture rate
- city transition cost

再決定要增加城市或 Agent。

---

## 14. 測試規格

### 單元測試

- catalog schema validation。
- grid 邊界與極區經度。
- distance/cooldown。
- scheduler score。
- token hash/authorization。
- stale lease。
- duplicate ACK。
- failed target retry 上限。
- loop generation。

### D1 整合測試

- 10 個 Agent 同時 claim，target 不重複。
- Agent 重複 claim 取得原 lease。
- lease expiry 後另一 Agent reclaim。
- disable Agent 立即釋放。
- pause 不遺失 lease。
- stop 取消 queued/leased。
- ACK retry 冪等。
- Worker 同時 claim 競態。
- active legacy job migration。

### 實機測試

- 兩台不同 `AGENT_ID` 同時掃。
- TSV offset 完全獨立。
- 一台拔網路，另一台接手。
- 一台遊戲崩潰，自動恢復。
- pause 5 分鐘再 resume。
- Token revoke。
- Agent 更新與 rollback。

### Soak test

至少 24 小時：

- 無重複父 Agent 程序。
- 無永久 leased target。
- 無無限 cycle 增長。
- API error rate 可接受。
- D1 queue depth 不持續上升。
- 蘑菇資料持續更新。

---

## 15. 分階段開發

### Phase 0 — 穩定現有 v2

- 建立自動 Fleet integration test。
- 第二台真實 Agent。
- 24 小時 soak。
- Agent token rotate/revoke。
- 修正所有發現的競態。

完成條件：雙實機 24 小時、無重複 target、故障接手成功。

### Phase 1 — Catalog 外部化

- ISO country ID。
- 城市 JSON schema。
- catalog validator。
- 歐洲/北美 Wave 1。
- 後台依洲別分組、搜尋與全選。

完成條件：新增國家不需修改 scheduler code。

### Phase 2 — Campaign / Region

- 多 campaign。
- scan_regions。
- hard/soft assignments。
- region freshness。
- lazy materialization。

完成條件：亞洲與歐洲 campaign 可同時運行，互不阻塞。

### Phase 3 — Scheduler v3

- freshness score。
- travel cost。
- region lease。
- work stealing。
- adaptive polling。

完成條件：相同 Agent 數下，跨城市冷卻時間下降，SLA 達成率提高。

### Phase 4 — Observability

- Fleet metrics。
- 世界 freshness map。
- alerting。
- Agent commands。
- staged upgrade。

完成條件：不看手機 log 也能從後台判斷故障原因。

---

## 16. Migration 與回滾

- 每次 schema 變更都產生 Drizzle migration。
- `ensureSchema()` 只作防護，不是 migration 的替代。
- 先新增表／欄位，再雙寫，最後切讀取。
- 不在同一版本刪除 v2 表與 API。
- 新 scheduler 出錯時可讓 Agent 回 v2 endpoint。
- 部署前記錄 active campaign/job/lease 數。
- 部署後先用單 Agent claim/ACK，再開放全部 Fleet。
- 手機 Agent 升級必須逐台，不可一次全部停止。

---

## 17. 不可破壞的相容性

- `mushrooms` API 與公開地圖欄位。
- `primary` legacy `AGENT_TOKEN`。
- v2 task/control/ack。
- `phone_agent` 的 offset 與 pending ACK。
- `scanner_status` 供公開地圖顯示。
- `scan_jobs.plan_json` 供既有 active job 恢復。
- `(job_id, sequence)` unique index，直到完全切換 v3。

---

## 18. Definition of Done

一項全球 Fleet 功能只有在以下全部成立時才算完成：

- lint/build/test 通過；
- migration 已產生並檢查；
- 多 Agent 競態測試通過；
- 舊 v2 Agent 不受影響；
- 正式部署 succeeded；
- 正式 API 可讀；
- 至少一個真實 Agent claim/ACK；
- 無 Token 寫入 Git 或 log；
- GitHub `HEAD == origin/main`；
- 文件同步更新；
- 有明確 rollback 方法。

---

## 19. 每日互斥區域輪替（已實作）

- 中央排程以 `Asia/Taipei` 每日 07:30 為換日界線；沒有依賴 PC 常駐排程，第一個 Agent／後台請求會以 D1 lock 補做當日唯一一次換區。
- 當日分配寫入 `scan_rotation_runs`，同一天的 Agent 只會取得互不重疊的國家包；近 5 分鐘有回報且未暫停的 Agent 清單變更時會重新平衡並結束舊工作。
- 現有三台 Agent 採 5 天一輪的 15 組區域方案，完整覆蓋目前 68 個國家／區域包、435 個主要城市；每日三組城市數差距不超過 2，下一輪反轉 Agent 分配順序。
- 換區會終止前一天未完成的 lease／job，建立當日 union job，再把每個 Agent 限制到各自的 country tags。舊工作 ACK 會 fail-closed，不會混入新工作。
- 掃描半徑、網格、停留與冷卻沿用最近一次工作參數；只替換國家包並強制當日工作持續循環。
- LINE／Discord 發報前 30 分鐘，中央可插入只允許 Agent2 領取的高優先複查 target；候選座標完成後再派回程 target，Agent2 接著領取原本未完成的正常工作。發布端 fail closed，只採用本批已完成複查且最新參加人數仍低於 5 的候選。
