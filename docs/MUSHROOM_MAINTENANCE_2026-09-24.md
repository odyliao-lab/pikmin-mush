# 蘑菇清理與機隊警示（2026-09-24）

## 運作方式

- GitHub Actions 在 UTC 每小時的 07、22、37、52 分呼叫受專用密鑰保護的 `POST /api/controller/maintenance`。該端點只執行原本的有界清理；D1 的五分鐘租約避免跨 Worker 重複執行。
- 每小時 11 分的獨立檢查會讀取清理結果及機隊上傳狀態；清理超過 30 分鐘無成功、連續失敗兩次、仍有過期資料積壓／任一批次達上限、或有正在執行工作的 Agent 兩小時沒有獲站台接受的上傳時，透過 Discord 警示。每小時最多一次，但持續故障會重複提醒。
- `GET /api/controller/maintenance` 僅接受 controller 或專用維護密鑰；`POST` 只接受專用維護密鑰。所有回應禁止快取，且不包含憑證。
- 站台與 GitHub 分別保存相同的 `MAINTENANCE_TOKEN`／`MUSHROOM_MAINTENANCE_TOKEN`。GitHub 的 `MUSHROOM_MAINTENANCE_DISCORD_WEBHOOK` 只存 Secret，不可放入程式碼、文件或日誌。
- #108 上線時暫留地圖與上傳的背景清理作為過渡備援；#109 移除例行請求觸發路徑。由於 GitHub 新排程尚未觀測到自動觸發，#112 將安全備援限定於 Agent 上傳且清理成功時間已超過一小時的情況，最多每個 Worker isolate 五分鐘檢查一次。地圖讀取完全不觸發清理，正常情況下清理由獨立排程執行。

`uploadSilent` 表示兩小時沒有被站台接受的上傳事件，不等同於手機故障，也可能是無資料、電量保護或暫停；告警已排除停用／手動暫停 Agent，但仍需與目標 ACK、object 擷取、電量狀態交叉核對。

## 驗收

1. 未授權 GET/POST 都是 401；controller 可讀不可寫；維護密鑰可讀寫。
2. 手動執行 GitHub workflow，確認成功、D1 的 `last_succeeded_at` 更新，且沒有把密鑰印到 log。
3. 觀察至少兩次定時執行；清理後 `pending` 應下降，`consecutive_failures` 維持 0，地圖與 Agent 上傳仍正常。
4. 若 `last_batch_saturated` 長期為 true，先看 pending 與每批數字，再評估增加執行頻率或批次；不要盲目放大單次 Worker 執行量。

## 負載基準（本機，不是正式 D1）

`cd site && node scripts/benchmark-retention.mjs` 使用 SQLite 建立 60,000 蘑菇、120,000 觀測、60,000 目標歷史。單次批次結果：失效 250 筆 2.33ms；過期計數 30,000 筆 1.96ms；刪蘑菇 1,000 筆 5.14ms；刪觀測 500 筆 4.11ms；刪目標 500 筆 0.93ms。各查詢的 `EXPLAIN QUERY PLAN` 使用現有索引，未見全表掃描。這些數字只驗證 SQL 形狀；Cloudflare D1 網路、複本延遲、Worker CPU/時間限制須以實際維護回應和 Sites Worker logs 觀察。未取得 D1 Query Insights 前，不新增推測性索引。
