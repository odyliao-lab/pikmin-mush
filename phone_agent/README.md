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
native hook 寫出的 map-query／map-object marker；2026-08-20 起預設改為
`MAP_REFRESH_TIMEOUT_SECONDS=18`（Agent 2.2+）。舊版預設 `=0` 會讓 agent 完全
跳過這段等待、每個沒抓到新資料的點都直接冷重啟——這不是因為即時刷新不可靠，
是因為舊版的冷重啟復原序列（見下）等不到「跨日第一次啟動」才會出現的每日
步數回顧卡（其計數動畫可長達 60-90 秒）、心情打卡、分享卡，這些畫面關閉後
預設落在首頁儀表板、不是即時地圖，而 `RegisterMapObject` 只有在真的打開地圖
畫面時才會觸發——GPS 覆寫與地圖查詢兩者從儀表板送出時仍會回報成功，不會有
任何錯誤訊號。實測同一個遊戲 process 在即時刷新模式下可連續運作 20+ 分鐘、
跨洲瞬移零重啟，只要能穩定停在地圖畫面。

冷重啟復原序列（`MAP_REFRESH_FALLBACK_TIMEOUT_SECONDS`，預設 60 秒）分三個
固定時間點各觸發一次、不重複：

- `elapsed=8s`：ENTER/DPAD_CENTER + `MAP_VIEW_TAP_*`（首頁儀表板的羅盤／
  探索圖示）。2026-08-20 實測：一般的 app 內重啟（`restart_game_for_scan`，
  非完整裝置重開機）幾乎都會直接落在首頁儀表板，不是對話框，`RegisterMapObject`
  只有在真的打開地圖畫面才會觸發——GPS 覆寫與地圖查詢兩者從儀表板送出時仍
  回報成功，沒有任何錯誤訊號能分辨。單獨點這個羅盤圖示重複驗證兩次都穩定
  把畫面帶回地圖。
- `elapsed=20s`：`SPEED_WARNING_TAP_*`（Niantic 移動過快警告「我不是司
  機」）＋ `STARTUP_WARNING_Y`／`STARTUP_CONTINUE_Y`（裝置真正重開機後才會
  出現的安全提示／兩個觸控繼續畫面）。
- `elapsed=30s`：`STARTUP_LOGIN_CONTINUE_Y` ＋ 再點一次 `MAP_VIEW_TAP_*`
  保底。

**座標順序是刻意的、不能隨意調換**：這個等待迴圈一偵測到 marker 就會立刻
結束，所以排最前面、且已驗證最可靠的動作實際上決定了大部分情況的結果，
後面排的動作多半根本沒機會執行到。2026-08-20 現場測試發現兩個重要教訓：
（1）固定座標點擊不是無害的 no-op——這款遊戲不同畫面的功能列常共用相近
Y 座標，包括**既有、已在正式機隊沿用的** `STARTUP_WARNING_Y`／`STARTUP_CONTINUE_Y`
本身，若在只有首頁儀表板、沒有真正對話框的情境下觸發，可能誤觸「完成N場
探索」進度條而被帶去不相干的活動／挑戰選單；這是這兩個座標原本設計給
「裝置真正重開機」情境用的，套用在單純 app 內重啟時就有這個風險，是這次
測試才發現的既有限制，不是本次改動造成的。（2）`KEYCODE_BACK` 不是通用
安全牌：從地圖畫面按 BACK 會回到首頁儀表板沒錯，但從儀表板（沒有更上層
畫面可退）按 BACK 會把遊戲整個切到背景、跳出到桌面或其他 App，比任何誤觸
都更糟（掃描完全停擺，需要人工切回遊戲）——因此整個復原序列完全不使用
`KEYCODE_BACK`，也不重複同一輪點擊（重複只會放大已經點錯的風險，不會收
斂）。步數回顧卡、心情打卡、分享卡的座標（`RECAP_CONFIRM_TAP_*`／
`MOOD_TAP_*`／`SHARE_CLOSE_TAP_*`）目前**不會**被自動觸發，原因同上，只
在 config.example 留供手動使用；跨日第一次啟動這個少見情境交給既有的
`QUERY_ONLY_RESTART_STREAK` 冷重啟迴圈多重試幾次頂過去。座標基準是
720x1600 virtual display，實機解析度不同時等比例換算；未設定（留 `0`）
的座標會被跳過。
Pikmin 150.0 的地圖查詢還需要 Android 系統位置；專用掃描手機應設定
`SYSTEM_GPS_OVERRIDE=1`，Agent 會讓系統 GPS 與每個掃描 target 同步。
若 map-query marker 持續成功、卻沒有 map-object marker 或有效 TSV 資料，
`QUERY_ONLY_RESTART_STREAK` 會在連續指定點數後冷重啟遊戲；預設為 12，
已知容易進入 query-only 狀態的裝置可使用較低門檻，例如 Agent 3 設為 3。

所有 Agent API 都要求 `Authorization: Bearer <token>` 與 `X-Agent-Id`。
Agent 2.1 另回報 `X-Agent-Version`、`X-Game-Version` 與 `X-Module-Version`；
雲端要求遊戲與 native module 版本一致；目前支援 149.0 舊節點與 150.0 新節點，不相容時不再派工並在後台顯示原因。

## 手機端暫停控制

`control.sh` 讓 root 控制 App 操作本機 Agent，不需要把管理員密碼或 Agent token
放進 APK。暫停狀態寫在 `pause.until`，因此 App 關閉或手機重開後仍會保留；期限到後
Agent 會自動刪除暫停檔並繼續領取工作。目前支援：

```sh
su -c '/data/adb/modules/pikmin_scanner_agent/control.sh status'
su -c '/data/adb/modules/pikmin_scanner_agent/control.sh pause 60'
su -c '/data/adb/modules/pikmin_scanner_agent/control.sh pause 100'
su -c '/data/adb/modules/pikmin_scanner_agent/control.sh pause-manual'
su -c '/data/adb/modules/pikmin_scanner_agent/control.sh handoff-gps'
su -c '/data/adb/modules/pikmin_scanner_agent/control.sh resume'
```

`handoff-gps` 適合要改用 Joystick 等手動定位工具時使用：它會寫入手動暫停、
停止目前的 Agent 行程，並清除 Scanner 建立的 GPS test provider。掃描器不會在
手機重開後重新接管 GPS，直到使用者在控制 App 按下「繼續掃描」。

控制 App 1.1 起也會顯示最近掃描的國家－城市、GPS、點位進度、擷取筆數與耗時。
App 只建立一條持續的 root 狀態串流，每 5 秒由同一個程序更新畫面，不再每 5 秒
重新呼叫 `su`；因此切換到其他 App 時，超級使用者授權提示不會持續重複出現。

手機 App 原始碼位於 `agent_control_app/`，release APK 由
`.github/workflows/agent-control-app.yml` 建置。App 僅執行上述固定控制腳本，第一次
開啟時需要在 Magisk／root 管理器授予 root 權限。若手機使用
Kitsune Mask 的 SU-list 模式，安裝 APK 後以 root 執行
`phone_agent/allow-control-app-root.sh`，只會將這個固定 App 套件加入允許清單。
Release APK 使用 GitHub Actions secrets 中的固定簽章，金鑰不得提交到版本庫；
這能讓後續版本安全覆蓋升級，也防止其他 APK 冒用已取得 root 權限的套件名。
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
