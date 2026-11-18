# 單筆正式複查取消

`POST /api/controller/dispatches` 的 `cancel` 操作核對現有 controller 認證、`VERIFICATION_DISPATCHER_ID` 與台中原派工端專用的 `VERIFICATION_DISPATCH_CANCEL_TOKEN`。透過 `X-Dispatch-Cancel-Token` 傳送專用憑證。未配置專用憑證、與 controller 憑證相同，或任一身分不符時會拒絕。

操作參數為 `action: "cancel"`、`batch`、`owner`、`agent_id`、`job_id`。原工作必須已停止（站端狀態為 `cancelled`）。有有效租約、Agent 仍指向本批待執行目標、待執行點不屬於原 Agent／工作，或另有回程修復時，保留原批次並回傳衝突。

站端以一筆 D1 交易保存稽核收據，取消該批精確的待執行目標，並將原批次標為 `operator-cancelled`。重試讀回原收據。舊 ACK、已完成的候選與回程，以及其他工作與批次沿用原記錄及原留存政策。原完成入口會拒絕已取消批次。此批的活動占位與待執行點解除後，輪替仍依既有時程與其餘守衛判定。

發布後，原派工端以 `GET /api/controller/dispatches?batch=<exact-batch>` 核對狀態及取消收據，再使用相依 Bot 變更保存台中封存。上線前先核對已部署來源、設定專用憑證與 Bot 相依版本。取消後需等下一次正常輪替，確認新工作領取、新資料及 ACK。
