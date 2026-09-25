# 蘑菇清理與機隊警示（2026-09-24）

## 運作方式

- GitHub Actions 在 UTC 每小時的 07、22、37、52 分呼叫受專用密鑰保護的 `POST /api/controller/maintenance`，避開整點附近的高負載時段。該端點只執行原本的有界清理；D1 的五分鐘租約避免跨 Worker 重複執行。
- 每小時 13 分的獨立檢查會讀取清理結果及機隊上傳狀態；清理超過 30 分鐘無成功、連續失敗兩次、**實際待刪蘑菇數大於零**、或有正在執行工作的 Agent 兩小時沒有獲站台接受的上傳時，透過 Discord 警示。單批觀測歷史刪除達上限會記錄但不單獨視為故障。Discord 傳送失敗會留下 Actions 警告及安全的 HTTP 狀態，不會把已成功的清理錯標為失敗。
- `GET /api/controller/maintenance` 僅接受 controller 或專用維護密鑰；`POST` 只接受專用維護密鑰。所有回應禁止快取，且不包含憑證。
- 站台與 GitHub 分別保存相同的 `MAINTENANCE_TOKEN`／`MUSHROOM_MAINTENANCE_TOKEN`。Discord webhook 分別放在 GitHub Secret `MUSHROOM_MAINTENANCE_DISCORD_WEBHOOK` 及 Sites Secret `MAINTENANCE_DISCORD_WEBHOOK`，不可放入程式碼、文件或日誌。
- #108 上線時暫留地圖與上傳的背景清理作為過渡備援；#109 移除例行請求觸發路徑。由於 GitHub 新排程尚未觀測到自動觸發，#112 將安全備援限定於 Agent 上傳且清理成功時間已超過一小時的情況；#114 在仍有待刪蘑菇或上一批達上限時依五分鐘 D1 租約持續追趕。地圖讀取完全不觸發清理，正常情況下清理由獨立排程執行。
- 只有帶 `X-Maintenance-Event: schedule` 且成功清理的專用維護請求才會更新 `mushroom-retention-scheduled` 心跳；手動 workflow 不會掩蓋排程缺席。Agent 上傳仍在清理成功時間超過一小時後啟動備援；若 GitHub 排程心跳持續缺席**超過三小時**，Sites 才送 Discord 警示，D1 原子更新限制同一問題**最多每 24 小時一次**。這是排程缺席提醒，不代表清理失敗；若沒有 Agent 上傳，站台也無法主動告警。

`uploadSilent` 表示兩小時沒有被站台接受的上傳事件，不等同於手機故障，也可能是無資料、電量保護或暫停；告警已排除停用／手動暫停 Agent，但仍需與目標 ACK、object 擷取、電量狀態交叉核對。

## 驗收

1. 未授權 GET/POST 都是 401；controller 可讀不可寫；維護密鑰可讀寫。
2. 手動執行 GitHub workflow，確認成功、D1 的 `last_succeeded_at` 更新，且沒有把密鑰印到 log。
3. 觀察至少兩次定時執行；清理後 `pending` 應下降，`consecutive_failures` 維持 0，地圖與 Agent 上傳仍正常。
   只看手動 `workflow_dispatch` 不算通過；GitHub `schedule` 事件和 `mushroom-retention-scheduled` 心跳都須有紀錄。
4. 若 `last_batch_saturated` 長期為 true，先看 pending 與每批數字，再評估增加執行頻率或批次；不要盲目放大單次 Worker 執行量。

## 負載基準（本機，不是正式 D1）

`cd site && node scripts/benchmark-retention.mjs` 使用 SQLite 建立 60,000 蘑菇、120,000 觀測、60,000 目標歷史。單次批次結果：失效 250 筆 2.33ms；過期計數 30,000 筆 1.96ms；刪蘑菇 1,000 筆 5.14ms；刪觀測 500 筆 4.11ms；刪目標 500 筆 0.93ms。各查詢的 `EXPLAIN QUERY PLAN` 使用現有索引，未見全表掃描。這些數字只驗證 SQL 形狀；Cloudflare D1 網路、複本延遲、Worker CPU/時間限制須以實際維護回應和 Sites Worker logs 觀察。未取得 D1 Query Insights 前，不新增推測性索引。
