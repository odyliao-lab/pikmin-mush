# MuMu 維護通道與生命週期健檢

`phone_agent/tools/emulator-access.py` 是唯讀入口。它不切換 adbd 的 root 狀態、
不重啟、不啟動第二個 Agent、不寫設定或授權清單，也不匯出裝置憑證。
以原正式 bot 環境執行，先從受保護 maintenance API 核對節點，之後才碰本機。
401/403 立即停止，不換 token、不跟隨轉址；讀不到必要資料標為無法確認。

## 四項補強

1. **能力辨識**：依序檢查既有 root shell、`su`、核實 instance 的 MuMuManager
   shell。最後一種採完整傳遞的唯讀腳本，要求 UID0 與裝置端完成標記；管理工具
   的 host exit0 單獨不算成功。台中實測 Gemini/Virgo 使用 su，Taurus 使用 manager。
2. **故障分層**：分開記錄 instance 停止／身分錯誤、端點暴露／未監聽、ADB
   unauthorized／offline、Android ID 或有效 AGENT_ID 不符、缺少 root、缺少或
   重複 Agent、PID檔不符及 cgroup 未確認獨立。人工 pause/disable、正常保護與
   服務開機等待另列，不自行修復。通道 ready 不代表掃描健康。
3. **生命週期**：真實主程序透過 ps 參數辨識、排除子 shell 與 `sh -c` 字串，
   再讀其 cgroup。PID檔或 PPID1 單獨不算存活證據。MuMu Android15 目前以
   `0::/` 確認與 adbd 群組獨立；其他布局標為待查。保留既有120秒 boot delay，
   不盲目套用其他主機的 detach flag，不執行 adb root/unroot 或 restore-adb。
4. **專屬本機端點**：每次從現行 MuMu metadata 取得埠號，檢查 instance 名稱、
   建立識別、localhost 位址與實際 Windows listener 綁定，再核對 Android ID。
   不把台中埠號當成竹北身分；非 loopback 的 metadata／listener 一律停止。

同一次執行的 root 子通道也重新核對 Android ID，避免入口辨識後換到別的實例。
完整程序命令列只在記憶體內供比對，報告僅保留白名單欄位和數字 PID。
裝置仍須由原完整巡檢驗證新 target→native object→非零 TSV→上傳→站台接受→ACK；
此工具不取代該驗收，也不會把 native.ready／心跳直接當作掃描正常。

## 主機部署

先讀適用 AGENTS.md 與當地主機維運資料，從正式 repo 最新 main 取得工具。
私人 manifest 留在 repo 外，嚴禁放 token。結構如下；所有值都須由當地主機
與正式節點重新核實，不能複製範例的佔位值執行：

```json
{
  "adb": "<本機已確認的 adb.exe 絕對路徑>",
  "manager": "<本機 MuMuManager.exe 絕對路徑>",
  "bot_root": "<本機正式 OdyDiscordBot 目錄>",
  "nodes": [{
    "name": "<報告名稱>",
    "index": 0,
    "vm_name": "<現行 instance 名稱>",
    "created_timestamp": 0,
    "android_id": "<現行 Android ID>",
    "agent_id": "<相符的正式 AGENT_ID>"
  }]
}
```

使用正式 bot 的 Python 環境，維持現行 requests 與認證讀取實作：

```text
<bot-python.exe> <emulator-access.py> --manifest <私人 manifest.json> --output <私人 report.json>
```

台中部署於 `C:/Users/Ody/AppData/Local/PikminMaintenance/TaichungAccess/`，
含 `emulator-access.py` 與 `manifest.json`；每日結果放當日私人 daily-health。
此路徑、instance index、建立時間、端點與 Android ID 不可帶到其他電腦。

回傳0表示維護通道通過且無程序/cgroup注意項；非0須讀安全分類。
`service_starting`／人工暫停／保護等待不是自動重啟授權；native未就緒仍須依
原節流等待及完整掃描巡檢判斷。工具不假定 timeout=null 就代表會7天失效，
也不改變 MuMu 授權逾時或標準 Android 無線偵錯。

## 復原界線

通道故障先確認主機、instance、專屬埠及有效 ID；不要猜 IP／型號，不清金鑰。
若需要改裝置狀態，另依原流程先建立並驗證裝置內 root-only 備份，涵蓋完整
config/token、offset、pending、待送資料、ACK與TSV，再一次處理一台。
未確認身分、未知登入／2FA或無法備份時停止該項，不以放寬權限換取成功。

備份完成後在guest內執行`sync`並重核archive雜湊，再進入狀態變更；套件推送及
安裝staging驗證後也要`sync`，才依當地流程關閉單一MuMu實例。2026-11-12竹北
Aquarius曾在關閉前驗到正確ZIP／staging雜湊，重新開機後ZIP卻為0 bytes、Hunter
仍為r1；重新推送、安裝及sync後的一次有界重啟才驗到新版。這支持未持久化寫入
的判斷，並非不同主機都已證明相同原因。正常Manager shutdown及page-cache內
雜湊不取代持久化檢查。重啟後再驗備份、磁碟檔及實際載入，不盲目重裝／重啟。

舊 `scanner-lifecycle.py` 是另有部署清單與歷史 root/unroot 語意的維修工具，
不能拿其 `status`／`restore-adb` 取代本唯讀檢查或直接搬到台中執行。
不得啟動另一套 watchdog/dispatcher/sender，不更動其他用途的排程。

## 測試與現場驗證

`python phone_agent/tests/emulator-access-test.py` 覆蓋身分、動態端點、暴露端點、
未授權／離線、root fallback、管理工具假成功、秘密不輸出、主程序辨識、
人工暫停／保護及不觸發 adbd 重啟等失敗路徑，並已加入 Security CI。
2026-11-06 台中三個正式 instance 的唯讀現場測試皆通過，使用的 Agent 主程序
與原 adbd cgroup 分離；未新增服務或更動裝置設定。

## 給竹北電腦的提示詞

請從正式 repo 最新 main 讀取本文件與 `phone_agent/README.md`，在竹北對
Aquarius(`agent-aquarius-01ee2f52`)、Sagittarius(`agent-sagittarius-5ee373c2`)、
Capricorn(`agent-capricorn-48d6f24e`) 做同樣四項健檢。先核實本機正式名單，
重建當地主機專屬 manifest，不能使用台中 instance/Android ID/路徑/端點。
使用新唯讀工具驗證三條通道，依結果保留或修正主機端 adapter；已存在的
SERVICE_DETACH_ADB_CGROUP=1 與生命週期措施依實裝保留，不任意移除。
若出現不足，先提出或完成已授權的最小補強；裝置修改前需驗證 root-only
備份。不要重啟電腦，不重啟共用 ADB server，不任意 adb root/unroot，不清
資料、不換憑證，不干擾台中、正式複查或其他排程。維護通道通過後，另驗證
新正式目標→native object→非零 TSV→上傳→站台接受→ACK。
將新檢查接到既有竹北巡檢，不另建 scheduler/watchdog/sender；保留原時段、
範圍與異常才通知規則。最後逐台回報身分、通道、root入口、cgroup、端點
綁定、掃描驗收與所有無法確認項目，不把心跳／ADB連線當作健康。
