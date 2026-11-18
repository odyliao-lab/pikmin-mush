# 單筆正式複查取消

`POST /api/controller/dispatches` 的 `cancel` 操作核對現有 controller 認證、`VERIFICATION_DISPATCHER_ID` 與台中原派工端專用的 `VERIFICATION_DISPATCH_CANCEL_TOKEN`。透過 `X-Dispatch-Cancel-Token` 傳送專用憑證。未配置專用憑證、與 controller 憑證相同，或任一身分不符時會拒絕。

操作參數為 `action: "cancel"`、`batch`、`owner`、`agent_id`、`job_id`。原工作必須已停止（站端狀態為 `cancelled`）。有有效租約、Agent 仍指向本批待執行目標、待執行點不屬於原 Agent／工作，或另有回程修復時，保留原批次並回傳衝突。

站端以一筆 D1 交易保存稽核收據，取消該批精確的待執行目標，並將原批次標為 `operator-cancelled`。重試讀回原收據。舊 ACK、已完成的候選與回程，以及其他工作與批次沿用原記錄及原留存政策。原完成入口會拒絕已取消批次。此批的活動占位與待執行點解除後，輪替仍依既有時程與其餘守衛判定。

發布後，原派工端以 `GET /api/controller/dispatches?batch=<exact-batch>` 核對狀態及取消收據，再使用相依 Bot 變更保存台中封存。上線前先核對已部署來源、設定專用憑證與 Bot 相依版本。取消後需等下一次正常輪替，確認新工作領取、新資料及 ACK。

## 普通掃描點已用完

當普通工作仍在執行，但本輪已無可派點時，若該工作的每筆活動批次都保有完整的已終止候選點和同一 Agent 的成功回程，站端可在同一工作內建立一輪續掃。交易會保留原候選與回程紀錄。原派工端仍須核對新普通掃描證據並結案。批次未結案前，後續整輪續掃及跨工作換區仍有守衛。這個續掃入口不處理已停止舊工作，也不取代單批取消。

## 普通掃描的上傳與 ACK 對帳

已登入的後台可在既有 ACK 查詢帶入 `evidence_agent`、`evidence_targets` 和 `evidence_observations=1`。每次最多十個精確目標。當正數的持久 ACK 與相同 Agent、工作、目標的完整租用區間相符，並在該區間查到站端保留的 3/4 級資料，回傳一筆 `accepted_observations`。`received_at` 是站端秒級入庫時間，`ack_at` 是毫秒。超過十五分鐘的區間、已清理的資料或其他缺證不會產生接受證據。
