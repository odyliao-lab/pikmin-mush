# Pikmin Scanner Agent

手機端 Magisk 常駐 Agent。手機主動透過 HTTPS 連到 `mush.odyliao.cc`，
不需要 ADB、固定 IP、區域網路或開放手機連接埠。

## 資料流

1. 每個節點以獨立 `AGENT_ID` 與 Token 輪詢 `/api/agent/v2/task`。
2. 雲端以逐點 lease 分派工作；Agent 離線或逾時後工作會自動重新排隊。
3. Agent 直接寫入遊戲的 `teleport.txt`，並定期續租以接收暫停或停止。
4. Agent 以 byte offset 增量讀取 `mushrooms.tsv`，上傳至 `/api/agent/upload`；
   等級 1 不列入擷取行數，雲端也會拒收低於等級 2 的資料。
5. 遊戲卡住時，Agent 以 Android shell SELinux context 重啟遊戲並驗證 PID。
6. 網路失敗時不推進 offset；恢復後自動續傳及重送完成 ACK。

啟用 `MAP_REFRESH_EXPERIMENT=1` 後，每個掃描點不再盲等固定秒數，而是等待
native hook 寫出的 map-query／map-object marker；目前實機穩定設定為
`MAP_REFRESH_TIMEOUT_SECONDS=0`，直接使用冷啟動 marker 流程。開機服務會先嘗試
解除無密碼 Keyguard；若重啟後仍停在 Pikmin 的兩個「繼續」畫面，720x1600
virtual display 可使用 `STARTUP_TAP_X=360`、`STARTUP_CONTINUE_Y=752` 與
`STARTUP_LOGIN_CONTINUE_Y=860` 自動恢復。

所有 Agent API 都要求 `Authorization: Bearer <token>` 與 `X-Agent-Id`。
Agent 2.1 另回報 `X-Agent-Version`、`X-Game-Version` 與 `X-Module-Version`；
雲端偵測到遊戲或 native module 與 149.0 不相容時不再派工，並在後台顯示原因。
`primary` 保留既有 Token；新節點由網站後台建立獨立憑證，Token 只顯示一次。
正式 Token 不應提交版本庫。

後台換發 Token 時，新 Token 只顯示一次，舊 Token 預設保留最多 24 小時。
在緩衝期內更新手機端 `token` 並重啟 Agent，確認新 Token 已持續回報後即可在後台提前撤銷舊 Token。

## 手機安裝位置

目前已部署到：

```text
/data/adb/modules/pikmin_scanner_agent/
```

Magisk 會在開機後執行 `service.sh`，再由它啟動 `agent.sh`。正式設定在手機端
`config`，認證密鑰在 `token`。每台裝置的 `AGENT_ID` 必須不同。

## PC 端

GUI 預設選擇「手機 Agent（免 ADB）」。命令列可使用：

```powershell
python scanner/scanner.py --device-backend agent
```

`/api/mushrooms` 的 `agent` 欄位會顯示 backend、online、last_seen、
uploaded_rows 與 current_location。

## 更新 Agent（需要最後一次可用的 ADB 或其他 root 檔案傳輸）

將本資料夾檔案複製到模組目錄，保留手機端既有的 `token` 與 `config`，
設定 shell 檔權限為 `0700`，再重新執行 `service.sh`。一般掃描不需要 ADB。
