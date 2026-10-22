# 台中唯一 dispatcher 的雲端協調契約

狀態：2026-10-23 開發分支 `codex/taichung-dispatch-coordination`；本機測試通過，**未部署、未啟用、未對正式站 POST**。手機 Agent、掃描／輪替排程及既有 controller token 未修改。

## 受保護介面

所有介面沿用 controller 認證與 no-store，不使用 Agent token。

| 介面 | 新增行為 |
| --- | --- |
| `GET /api/controller/dispatches?cursor=...` | contract 2，全域 live queued／leased verification（含 return-only）及所有 active durable admission；每頁最多 100，必須追完 `next_cursor`；提供 scope、待處理 kind／status 計數與安全回程 proof，無座標或 admission capability |
| `POST /api/controller/verification` | 只有設定 `VERIFICATION_DISPATCHER_ID` 時啟用嚴格協調；必須 contract 2、完全相同 `dispatcher_id`、不可 replace；candidate 最多 80，candidate-giant 最多 30 |
| `GET /api/controller/verification?contract=2&batch=...` | 保留既有候選證據，新增 `coordination`；未註冊舊批次為 null，不偽造 owner 或回程成功 |
| `POST /api/controller/dispatches` | `{action:"complete", batch, owner}`；只對持有原 owner 且實際 proof 足夠的批次關閉 metadata，不取消 target、不強制解鎖、不另派工 |

`VERIFICATION_DISPATCHER_ID` 是非秘密入口識別，不代替認證；共享 controller 憑證者仍在同一信任邊界內。未設定時保留原 verification 行為；帶 `dispatcher_id` 卻未啟用時回 503，不偷偷降級。啟用後舊的未協調 POST 回 409，因此必須與唯一台中服務受控切換，不能只單獨開網站設定。

## Durable admission

`db/schema.ts` 與產生的 `drizzle/0028_fresh_black_tom.sql` 定義 schema：`controller_dispatches` 保存原 batch、owner、payload hash、隨機 admission、Agent／job、候選數及狀態；partial unique index 限制全域一個 active。部署先套用 migration，正式請求不執行此表 DDL；schema 的建立本身不啟用新行為。

reservation、全部候選與回程 target 在同一 D1 batch 原子交易。條件包含沒有其他 active reservation／live verification、原 batch 不曾出現在 live／history targets、Agent enabled 且未 paused、15 秒內在線與已知原位置、原 active job／cycle 仍匹配。target insert 必須持有該次隨機 admission；插入失敗整批 rollback，沒有半套候選。相同 batch／owner／payload 只讀回原交易，變更 payload 拒絕。

占用是 sticky 而非可逾時偷取的 lease。UNKNOWN、HTTP 404、已取消但原回程未證實、job 輪替或證據被清理，都不自動釋放；沒有 force-close。定時／手動跨電腦互斥由此處保障，不依賴程序鎖或「不同 batch ID 就不衝突」。

## 結案證據

`dispatchProof` 同時讀 live targets 與既有 target history，排除重複 target ID：

1. 候選數與原 admission 相同且全部終態。
2. 恰有一個 return target，同原 Agent／job、有效 lease、completed ACK。
3. 回程完成後，原 job 的普通 target 由相同 Agent 完成，並有 lease／完成區間內、該 target／Agent 的 accepted `mushroom_observations`。

第三項不接受只有心跳、只有空掃描 ACK 或其它 Agent／job 的資料。`can_close` 足夠才接受 completion metadata。候選本身是否合格仍由原 contract 2 report evidence 判定；「可以結案」不等於所有候選都 verified。

全域 inventory 覆蓋所有來源的現行 verification 佇列及 active admission，但不宣稱已封存／取消、沒有 admission 的歷史交易都可恢復。舊 404 仍 unknown，不能重送。啟用前須由正式帳本及新鮮 GET 另行對帳；分頁讀取間可能有新工作，最後 admission 原子條件仍會阻擋競態。

## 測試與正式切換待辦

本機 Node 全套 127 項通過，ESLint／production build 通過；新增測試使用 SQLite in-memory D1 adapter 與真正 TS handler 的隔離 bindings，沒有正式 HTTP／D1 寫入。覆蓋並發、整批回滾、舊 ID、archive、分頁、auth／嚴格 opt-in、回程及恢復掃描的新觀測條件。**不是正式 D1 或實際 Agent 驗收。**

配套 Discord 分支 `codex/taichung-single-dispatch` 已接入原 tick，預設停用；詳細切換／回退清單見該 repo 的 `docs/TAICHUNG_SINGLE_DISPATCH_2026-10-23.md`。正式切換需重新核對版本及所有未決，備份後先部署相容程式但保持關閉，再另選受控窗口協調兩端設定；不可在有未決時退回 legacy。未另行授權前不部署、不派工、不發 Discord、不更改現有排程。
