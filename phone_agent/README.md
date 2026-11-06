# Pikmin Scanner Agent

## 模擬器唯讀維護入口

2026-11-06 起以 `tools/emulator-access.py` 做日常通道／權限／生命週期健檢。
它會重新核對本機 instance、專屬 localhost listener、Android ID與有效 Agent ID，
自動選取既有 root／su／MuMuManager 能力，且不切換 adb root/unroot。
故障分類、主機專屬 manifest、台中部署位置與竹北健檢提示詞見
[模擬器維護手冊](../docs/EMULATOR_ACCESS_RUNBOOK.md)。它不取代非零掃描／上傳／ACK驗收。

Cancer 1080×2160 首頁羅盤的半透明外緣會受花草背景影響，可能使首頁判為
unknown 而反覆冷啟仍無掃描資料。2026-11-01 僅校準該機不透明圖案／內部取樣，
保留完整外框、文字、雙畫面、前景與保護檢查；實機判斷與部署界線見
[Cancer 首頁復原紀錄](../docs/CANCER_DASHBOARD_RECOVERY_2026-11-01.md)。

## MuMu Android15：ADB 權限切換與服務生命週期

Sagittarius／Capricorn 已重現：ADB 啟動的 `nohup setsid service.sh` 仍繼承
adbd 的 cgroup，`adb root`／`adb unroot` 重啟 adbd 時會清除該群組。
PPID=1、殘留 `agent.pid` 或遊戲仍在，都不能證明 Agent 存活。

這兩台配置 `SERVICE_DETACH_ADB_CGROUP=1`，服務先將自身移入與開機服務相同的
cgroup-v2 根群組，再取得服務鎖、等待與啟動 Agent；讀回驗證失敗即拒絕啟動。
只移動自身，沒有移動 adbd 或其他節點。預設0保留其他機型行為，不能在未驗證
機型直接開啟。既有 Agent、服務鎖、TSV、cursor、pending ACK、憑證與派工不變。

竹北既有巡檢使用工作區 `scanner-lifecycle.py <node> ensure --keep-root`：
驗證 VM/Agent 身分與真實程序；人工暫停／disable 不自動恢復。Agent 缺少時才先
備份再啟動原 service，服務已在啟動則不重複建立。每節點3小時內最多2次啟動
嘗試、相隔至少180秒；主機程序互斥，沒有常駐重啟迴圈。接著核對本輪新
native object→TSV→上傳→有效 ACK 與站端增量，最後執行
`scanner-lifecycle.py <node> restore-adb`，核對 cgroup、切換後的真實主程序
及新的站端資料。沒有 RAM／commit／換頁控制門檻。

## 2.2.10 私人認證傳遞與 KernelSU shell

一般 API 與短時 control 輪詢以 shell builtin `printf` 經 stdin 傳送 Bearer
header，curl 使用 `-H @-`，避免 token 出現在程序參數。TSV body 仍由獨立檔案
讀取，HTTP／TLS、逾時、DNS 選項、上傳 offset 與 ACK 行為不變。需支援從 stdin
讀 header 的 curl（7.55+）；Gemini 的官方 Termux curl 8.23.0 已核對此能力。
此程式更新僅部署 Gemini，不更動既有五台 Agent。

`SHELL_SU_MODE=ksu-runcon` 支援沒有 `su -Z` 的 KernelSU：先切換 UID 2000，
再由 Android `runcon` 進入 `u:r:shell:s0`，定位與畫面指令不沿用 root domain。
轉換或 timeout 失敗時回傳失敗，不自動放寬權限。預設 `magisk` 保留原路徑。
Gemini 已實測 `id`、`cmd location is-location-enabled` 與 activity 查詢。

Gemini 的 1080×1920 繁中首頁另有六張跨重開畫面校準的範本：通知紅點與羅盤
半透明外緣不作為必要取樣，羅盤保留白色圖案與不透明內部背景的檢查。原 Taurus 範本保留，文字、
外框與羅盤三組檢查及兩張畫面／前景安全閘門不放寬；不包含帳戶或步數樣本。

## 2.2.9 新裝與模擬器保護

首次建立及重新套用 `teleport.txt` 會依遊戲 files 目錄的實際 UID/GID 設為
0600，避免 root 私有 umask 讓 native 無法讀取目標；無效擁有者、symlink 或
權限設定失敗時拒絕繼續。既有 token、offset、TSV 與未決 ACK 不受影響。

系統 GPS 測試提供者延後至解除暫停、允許掃描且 Android 已存在 GPS provider
時才初始化。MuMu Android15 的 boot_completed 可能早於 LocationManager 完成，
不能在開機時先建立同名 mock provider。`SYSTEM_GPS_OVERRIDE=0` 不執行此步驟。
MuMu 專用快取選項啟用時，若真實 GPS provider 尚未註冊，先由既有安全入口
啟動遊戲並等待 native，再次確認 provider 存在才設定 mock GPS；仍未就緒便等待，
不先領取工作。Taurus 使用 `SYSTEM_GPS_OVERRIDE=1` 對齊系統與 native 座標。
Taurus 另啟用 `SCAN_RECOVERY_CONTROL_POLL=1`：native 啟動等待期間每 30 秒經既有
control API 更新在線狀態／有效 lease，並尊重後台 pause/stop；不派新點、不發成功
ACK，也不以此作掃描驗收。冷重啟間隔為 900 秒，降低空點觸發的不必要冷啟動。

Taurus 新增 1080×1920 繁體中文首頁／羅盤校準；不含帳戶、步數或頭像特徵。
同解析度另校準已觀察到的「不要駕駛」、「不要前往禁止進入的地點」與
「不要前往危險的地點」普通提醒；外框、完整文字區域與確定按鈕必須同時符合。
未知提示保持不操作。模擬器需以 `build-popup-probe.ps1 -Abi x86_64 -OutputPath
<獨立輸出路徑>` 建置，不能直接執行 ARM64 手機工具。正式掃描仍需獨立 Agent
身分，以及新 target、object、非零 TSV、站台接受與 ACK 的逐點驗收。

`AGENT_BOOT_DELAY_SECONDS=120` 可供已驗證需要開機緩衝的模擬器選用：在
boot_completed 後最多等待 300 秒再啟動 Agent，不預先領取 lease。預設 0 保留
實體手機行為；不清快取、帳戶資料、TSV 或上傳狀態，不把等待視為掃描成功。

Taurus 的 MuMu ARM 轉譯快取曾導致下一次啟動出現登入錯誤 0。
僅在已驗證的 MuMu x86_64/libnb 環境選用 `MUMU_CODE_CACHE_REFRESH=1`：遊戲沒有
程序時，冷啟動前將固定的 `code_cache/.hptc_kache_nticlabs.pikmin` 移至模組內
0700 目錄，校驗搬移前後 SHA-256，保留一份 0600 的最新快取備份。初始人工備份
另行保留。不搬動其他 cache、帳戶、token、offset、TSV 或未決 ACK；symlink、
錯誤架構／bridge、遊戲仍在運行、未完成的前次搬移或權限失敗都拒絕冷啟動。
預設停用，四台手機沒有套用此選項。

## 156 版本回報

Agent 2.2.5 使用 `runtime-version.sh` 在啟動及運行期間（每分鐘最多一次）讀取
Android 實際安裝的遊戲版本。遊戲在 Agent 未重啟時更新，也不沿用舊的
`GAME_VERSION` 設定；查詢失敗或格式錯誤回報 `unknown`，由版本相容檢查拒絕派工。
部署必須一起保留此 helper；不得只修改 Agent／模組版本名稱。
156 的 native profile、限幀選項和 PID 綁定 `native.ready` 仍需重開及實際
object、TSV、上傳、ACK 驗收；版本相符或 native.ready 都不能代替掃描證據。
既有手機採用保留其上傳實作的 scoped patch；Cancer 的專用 power guard、60%
恢復門檻與限幀設定保留，Libra 保持控制中心核心停用及羅盤 tap，不依153歷史
段落改回 swipe。完整逐台證據見 `docs/FLEET_156_VALIDATION_2026-10-27.md`。

## 155 已知彈窗自動恢復

`POPUP_RECOVERY_ENABLED=1` 啟用手機本機的已校準畫面辨識。在掃描及等待的安全檢查點，
以 `POPUP_RECOVERY_INTERVAL_SECONDS=30` 為間隔檢查實體螢幕，不依賴電腦或 ADB。
支援 1080×2400、1080×2160、1440×3120 的繁體中文已知安全提示、速度提示及主畫面。
警告必須同時符合外框、已校準文字與按鈕特徵；兩張新截圖一致且遊戲仍為焦點視窗才點擊。
關閉提示後重新辨識主畫面，使用已校準的羅盤 tap 回到地圖。文字、比例或位置不符時不操作；
登入、付費、權限、未知視窗及其他 App 不會獲得自動點擊。

用 `build-popup-probe.ps1 -NdkRoot <NDK>` 建置 `bin/popup-probe`，與
`popup-recovery.sh` 及 Agent 2.2.4 一起部署。這是獨立工具，不替換原有 `bin/ui-probe`。
2.2.3 補入 Leo 實測的駕駛提示與主畫面渲染樣本，沒有放寬文字或按鈕比對門檻。
輸入後會再次檢查保護狀態及畫面：未改變時記錄 `recovery unconfirmed`，改變時只記錄
`screen state changed`；unknown 不代表已回到地圖。掃描恢復仍須以新 object、資料上傳及 ACK 驗收。
預設關閉；啟用時停用舊的盲按鍵／座標點擊，只允許本次辨識核准的輸入。保留手動暫停、
原廠及 Agent 熱／充電保護；保護期間不擷取畫面或輸入。截圖只在模組私有檔案短暫存在，
辨識後刪除，不上傳；版本庫僅保留公共 UI 文字／控制項的稀疏特徵與合成測試，不收私人截圖。

現有手機先備份，再加入這項功能；保留 token、config 其他設定、upload.offset、TSV 及待送／ACK。
只重新啟動 Agent 即可載入，無須更換 Hunter 或重開手機。Libra 的羅盤 tap 與停用的控制中心核心保持原狀；
Scorpio 不在正式四機部署範圍。

## Cancer 低負載與冷啟動恢復（2.2.4，逐台選用）

Cancer 的羅盤使用五張不同背景實機畫面的共同穩定取樣，保留外框、文字、按鈕三組與原色差門檻。
按鈕同時保留白色羅盤圖案與綠色留白；單一白色圓鈕或綠色區塊不會獲准點擊。
不改解析度或密度，避免破壞既有校準。`SCAN_RECOVERY_ENABLED=1` 另需部署 `scan-recovery.sh`
及支援此契約的 Hunter；不可單獨在舊 native 上啟用。啟動最多等待 120 秒，只接受
`native.ready` 的 PID 與目前遊戲程序、版本均一致。此檔表示 native 掛鉤就緒，不能替代
新 target 的 object／TSV／上傳／ACK 驗收。所有等待維持手動與熱保護檢查。
`SCAN_RESTART_MIN_SECONDS=300` 限制 fallback 冷啟動頻率，依 boot ID 與 uptime 保存，
不把尚未就緒的第一次啟動誤當作需要立即再重啟。

Hunter155 的 `files/scanner-render-fps.txt` 是另一個預設不啟用的設定，只接受15、20、30。
檔案不存在、格式不符、版本不符或 Unity API 不可用時，保留原遊戲渲染設定。
必須由操作者在遊戲私有目錄寫入並保留 App 擁有者；不可放 config/token。
遊戲主執行緒經公開 `Application.targetFrameRate` metadata 設定並讀回；
`scanner-render.status` 記錄 PID、讀回值及時間，這是 API 設定證據，不是實測畫面 FPS。
更改此設定後重新啟動遊戲；更換 native 後必須重開手機並核對新程序及載入證據。
不修改原廠 thermal、充電或 CPU 頻率控制，Cancer 的60%恢復門檻保持原狀。

建置封裝必須明確指定 `package-module.ps1 -GameVersion 155.0 -GameVersionCode 1791279164`
及實際 revision（如 `-ModuleRevision r2-thermal`）；歷史預設仍為152，不可省略版本。

## 歷史 153 實機地圖入口

Libra 與已校準的 Scorpio 可啟用 `VISUAL_RECOVERY_ENABLED=1`（其他機型預設關閉）。部署前用
`build-ui-probe.ps1 -NdkRoot <NDK>` 建置 `bin/ui-probe`，一起安裝
`visual-recovery.sh`。此模式關閉自動確認鍵；連續兩點失敗才辨識畫面，
連續三點失敗才冷重啟。冷啟動時在固定節點檢查畫面，不直接盲點。
兩張新截圖一致才關警告、關活動頁或從主畫面右往左滑；未知畫面不操作。
目前校準 Libra 1440×3120 與 Scorpio 1220×2712、RGBA8888、實體螢幕與 153 UI。
Scorpio profile 可辨識主畫面、活動挑戰和功能選單，分別滑進地圖或關閉已辨識頁面；
尚未校準的警告保持 unknown，不盲點。153 deferred hook 的啟動等待需按裝置驗證。
畫面比對是保守色彩特徵而非 OCR；改版、比例、遮罩不符會拒絕操作。
截圖僅暫存在手機模組私有檔案，辨識後刪除，不上傳。

以下 swipe 為歷史 153 校準，不能覆蓋現行 Libra 的羅盤 tap。經裝置畫面確認後可設定 `MAP_ENTRY_MODE=swipe`，搭配
`MAP_ENTRY_START_X`、`MAP_ENTRY_END_X`、`MAP_ENTRY_Y`，從主畫面以手指
**右往左**進入地圖。Libra 1440×3120 實測為 `(1230,1600) → (220,1600)`。
此模式停用 fallback 的生活紀錄下滑及探索頁點擊；其他裝置預設仍用既有 tap。
不能僅因畫面出現地圖就宣告成功，必須確認新的 object marker、資料列及上傳接受。
Android curl 不一定支援指定 DNS；程式會先驗證選項，不支援時保留系統 DNS。

## 保護暫停歷程

啟用 power guard 的裝置將暫停／解除保護區間存入本機 `power-episode`、`power-events/`，經認證上傳 `/api/agent/power-events`；離線保留、每 30 秒最多重試一筆，重啟不改寫原始開始時間。首次更新可由既有 `power.hold` 的時間回填目前區間，無法補回先前已刪除的歷史。後台總覽／機隊可展開最近 24 小時紀錄；管理員／controller 才能讀取。解除保護僅表示允許恢復，實際掃描仍需確認目標 ACK 與上傳。Cancer 的恢復門檻於 2026-09-24 依使用者指示由 80% 調為 60%；原廠安全保護不變。

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

Fleet v2 預設不呼叫舊 `/api/agent/command`。只有明確使用 legacy primary
指令且憑證符合 legacy 接口的裝置才設 `LEGACY_COMMAND_ENABLED=1`；不把個別
Agent token 的認證放寬成共用憑證。此開關不改變 v2 派工、暫停或 ACK。

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
su -c '/data/adb/modules/pikmin_scanner_agent/control.sh resume'
```

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

## 自動降溫續掃（Cancer 單機啟用）

`power-guard.sh` 是專用掃描手機的保護閘門，預設關閉，先在 Cancer 設定
`POWER_GUARD_ENABLED='1'`。更新時必須連同 `agent.sh` 一起部署；啟用但缺少
保護程式時拒絕啟動，不默默略過。**不關閉原廠熱保護、不強制充電、不偽造
溫度或電池資料，也不變更亮度、更新率或其他 Agent 的設定。**

每約 30 秒以有逾時限制的 Android `dumpsys battery`／`thermalservice` 讀值判斷：

| 條件 | 處理 |
| --- | --- |
| Thermal Status >= 3（Severe）、電池 >= 43°C 或 <= 5°C | 停止遊戲降載 |
| 電量 <= 20% | 停止遊戲，等待安全充電 |
| 持續接電 10 分鐘仍掉 >= 3 個百分點，或 charge counter 掉 >= 30,000 uAh | 接電掉電保護；不相信單獨的「充電中」標籤 |
| 感測缺漏、格式錯誤、Android 測試覆寫或讀取逾時 | 視為未知並保護，不當成安全 |
| 降溫後符合全部復原條件 | 再領取雲端工作才開遊戲，不自行重播已取消的工作 |

復原條件：至少停止 3 分鐘，Thermal Status <= 1、電池 10–39°C、電量達到 `POWER_GUARD_RESUME_BATTERY_PERCENT`（預設 30%；Cancer 設為 60%，無效設定安全回退 80%）、
接電且 Android 顯示充電中／已充滿；連續 2 分鐘電量不減、charge counter
相比穩定期起點下降不超過 5,000 uAh。中途重新變熱、掉電或感測未知會重算
穩定時間。這些是此專案較保守的降載門檻，不是手機廠商的充電安全規格。
降低 Cancer 的電量門檻不會覆寫 Pixel「已暫時限制充電」或過熱停充；若 Android 顯示未充電，保護閘門仍不會恢復掃描。

降溫狀態另存 `power.hold`，不使用或清除 `pause.until`。手動暫停優先，
此時 Agent 不會為降溫而操作使用者的遊戲；按「繼續」也不能繞過熱保護。
重啟 Agent／手機後既有降溫 latch 會保留，但必須重新取得完整穩定觀察窗。
降溫中每約 30 秒續租當前 target，**中斷點不送成功或失敗 ACK**；恢復後雲端
仍可回傳同一點。如果工作被停止、重新分配或租約失效，則服從下一次正式派工。
既有上傳 offset、待送 ACK、Token 與工作資料皆保留。
保護模式下冷啟動遊戲會清除上一個遊戲程序的 query-only streak，並在啟動等待後
用該手機既有 `MAP_VIEW_TAP_*` 羅盤座標進入即時地圖一次，避免停在首頁卻只有
map-query 成功。暖啟動不重點羅盤；不同解析度仍須先校準這組座標。

```sh
su -c '/data/adb/modules/pikmin_scanner_agent/control.sh power-status'
su -c '/data/adb/modules/pikmin_scanner_agent/control.sh cool-now'
```

`power-status` 回傳 TSV：狀態、原因、更新 epoch、thermal status、電量%、
電池溫度（0.1°C）、是否接電、Android 充電狀態、charge counter（uAh）。
檔案是最後觀測快照，務必核對更新時間；不是執行中程序保證。
`cool-now` 只要求額外降溫，不能強制恢復或改寫感測器，可安全驗證真實降溫流程。
舊控制 App 的 `status`／`snapshot` 仍表示手動暫停狀態；自動保護須看
`power-status` 或 `power.log`，目前不向網站／Discord 宣告額外狀態。
`power.log`（含開機識別、電量、溫度、原因）保留約 128 KiB × 2，root-only，
不記錄憑證或 GPS。Agent 本身死亡時無法降載；不能取代硬體維修或系統熱保護。

驗證：

```sh
bash -n phone_agent/agent.sh
bash -n phone_agent/power-guard.sh
bash phone_agent/tests/power-guard-test.sh
bash phone_agent/tests/power-guard-integration-test.sh
bash phone_agent/tests/control-test.sh
bash phone_agent/tests/upload-chunk-test.sh
```

## PC 端用法

GUI 預設選擇「手機 Agent（免 ADB）」。命令列可使用：

```powershell
python scanner/scanner.py --device-backend agent
```

`/api/mushrooms` 的 `agent` 欄位會顯示 backend、online、last_seen、
uploaded_rows 與 current_location。

## 更新 Agent（需要最後一次可用的 ADB 或其他 root 檔案傳輸）

將本資料夾檔案複製到模組目錄，保留手機端既有的 `token` 與 `config`，
設定 shell 檔權限為 `0700`，再重新執行 `service.sh`。一般掃描不需要 ADB。
