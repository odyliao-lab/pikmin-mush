# 竹北 156.1 升級提示詞

請在竹北電腦執行，僅升級當地三個正式模擬器 Agent：Aquarius
(`agent-aquarius-01ee2f52`)、Sagittarius (`agent-sagittarius-5ee373c2`)、
Capricorn (`agent-capricorn-48d6f24e`)。先核對現行正式機隊、實際所在主機、
MuMu instance 與其建立識別、專屬 ADB endpoint、Android ID、有效 AGENT_ID
和雲端節點一致。不要操作台中七個成員、Scorpio 或其他 instance。

目標：遊戲 156.1 / versionCode 1793076318、相容 Hunter 與原機掃描套件，
全部完成至少三個不同新正式目標的 native object 刷新、非零新增 TSV、
成功上傳、站台接受和成功 ACK，再確認回原掃描工作。
授權必要的單 instance 重啟與套件部署；不得重啟電腦。

從 https://github.com/odyliao-lab/pikmin-mush 的最新 main 開始，保留未提交修改。
先讀適用 AGENTS.md、README.md、phone_agent/README.md、docs/RELEASE_GATES.md、
docs/FLEET_1561_CANDIDATE_2026-11-06.md 與當地最新驗收／維運文件。
156.1 相容程式已由 PR192 合併，正式站台已發布相容性；仍須重新驗證現況。
不要直接重跑台中的舊操作腳本或沿用台中 IP、instance、帳戶、私密檔路徑。

先以現行正式受限憑證與既有驗證實作，唯讀檢查
https://mush.odyliao.cc/api/admin/metrics?hours=1 和
https://mush.odyliao.cc/api/controller/maintenance。
401/403 停止該路徑，不換 token、不放寬驗證。確認無正式複查／他人維護衝突。
保留唯一 dispatcher、Discord sender、排程與既有路線分配。

每次只部署一個 instance。任何裝置狀態改變前，先於該 instance 內建立並
驗證 root-only 備份，涵蓋原 Hunter、完整 Agent/config/token、upload.offset、
未決狀態、待送資料、ACK 和原 TSV；驗證退出碼、權限與雜湊，記錄快照一致性限制。
手機／模擬器憑證不得匯出。等待 ACK 邊界後才停止已確認的 Agent 程序，
不刪 pending、offset、TSV 或遊戲資料，不共用其他節點憑證。

MuMu 重啟另須保全 guest 內的 Android Settings／SSAID 原檔及 fallback，
仍只存於裝置內 root-only 備份，不輸出 per-app ID 或 user key。
先核對該 instance 的裝置重設設定，使用 MuMu 正常單 instance 關閉／啟動，
不要以 `adb reboot` 代替：竹北 Aquarius 曾因沿用開機時的 device-reset
屬性，由 nemuinit 移除 secure／SSAID 設定，造成 Android ID 重生。
重啟後 Android ID 或應用程式識別異常時保持手動暫停，先保全現況並查核
原 guest 備份；不得改信任清單來接受新 ID，也不得盲目覆蓋其他 instance
或清遊戲資料。這次事故與有界還原記錄見
[竹北驗收文件](ZHUBEI_1561_VALIDATION_2026-11-06.md)。

取得有來源的官方簽署 156.1 安裝檔，驗證簽章及既有簽署者相符，再就地更新。
台中精確 ARM64 輸入見候選文件；如取得不同 ABI／版本碼，需獨立分析驗證，
不可將 ARM64 指標直接套到原生 x86 遊戲。Hunter 從對應 main 原始碼重建並
核對精確156.1 ELF、metadata、RVA映射、32-byte簽章及消費欄位布局測試。
保留 MuMu libnb.so 專用30秒載入等待及原有生命週期實作；編譯成功不算實機通過。
只同步必要 MODULE_VERSION=156.1，保留各自 Agent 認證與上傳實作。
Sagittarius／Capricorn 的 SERVICE_DETACH_ADB_CGROUP=1 及既有
scanner-lifecycle.py ensure --keep-root 流程應依實裝文件保留；不要任意 adb root/unroot
殺掉繼承 adbd cgroup 的服務，也不要啟動第二個 Agent。

以新鮮畫面排除已知普通提示，帳戶依當地文件與畫面核對，不假設相同。
密碼、2FA、驗證碼、不同帳戶、未知同意或付費畫面停止該項並回報人工操作。
不繞過登入／驗證、不降級或清資料、不重建節點或 DB。
不得 adb kill-server、全域 disconnect 或公開 ADB。

每個 instance 重啟後核對真正載入的 Hunter、當前遊戲 PID／版本與 native.ready
一致；遵守原冷啟節流與就緒等待。逐點保存目標、新非零 TSV、native 物件、
上傳游標／HTTP結果、站台接受和 ACK 的可對照安全證據。零筆、query-only、
timeout、心跳與單一成功點不計完整驗收；不足標示部分恢復／待觀察。
模擬器實體電池量測標為不適用。

私人證據保存於 repo 外；公開文件只記錄安全雜湊、版本與驗收摘要。
完成後提交推送必要程式／文件改動；只有網站有變更才依發布規則發布，
保留既有正式站台資料、對外權限與綁定。最後逐台回報安裝版本、載入版本、
三個驗收目標、最新站台接受時間及任何未完成項目，不宣稱全天穩定。
