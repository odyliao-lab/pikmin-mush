# 竹北 156.1 升級驗收（2026-11-06）

Aquarius、Sagittarius、Capricorn 已完成原地升級，各通過至少三個不同新正式
非零目標與站端交叉驗證，ADB 回到 shell 後仍有新資料。短期驗收不代表全天穩定。

## 來源與保全

從 `odyliao-lab/pikmin-mush` main
`9ad42397e7dbbcded9d2c37a354c72c35a9ad694` 建立獨立工作樹。
保留原 deployment-source、hosting-source 及其他工作樹，不切分支或覆蓋工作。
本次不修改網站、路線、dispatcher、Discord sender 或機隊憑證。
正式相容站台既有版本為 133，另以實際接受資料驗證相容性。

官方簽署 156.1 / code1793076318 的 base 和 ARM64 split 均獨立通過
apksigner v3 驗證，簽署者與既有 156.0 相同：
`944bda466eaf64be1c93896d5c8e9a454a07c8d8fcbc4adeeefb3545b335e979`。
APK 容器與台中候選的容器雜湊不同；不可宣稱同一容器。
內部 ARM64 ELF 與 metadata 則精確相同：

| 輸入／產物 | SHA-256 |
| --- | --- |
| 156.1 base APK | `8403677b1a29eea6faf14d27e4accab7e1be575afb3a56583fe3834f988856c2` |
| ARM64 split APK | `dc7f214f5ae9f0a7b8b905fb48aa689f8f65c23f3de2207a7bbf7f92099b8642` |
| ARM64 libil2cpp | `97ef6650f73d99ca8c7ebbbdf2d059d0d41ea68c036fde05634003f6a052aefb` |
| metadata | `b3e4d8ec9a9e8794f68132b01c49a7b05f1be57497654efd1d785892e5810eff` |
| 重建 Hunter ARM64 | `2dc01b7ef621227da430e0e61b4c7867d1549c3d0f1a81cf67b36c3cb51b7880` |
| 重建 Hunter x86_64 | `3a9e2177b379ae68718c016e71839b7c4d04233e5a2673fdc8011a060ae8d010` |

NDK27.3.13750724 雙 ABI 重建成功；Hunter 為 156.1-r1，保留 libnb.so
30 秒等待。`profile1561-test.py` 精確 ELF／metadata／dump、RVA 映射、
32-byte prologue、消費欄位布局及 fail-closed 測試通過。
Agent 保留 2.2.10 與原腳本，僅同步 MODULE_VERSION=156.1。

每台以即時 MuMu 建立識別、index、專屬 serial、Android ID、有效 AGENT_ID
與正式雲端節點核對。完整 Agent、認證、Hunter、TSV、游標、pending／ACK
在裝置內建立 root-only live 備份；ACK 邊界暫停、排空並停止 Agent／遊戲後，
再建立 quiescent 備份。驗證權限、歸屬、tar 可讀取、重新解包與檔案雜湊。
live 多檔快照不是原子快照。原始私人證據及 APK 只存 repo 外，認證備份不離開 guest。

已驗證的 quiescent archive 收據如下；每份原檔仍只在所屬 guest 中：

| 節點 | Bytes | Archive SHA-256 |
| --- | --- | --- |
| Aquarius | 26401792 | `68278a159ece896c47ffa098c038eee0598b7f8d2566354d4117df95c93e903e` |
| Sagittarius | 36460032 | `994d7d59142d5aa0fd56673cd07b03127395043f3f2883d3b0f55b8f103f4625` |
| Capricorn | 33516032 | `6e5c8b603b53d037aba46250462a3cb8f4f305150b1289e385e5fae7bec9a421` |

## 逐台結果

| 節點 | MuMu index／serial | 非秘密 AGENT_ID | 結果 |
| --- | --- | --- | --- |
| Aquarius | 3 / 127.0.0.1:16480 | agent-aquarius-01ee2f52 | 156.1 / Hunter156.1-r1 / Agent2.2.10 已驗收 |
| Sagittarius | 2 / 127.0.0.1:16448 | agent-sagittarius-5ee373c2 | 156.1 / Hunter156.1-r1 / Agent2.2.10 已驗收 |
| Capricorn | 0 / 127.0.0.1:16384 | agent-capricorn-48d6f24e | 156.1 / Hunter156.1-r1 / Agent2.2.10 已驗收 |

原 Android ID 的核對／還原收據保留於各自本機私人證據，不在 Git 公布裝置識別碼。

三台沿用 2vCPU／2GiB、Vulkan、1080×1920／240DPI。
原常態 CPU20%／FPS15、冷啟 warmup、唯一資源控制程序及有界生命週期均保留。
沒有新增 RAM／commit／換頁停機門檻。模擬器實體電池量測不適用。

Aquarius 本次 boot 的遊戲 PID2989，native.ready 為該 PID／156.1；
實際 mapped Hunter 與遊戲 ELF 符合上表，所有原 Agent 腳本及其他 config 相符。
以下均在常態政策套用時間 14:40:07 +08 後開始，來自不同新正式目標：

| 節點／job | 目標 ID（point） | 新 rows／bytes | 站端 ACK 時間（+08） |
| --- | --- | --- | --- |
| Aquarius /418 | 2130214（235） | 4 /407 | 14:40:39 |
| Aquarius /418 | 2130215（236） | 3 /305 | 14:40:55 |
| Aquarius /418 | 2130217（238） | 4 /408 | 14:41:12 |
| Sagittarius /418 | 2130715（736） | 6 /633 | 14:53:12 |
| Sagittarius /418 | 2131054（1075） | 1 /103 | 14:54:00 |
| Sagittarius /418 | 2131048（1069） | 1 /103 | 14:56:17 |
| Capricorn /418 | 2130617（638） | 5 /514 | 15:11:42 |
| Capricorn /418 | 2130614（635） | 10 /1030 | 15:12:53 |
| Capricorn /418 | 2130616（637） | 5 /546 | 15:13:27 |

逐點交叉對照本次遊戲 native map object、刷新、帶時間的新 TSV、已接受游標
涵蓋的 byte ranges、ACK rows／bytes 一致及成功 completed 路徑；
另以既有管理員登入的站端逐 point 日誌核對行數。
Aquarius 最後 guarded ADB unroot 後 Agent／遊戲 PID 均保持不變；
站端再接受 +1row／102bytes（14:42:41 +08）。
Sagittarius 的 native.ready／遊戲 PID4007 為156.1，mapped Hunter／遊戲及
原 Agent 檔案驗證通過；常態政策時間為14:52:45 +08。
最後 guarded ADB unroot 保持同一 Agent3871／game4007，站端之後再接受
+1row／103bytes（14:59:01 +08）。原 SSAID 表在 MuMu 正常重啟後逐 byte 相同。
Capricorn 的 native.ready／遊戲 PID3367 為156.1，mapped Hunter／遊戲及原
Agent 檔案驗證通過，常態政策時間為15:11:03 +08。原 SSAID 表逐 byte 相同。
最後 guarded ADB unroot 保持同一 Agent3246／game3367，站端之後再接受
+31rows／3206bytes（最新15:17:10 +08），enabled=1、paused=0。

後續也觀察到 Aquarius、Sagittarius 依原有策略自動冷啟，並非本次額外手動重啟。
Aquarius 新遊戲22940再次驗證 native.ready／映射及8個完整非零目標，
再次 root→shell 保持同一 Agent／遊戲；Sagittarius 新遊戲12762亦通過映射、
native.ready及ADB存活驗證，站端後續繼續接受新資料。這些觀察不延伸成全天穩定宣稱。

## Aquarius 身分事故與恢復

首次以 adb reboot 啟動後，Android ID 變成另一值；掃描維持手動暫停。
logcat 顯示 nemuinit 移除 settings_ssaid.xml，SettingsProvider 同時報告
secure／SSAID 不存在並產生新 Android ID。當時 guest nemud.device.reset=1，
但 MuMu 持久設定 vm.phone.rom.reset=0。不得以修改資源政策接受這個新身分。

原 secure／SSAID fallback 尚存，包含原 Android ID 及原 per-app 表。
先在 guest root-only 備份現況、fallback、權限與驗證雜湊；透過 SettingsProvider
恢復原 global Android ID，停止 framework 後恢復原 SSAID 表，保留其他現行 secure
設定，再正常 MuMu 關閉／啟動此 instance。重啟後原 ID 恢復、SSAID 表與原 guest
備份逐 byte 相同，nemud.device.reset=0；既有帳戶直接進地圖，無清資料或換認證。
此有界恢復沒有重啟電腦，也沒有操作其他 instance。後續兩台改用正常 MuMu 流程。

## 巡檢、權限與未完成事項

原巡檢的缺程序恢復分支曾把含認證的 tar 匯到主機；本次改成 guest root-only
備份並驗證解包／權限／雜湊，只回傳安全收據。備份失敗時不啟動 service，
也不消耗恢復次數。原兩次／三小時上限、冷卻、手動暫停、唯一主程序、cgroup
檢查、鎖與排程均不變。11 項測試通過，Aquarius 實機 guest 備份收據驗證通過。
沒有為測試故意殺掉正式 Agent。當地 Aquarius 同等備份分支同步修正。
現有 `capricorn-24` 三小時 heartbeat 仍為 ACTIVE，已涵蓋三台且沒有舊版鎖；
這次只檢視，沒有新增、改寫、挪用或跨對話傳訊。三台當地 runtime verifier
已同步本次精確映射雜湊，provisioned manifest 只同步實際新 config 的雜湊。

既有管理員 metrics 讀取成功；controller/maintenance 對該登入回401，已停止
該路徑，未換 token 或放寬驗證。另以既有 Sites owner 的唯讀 D1 全部分頁查核
449 筆 controller dispatch，無 active 登記派工，並核對本機維護紀錄與鎖。
不能將 controller GET 列為通過。

## 資源觀察與限制

兩段各約15分鐘採樣，合計356筆，跨14:38–15:15約37分鐘，中間有採樣缺口；
不能稱為連續37分鐘量測。主機CPU32.74–73.42%（平均49.35%），
可用RAM4497–8093MiB，commit79.75–90.30%，GPU6–15%，
VRAM3504–4878MiB／6144MiB。重建VM後舊PID的process CPU欄位可為null，
身分及政策以當下controller快照重新核對，沒有沿用舊PID操作。
15:05單點換頁75pages/sec，pagefile使用1162MiB，C/D可用約276/802GiB。
這些是觀察資料，不是啟動／停機門檻；沒有因數據而停掃描或改政策。

待完成：24 小時耐久與長期冷啟／無資料行為觀察。既有三小時巡檢繼續維護，
不新增排程；計畫性升級已中斷舊觀察窗，不能承接舊窗宣稱24h通過。
controller/maintenance 的401路徑仍未通過，已記錄合法替代唯讀盤點的範圍。
失敗時保全 guest 備份／資料，手動暫停受影響節點，採相容的 forward 修復；
不得降級遊戲、清資料、回退 DB 或重送已接受資料。網站本次無變更，無新網站發布。
