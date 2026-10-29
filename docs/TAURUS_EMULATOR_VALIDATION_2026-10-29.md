# Taurus 模擬器部署與驗收（2026-10-29）

## 範圍與身分

使用者確認 MuMu instance 2 / Android Device-2 改名 Taurus，授權模擬器環境維護及
重開，但禁止 Windows 主機重開。建立一個獨立節點 `agent-taurus-d28181bb`
（顯示 Agent Taurus），沒有複用手機 token；暫存電腦的轉移檔在雜湊核對後已刪除。
沒有變更其它模擬器、四台實體手機、Scorpio、Discord 服務或 Sites 部署。

MuMu 6.8.0.0 / Android 15 API 35，宿主 ABI x86_64，遊戲使用 ARM64 NativeBridge。
實際維護前須同時核對 Manager instance 2/name/port 與私有紀錄的 Android ID；
`emulator-5558` 曾是同一實例的別名，不能當成另一台裝置。
保留目前解析度 1080×1920、density 240。

## 實際部署

- 遊戲 156.0 / versionCode 1792142832；兩個已安裝 APK 的 signing certificate
  SHA-256 都符合已驗證 Niantic 憑證 `944bda466eaf64be1c93896d5c8e9a454a07c8d8fcbc4adeeefb3545b335e979`。
- ARM64 libil2cpp SHA-256 `b1a9781e8e7ddbdf984f6e3e90c7f753dd3ac149881fc9c14a46892eda6f6b5d`，
  與四機 156 驗收輸入相同。沒有重新安裝遊戲或清除帳戶資料。
- Hunter 156.0-r1，明確指定 GameVersion 156.0 / GameVersionCode 1792142832 封裝。
  ARM64 payload SHA-256 `617674b4083013f012ba342a741256f67dd240c58f080574c6ca83433f77cd5c`；
  x86_64 payload SHA-256 `339380944101ba5fd8f1d8282ef6f0592cc41ca9e7ea07bcca86857e30092cc9`。
  沒有修改 native 原始碼或只改版本標籤。開機後從 NativeBridge、精確簽章檢查、
  MapObjectManager/MapManager 掛鉤及 PID 綁定 native.ready 核對實際載入。
- Agent 2.2.8，協定 MODULE_VERSION=156.0（revision 屬於安裝包，不放進遊戲相容性欄位）。
  遊戲版本仍由 runtime-version.sh 探測。
- MuMu 沒有 curl；從官方 Termux 套件庫核對 metadata 及每個 deb 的 SHA-256，
  只抽取私有 runtime，不執行套件安裝腳本。位於 `/data/adb/pikmin-taurus-curl`，
  wrapper 明確指定 CA bundle；正式 HTTPS 憑證驗證保持啟用。
- popup-probe 建置為 Android x86_64，SHA-256
  `739c3809606676dc7a0d8e7bd4de67bae4f6d526ea5196b60afbac2d6f3f2acc`。
- `AGENT_BOOT_DELAY_SECONDS=120`：boot_completed 後先等待兩分鐘再啟動 Agent，
  期間不領取 lease；預設 0 保留既有手機行為。只增加有界開機緩衝，不自動清快取。
- `MUMU_CODE_CACHE_REFRESH=1`：只有實際 Android primary ABI 為 x86_64、bridge
  為 libnb.so 且遊戲沒有程序，才在冷啟動前搬移固定的 HPTC 編譯快取檔。
  以搬移前後 SHA-256 核對，保留 root-only 的一份最新備份，避免每次開機累積副本。
  此選項預設停用，沒有部署到四台實體手機。

## 排除的環境障礙

新裝 Agent 在 root 私有 umask 下建立 teleport.txt，原本為 root:root 0600，遊戲
UID 無法讀取。Agent 改為依遊戲 files 目錄實際 UID/GID 建立 0600 控制檔；拒絕
symlink、無效 UID 或 chown/chmod 失敗。用真實 Android filesystem 驗證正反案例。
此修正僅部署 Taurus，沒有覆寫四台手機的個別熱保護與上傳差異。

首次環境發生 Android system_server 的 LocationManagerService 重複註冊 GPS provider
崩潰；boot_completed 不能視為 framework 完整就緒。Agent 的系統 GPS 初始化延後到
允許掃描且已存在真正 GPS provider 後，暫停期間不初始化。早期基準使用
`SYSTEM_GPS_OVERRIDE=0` 隔離問題；最終改為 `SYSTEM_GPS_OVERRIDE=1`，對齊系統
與遊戲內座標。2.2.8 在 MuMu 尚無真實 provider 時先啟動遊戲及等待 native，
重新核對 provider 已存在才建立 mock，不會先搶建同名 manager。

原有 Control Center canary `pcc_emulator_bridge_canary` 保留但停用，避免與 Hunter
雙重掛鉤。原有 `pcc_mumu_healthconnect` 會覆寫 system/framework/services.jar，
曾停用作對照，後來恢復原本啟用設定；在 SYSTEM_GPS_OVERRIDE=0 下沒有再出現
前述 framework 崩潰，且可登入，因此不歸因於 Health Connect。NeoZygisk 維持啟用。

曾遇到登入錯誤代碼 0：開機立即啟動時復發，停用 Hunter 的對照也會發生。
分別做過有界 Retry、備份後輪替 cache/code_cache、同區系統定位與 IPv4 對照。
輪替 code_cache 與短暫停止重試後可登入；恢復 IPv6 仍可再次登入，因此 IPv6
保留原設定。Hunter 重新啟用、延後約 140 秒手動啟動的對照也可登入。
兩分鐘緩衝單獨使用仍曾失敗；進一步只輪替 code_cache、維持原網路及模組，
由同一個 Agent 重新啟動即成功登入。目錄內觀察到約 19 MB 的
`.hptc_kache_nticlabs.pikmin`，所以自動處理縮到這一個已觀察的編譯快取檔，
沒有整目錄自動清理。MuMu 的 uname 回報 aarch64，而實際 primary ABI 是 x86_64；
保護檢查改用實際 ABI，另有 spoofed-uname 的回歸案例。
不把多步驟恢復或通用錯誤 0 誤稱為已獨立證明單一原因；沒有重設 Google 連線、
清除帳戶資料、改驗證或安裝第三方完整性修補程式。

Taurus 的 Wi-Fi 關閉會中斷 ADB，不可將 `svc wifi disable` 當成一般無影響檢查。
曾以官方 MuMuManager 的 instance 2 shell 重新啟用 Wi-Fi，再針對本實例重新連線。
全程沒有 adb kill-server、全域 disconnect、對外開放 ADB 或重開 Windows。

新增 1080×1920 繁中首頁及兩種普通提醒的 public UI 校準，兩張即時畫面一致才輸入；
不使用帳號、頭像或步數特徵。真實新首頁辨識為 dashboard 540 1815；
「不要駕駛」、「不要前往禁止進入的地點」及「不要前往危險的地點」分別使用
既有 driving / restricted / danger 復原角色，座標均為 540 1085；增加分類器與
復原流程角色必須一致的 contract 測試。模擬器本機 113 個
positive/negative/translated fixtures 通過。未知視窗保持不操作。

## 有效掃描證據

11:46 起在正式工作 #363 的印尼棉蘭取得下列獨立非零 object 目標；完成紀錄只會
在成功 ACK 後寫出，搭配 upload.offset 增加與受保護 metrics 的站台接受紀錄核對。

| target | 新行數 | 新 bytes | direct 耗時 | refresh_source |
| --- | ---: | ---: | ---: | --- |
| 1649625 | 6 | 611 | 12 秒 | object |
| 1649626 | 6 | 644 | 9 秒 | object |
| 1649621 | 4 | 424 | 10 秒 | object |
| 1649620 | 6 | 612 | 10 秒 | object |

原始新 TSV 座標與派發棉蘭目標相符；不是只用首頁、心跳或 native.ready 驗收。
offset 自 118 增至 2831。首次修復前有 1 行啟動資料被 timeout/fallback 計入，以及
零筆 ACK，全部保留但不計入本次有效驗收。空點或先 ACK 後到的資料也不拿來湊數。

12:45–12:46，新遊戲 PID 6540 自動關閉 driving 提醒並從 dashboard 進入地圖後，
在同一正式工作 #364 取得第二組有效證據，覆蓋羅馬及佛羅倫斯：

| target | 新行數 | 新 bytes | direct 耗時 | refresh_source |
| --- | ---: | ---: | ---: | --- |
| 1650486 | 4 | 412 | 12 秒 | object |
| 1650488 | 4 | 412 | 9 秒 | object |
| 1650490 | 6 | 632 | 9 秒 | object |
| 1650489 | 4 | 412 | 9 秒 | object |

TSV 新資料位於對應歐洲城市，offset 2831 → 5641，metrics 同時增加成功 ACK、
captured rows/bytes 與站台 observations。掃描工作來源為既有每日 12:00 輪替；
沒有額外建立複查工作、手動重寫城市權重或啟用 Scorpio。

冷重啟路徑另明確等待舊遊戲程序退出（最多 15 秒），並在啟動前完成 MuMu 快取
準備。退出逾時或備份／權限／checksum 失敗時拒絕啟動，保留 300 秒重啟間隔。
相關正常／逾時／失敗測試也在真實 Android shell 通過。

## 2.2.7 完整開機驗收與後續限制

12:48 重新啟動 MuMu instance 2，沒有人工啟動遊戲或點擊遊戲畫面。
service 等待 120 秒後啟動 Agent；Agent 核對並備份 HPTC 快取、自行啟動遊戲，
連續兩張畫面確認 restricted 提醒後關閉，再自行點擊 dashboard 羅盤進地圖。
新 boot 的遊戲 PID 2486 與 native.ready 的 156.0/PID 相符，以下六個新目標均
產生 object、新非零 TSV、成功上傳與 ACK（正式工作 #364，emea 均衡路線 3）：

| target | 新行數 | 新 bytes | direct 耗時 | refresh_source |
| --- | ---: | ---: | ---: | --- |
| 1650487 | 4 | 428 | 153 秒，含冷啟動 | object |
| 1650491 | 8 | 736 | 10 秒 | object |
| 1650492 | 3 | 309 | 66 秒，含換城等待 | object |
| 1650494 | 3 | 309 | 9 秒 | object |
| 1650496 | 3 | 309 | 9 秒 | object |
| 1650495 | 6 | 618 | 9 秒 | object |

offset 5641 → 9499，站台近期 ACK/observations 同時增加，metrics 顯示 healthy、
upload_failures=0。沒有以舊有維護期間的零筆／失敗目標充當開機成功證據。
實際載入 Agent 原始檔 SHA-256
`e1bdbe1113b8ea3757e81ada6f841c967bce9728b92e680026ae950e80db5190`，
與最終測試來源一致；外部 popup-probe 每次辨識即執行核對過的新 binary。
同一遊戲程序繼續正常掃描，沒有因驗收而停留於手動複查或暫停模式。

之後累積 20 個非零 object 目標，但跨到非斯及冷恢復後連續零資料；不能將前述
短時成功延伸為全天穩定。13:11 後確認真實 GPS provider 已就緒，備份後只改
SYSTEM_GPS_OVERRIDE=1 並重啟 Agent，保留遊戲、native、TSV、offset 與待送狀態。
隨後三個新的正式目標成功，座標覆蓋非斯／拉巴特：

| target | 新行數 | 新 bytes | direct 耗時 | refresh_source |
| --- | ---: | ---: | ---: | --- |
| 1650944 | 1 | 102 | 11 秒 | object |
| 1650949 | 3 | 325 | 10 秒 | object |
| 1650947 | 2 | 218 | 9 秒 | object |

此對照支持保留系統與 native 定位對齊，仍不將通用零資料或錯誤 0 歸為已證明
單一原因。新增 2.2.8 的開機定位 client 順序，防止等候由遊戲首次啟動才註冊的
provider 而無法開工；遊戲啟動失敗或 provider 仍缺少時不領工作、不搶建 mock。

## 2.2.8 最終開機與定位驗收

13:18 再次完整重開 MuMu instance 2，Agent 2.2.8 / SYSTEM_GPS_OVERRIDE=1。
全部步驟自主執行：開機緩衝、快取備份、啟動遊戲、關閉 restricted 提醒、進地圖、
等待 native、核對真實 provider 後建立 mock GPS，再領取正式工作。新遊戲 PID
2333 與 native.ready 相符，該 boot 的 system_server fatal 為 0。

經過零資料點後，以下三個新的卡薩布蘭卡目標通過；零筆 ACK 沒有拿來湊數：

| target | 新行數 | 新 bytes | direct 耗時 | refresh_source |
| --- | ---: | ---: | ---: | --- |
| 1650954 | 2 | 206 | 12 秒 | object |
| 1650952 | 3 | 309 | 12 秒 | object |
| 1650953 | 2 | 206 | 10 秒 | object |

offset 19131 → 19852，與這三筆新目標的 721 bytes 相符；站台 ACK 與 observations
同步增加，13:26 metrics 顯示 healthy、upload_failures=0。實際部署原始檔 SHA-256
`432cebda93648c57cc613e934304789831b920e0f66ead84cbb8a7e07a55c37e`，
與測試來源相符。native 與 popup-probe 保持前述已驗證 payload，沒有換 APK。
本次只驗證短時與完整開機，跨區空點、冷恢復耗時及跨日仍須長時觀察。

## 2.2.9 最終開機與冷恢復在線驗收

Taurus 最終版本為 Agent 2.2.9，啟用 `SCAN_RECOVERY_CONTROL_POLL=1`、
`SYSTEM_GPS_OVERRIDE=1`，冷重啟下限改為 900 秒。native 等待時每 30 秒檢查既有
control，維持在線及有效 lease，並尊重 pause/stop；這些輪詢不算成功掃描。
預設值仍為關閉，四台實體手機設定不變。遠端 pause、取消 lease、無 lease、
輪詢次數上限與原有 power guard 整合測試通過。

再次完整重開 instance 2，沒有人工啟動遊戲。新 boot
`e9207651-05b9-4d2d-ace9-4e2464184425`、遊戲 PID 2329，自動處理 restricted
提醒及 dashboard 羅盤，native.ready 為同一 PID / 156.0。經過阿加迪爾空點後，
13:46 核對到以下七個同一新遊戲程序的非零正式目標（工作 #364）：

| target | 新行數 | 新 bytes | direct 耗時 | refresh_source |
| --- | ---: | ---: | ---: | --- |
| 1650963 | 2 | 221 | 14 秒 | object |
| 1650716 | 3 | 309 | 67 秒，含換城等待 | object |
| 1650718 | 3 | 309 | 11 秒 | object |
| 1650720 | 2 | 206 | 10 秒 | object |
| 1650719 | 4 | 412 | 9 秒 | object |
| 1650717 | 4 | 412 | 10 秒 | object |
| 1650742 | 4 | 412 | 11 秒 | object |

每筆完成紀錄均在 ACK 成功後產生，offset 21824 → 24840，期間持續成功上傳。
同時受保護 metrics 最近一小時：完成目標 57、failed_targets=0、expired_leases=0、
captured_rows=140、captured_bytes=14405、observed_challenges=193、
upload_failures=0、healthy。這是含較早版本的滾動窗口，不全算成 2.2.9 產出；
新 boot 驗收只計上表同 PID 的非零 object 目標，不計心跳、空點或舊程序成功。

部署 Agent SHA-256 `20090616b59c4b97df1afc56366d5481ffd44761c67b106783ef681c441ebbd0`，
scan-recovery.sh SHA-256 `4a1581fbefb120f9e6e6ef3a64aa62ed1d666b8460035f1bd7ae983e3a9f40f4`，
均與最終測試來源相符。popup-probe 與兩種 ABI Hunter payload 仍為前述已驗證內容。
沒有重排路線或另派複查以取得驗收數字；正常空點持續走既有路線。

## 備份與維運限制

模擬器內 root-only 備份：`/data/adb/pikmin-taurus-backups/20261029-1042-before`。
`state.tar` 保存初始 modules、遊戲與既有 Joystick 資料，145636864 bytes / 31747 members；
`connected-baseline.tar` 保存成功登入、未啟用掃描前的遊戲及新 Agent 身分。
兩者 tar member list、0600 權限與 SHA-256 check 均已驗證；不是完整 VM 磁碟映像。
另保留各階段 config、原 teleport、cache/code_cache 與 Agent 原始檔。token 不匯出。

私人操作紀錄位於 repo 外受限目錄 `pikmin-operations/2026-10-29/taurus-setup-1035`；
包含來源 hash、無憑證診斷、即時樣本、畫面、備份結果與開機測試，私人畫面不進 Git。
回復時不要盲目恢復過期 lease、ACK 或 offset，也不自動重啟舊 Control Center 核心。

Taurus 需要 Windows、MuMu、網路持續運行。這是短時與開機恢復驗收，不代表全天穩定；
後續須觀察自然換區、跨日登入與不同區域產出。04/12/20 換區與柏林 3 倍權重保持原樣。
