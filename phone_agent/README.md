# Pikmin Scanner Agent

手機端 Magisk 常駐 Agent。手機主動透過 HTTPS 連到 `mush.odyliao.cc`，
不需要 ADB、固定 IP、區域網路或開放手機連接埠。

## 資料流

1. Agent 每 2 秒輪詢 `/api/agent/command`。
2. `teleport` 命令直接寫入遊戲的 `teleport.txt`。
3. Agent 以 byte offset 增量讀取 `mushrooms.tsv`，上傳至 `/api/agent/upload`。
4. 遊戲卡住時，Agent 以 Android shell SELinux context 重啟遊戲並驗證 PID。
5. 網路失敗時不推進 offset；恢復後自動續傳。

所有 Agent API 都要求 `Authorization: Bearer <token>`。token 由 PC 端
`scanner.py` 首次啟動時建立於 `scanner/agent_token.txt`，不應提交版本庫。

## 手機安裝位置

目前已部署到：

```text
/data/adb/modules/pikmin_scanner_agent/
```

Magisk 會在開機後執行 `service.sh`，再由它啟動 `agent.sh`。正式設定在手機端
`config`，認證密鑰在 `token`。

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
