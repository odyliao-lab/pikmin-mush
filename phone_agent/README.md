# Pikmin Scanner Agent

Root Android常駐掃描Agent，接受雲端逐點派工、等待遊戲native刷新、增量上傳TSV並回報ACK。實體手機與MuMu共用協定，部署配置與上傳實作仍逐台保留。

文件審視：2026-11-12。這是開發與操作入口，並非即時裝置健康報告。

## 版本與驗收範圍

- repo `agent.sh` 預設回報 **2.2.14**；目前遊戲／Hunter基準為 **157.0／1793360009、157.0-r1**。精確簽署APK、ABI及native指紋見 [157候選紀錄](../docs/FLEET_157_CANDIDATE_2026-11-09.md)。
- 竹北Aquarius／Sagittarius保留scoped2.2.14，Capricorn保留scoped2.2.13與既有刷新／冷啟政策；三台有至少3個不同新正式目標的完整鏈證據，見 [竹北157紀錄](../docs/ZHUBEI_157_VALIDATION_2026-11-09.md)。不能以repo版本推論每台都已覆蓋更新。
- 台中逐台狀態與登入阻擋見 [157機隊紀錄](../docs/FLEET_157_VALIDATION_2026-11-09.md)。短驗不等於24小時穩定、全部提示或自然冷啟恢復驗收。
- `config.example` 的 `MODULE_VERSION=156.0`、`primary` 及部分註解仍為歷史範例，Agent無設定時另有舊版fallback；它們不是157正式配置。沿用有效裝置config，按實裝Hunter設定MODULE_VERSION；GAME_VERSION由 `runtime-version.sh` 查實際安裝，不能改標籤假裝相容。Magisk的 `module.prop` 也不代表Agent腳本回報版本。
- 網站成對版本清單與最低Agent版本以 [metrics.ts](../site/lib/metrics.ts) 為準；支援清單不代替裝置APK／ELF／metadata驗證。

## 資料與完成判定

1. 每台以獨立AGENT_ID與Bearer token輪詢 `/api/agent/v2/task`；當前工作透過 `/api/agent/v2/control` 續租及接收pause／stop。
2. Agent把target寫入遊戲私有 `teleport.txt`，native讀取並刷新物件，將結果追加至 `mushrooms.tsv`。
3. 依byte offset上傳 `/api/agent/upload`。只以完整換行前綴計算有用rows／bytes，不把TSV總長或半行當成當次新資料。
4. 成功上傳游標涵蓋當次前綴後，才經 `/api/agent/v2/ack` 回報成功；pending ACK保留其結束游標，仍可讀舊六欄格式。網路失敗不推進接受游標、不清待送狀態。
5. 驗收至少3個不同新正式target，各自有 **當前遊戲PID的native object → 新非零TSV → 接受上傳／游標涵蓋 → 站端接受 → 成功ACK**。重試同一target、query-only、零筆、地圖、心跳或native.ready不算成功。

`receipt-v1` 上傳是獨立opt-in功能，預設 `UPLOAD_RECEIPTS_ENABLED=0`。啟用前須部署 `upload-receipts.sh`、確認站端migration與舊partial狀態，並完成單機canary；不可換掉既有scoped uploader或自行丟棄pending envelope。協定與回退見 [UPLOAD_RECEIPTS.md](../docs/UPLOAD_RECEIPTS.md)。Fleet v2預設不呼叫legacy command接口；不得把個別token放寬為共用憑證。

## 元件與私有狀態

部署目錄：`/data/adb/modules/pikmin_scanner_agent/`。

| 元件／檔案 | 用途 |
| --- | --- |
| `service.sh`、`agent.sh` | 開機緩衝、服務互斥、唯一Agent與掃描循環 |
| `config`、`token` | 裝置有效設定及獨立憑證；只留root-only私有位置 |
| `runtime-version.sh` | 啟動與運行中重新取得實裝遊戲版本 |
| `control.sh` | 手動暫停／恢復、狀態與保護查詢 |
| `popup-recovery.sh`、`bin/popup-probe` | 已校準提示辨識與有界輸入 |
| `scan-recovery.sh` | PID／版本綁定native就緒等待與冷啟節流 |
| `power-guard.sh` | 逐台選用的實體手機熱／充電保護 |
| `upload.offset`、pending ACK／待送資料、TSV | 可恢復的上傳與掃描狀態，不得當暫存清除 |

`agent_control_app/` 是這個掃描Agent的root控制App，並非獨立Pikmin控制中心專案。它呼叫固定控制腳本，APK不內嵌Agent token；原固定簽章與套件身分保留。Scorpio不列入正式掃描部署。

## 安裝與就地更新

1. 先讀當地主機文件與 [EMULATOR_ACCESS_RUNBOOK.md](../docs/EMULATOR_ACCESS_RUNBOOK.md)，核對instance建立識別／UUID、專屬loopback ADB、Android ID、有效AGENT_ID與正式節點。Manager回902不能直接判VM已停。維修不啟動新dispatcher／watchdog。
2. 狀態改變前，在該guest／裝置建立root-only完整備份：原Hunter、APK、完整Agent/config/token、TSV、offset、待送／pending／ACK。驗證owner／mode、命令退出碼、解壓、SHA及copied offset≤copied TSV。live複本不是跨檔原子快照；憑證不匯出。
3. 等待無未決ACK且資料已接受上傳的安全邊界，停止已核對的原Agent；一次只處理一台。保留原帳戶、認證／上傳程式、生命週期、保護、地區資格及所有資料，只套必要scoped修正。
4. 只有新節點才建立新ID／token；既有節點不重建、不沿用別機config。shell檔維持0700，私有設定／資料依原root-only擁有者與權限保存。
5. 更新Hunter後須重啟該Android guest／instance，不能只重啟遊戲就宣稱Zygisk已載入。純Agent/helper更新則在安全邊界重啟原服務載入，避免第二份主程序。
6. 重新核對實裝／映射檔雜湊、遊戲PID／native.ready、唯一Agent、PID檔、服務鎖及cgroup，再完成3個新正式target與站端ACK驗收，回原工作。回退保留更新後新資料，不能把舊archive直接蓋回目前offset／TSV。

本repo不包含遊戲APK。一般掃描不需ADB連線；MuMu仍依賴所屬Windows與VM持續運作。登入、2FA、不同帳戶、未知同意或付費畫面交由使用者處理。

## 刷新、顯示與受控恢復

- `MAP_REFRESH_EXPERIMENT=1` 優先等待當次target的query／object marker。repo通用預設等待18秒、settle3秒；scoped部署可能不同，不重設已驗證的Capricorn策略。
- `MAP_REFRESH_FALLBACK_TIMEOUT_SECONDS=60`、`QUERY_ONLY_RESTART_STREAK=12` 是通用預設，不能據此宣稱逾時都需冷啟。先區分query-only、無object、空點、上傳未涵蓋及遊戲不在地圖等原因，保留既有有界重試與冷啟節流。
- `SCAN_RECOVERY_ENABLED` 選用PID／版本綁定native等待；通用 `SCAN_RESTART_MIN_SECONDS=300`，Taurus等節點有獨立值。native.ready只是就緒，不是完成掃描。
- 正式配置保留 `LOCAL_DISPLAY=0`（Android主顯示）。專用virtual display需另行驗證；尚未建立切背景／關渲染仍可等效掃描的證據。
- 已啟用 `POPUP_RECOVERY_ENABLED=1` 的裝置只對校準解析度、文字、外框與按鈕操作；雙新畫面一致、遊戲精確前景且未暫停／保護才輸入。unknown維持不操作，不使用歷史固定座標盲按。
- network Retry、公告關閉、每日結算各有獨立預設停用開關與備份／control=run／次數限制。Retry至少隔120秒、每30分鐘最多3次；公告每30分鐘最多1次；每日結算每boot六小時最多1次，不代填心情或分享。失敗輸入亦占額度。
- 掃描恢復仍以新資料與ACK驗收，不以 `screen state changed` 或提示消失代替。詳細校準與版本脈絡見 [歷史快照](../docs/history/PHONE_AGENT_BEFORE_REVIEW_2026-11-12.md) 與 [每日結算紀錄](../docs/DAILY_RECAP_RECOVERY_2026-11-07.md)。

`bin/popup-probe` 的repo封裝為ARM64手機版。MuMu必須建置x86_64，且不能套用Cancer專用解析度：

```powershell
# 從phone_agent目錄執行，指定已確認的NDK及獨立輸出路徑
.\build-popup-probe.ps1 -NdkRoot <NDK目錄> -Abi x86_64 -OutputPath <輸出路徑>
```

## MuMu通道與生命週期

Sagittarius／Capricorn曾因從ADB啟動的服務繼承adbd cgroup，在root/unroot切換時一起退出；PPID=1或殘留PID檔不能證明服務仍在。已驗證配置 `SERVICE_DETACH_ADB_CGROUP=1` 只把服務自身移入獨立cgroup並讀回，失敗拒絕啟動；預設0，其他機型不自動套用。

目前日常巡檢先使用repo `tools/emulator-access.py` 與當地主機私有manifest，經既有root／su／Manager能力核對身分、通道及真實程序，**不切換adb root/unroot**。保留 `AGENT_BOOT_DELAY_SECONDS`、NativeBridge等待及冷啟節流。舊 `scanner-lifecycle.py` 的restore-adb是歷史維修語意，不作日常最後步驟，也不跨主機套用。沿用既有有界恢復，不新建常駐重啟迴圈；人工pause／disable不自動解除。

MuMu的 `MUMU_CODE_CACHE_REFRESH`、`SYSTEM_GPS_OVERRIDE` 等設定只能沿用已驗證配置，不能清一般cache／帳戶省事。Android9的逐點GPS橋接另見 [agent_gps_bridge](../agent_gps_bridge/README.md)。竹北RAM／commit／換頁只作觀測，不加入使用者已取消的自動暫停／停機門檻。

## 本機暫停及保護

```sh
su -c '/data/adb/modules/pikmin_scanner_agent/control.sh status'
su -c '/data/adb/modules/pikmin_scanner_agent/control.sh pause 60'
su -c '/data/adb/modules/pikmin_scanner_agent/control.sh pause-manual'
su -c '/data/adb/modules/pikmin_scanner_agent/control.sh resume'
su -c '/data/adb/modules/pikmin_scanner_agent/control.sh power-status'
```

pause保留於 `pause.until`，manual不會自行到期；resume不繞過其他保護。`power-guard.sh` 預設停用，Cancer既有啟用配置保留：嚴重thermal、低電量、接電掉電或感測未知時降載，待冷卻及穩定充電再恢復。通用恢復電量30%，Cancer60%，無效值安全回退80%；不改原廠熱／充電保護，也不把手機電池門檻套到模擬器。

保護區間經認證上傳供後台查詢；本機 `power-status` 為最後觀測快照，仍須核對時間及真實程序。PC舊scanner是相容／維修入口；公開 `/api/mushrooms` 的agent摘要不提供完整裝置定位或健康資料，使用授權metrics／後台作獨立驗證。

## 開發驗證與安全

完整檢查清單以 [Security CI](../.github/workflows/security-ci.yml) 為準，包含shell語法、上傳／ACK邊界、認證stdin、冷啟／提示、cgroup、native與probe正反例。從repo根目錄執行代表性檢查：

```sh
bash -n phone_agent/agent.sh
bash -n phone_agent/service.sh
bash phone_agent/tests/scan-accounting-test.sh
bash phone_agent/tests/scan-ack-upload-boundary-test.sh
python phone_agent/tests/emulator-access-test.py
```

Shell／symlink fixture應在相容Linux環境跑完，不把Windows中途退出記為成功；離線測試不取代正式裝置驗收。token只由既有私有讀取路徑提供，Bearer只送正式HTTPS端點，不記錄config全文、完整命令列、lease、私人畫面或座標。401／403停止該認證路徑，不換token或放寬權限。詳見 [SECURITY.md](../SECURITY.md)。
