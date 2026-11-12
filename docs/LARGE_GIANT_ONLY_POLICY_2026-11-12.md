# 大菇／巨菇保留政策 — 2026-11-12

使用者要求只保留level3大菇、level4巨菇；小菇1及一般菇2排除，網站一般菇篩選移除，既有一般菇可清理。不得把不同主機的部署與驗收混為一談。

## 站端與相容性

`site/lib/mushroom-policy.mjs` 為唯一站端接受等級判定，parse及直接upsert都只保留3/4，未知尺寸也不接受。公開API無法以舊 `levels=2` 取得一般菇；舊客戶端仍可送合法舊等級篩選，但結果受新政策限制。新UI只提供大／巨大兩項，保留類型、GPS授權與排序。map三處CSP精確hash同步，不放寬認證或安全政策。

舊Hunter／Agent在完成逐台更新前仍可能傳輸含一般菇的原始TSV。站端忽略它們但仍接受合法傳輸，保留raw byte範圍、partial、receipt-v1去重回覆及舊ACK相容；不能為濾資料更改不可變pending body／range或直接重設游標。先前已接受的receipt重試仍回覆原accepted count，不重新插入被移除的資料。`captured_rows`／raw uploaded bytes可能包含舊口徑，不能冒充新政策的大菇有效量。

## 既有資料清理與回復

管理後台「歷史資料清理」新增等級清理區；GET `/api/admin/mushroom-policy` 只供既有admin／controller唯讀；POST只允許既有管理員、精確同來源JSON與固定action，不接受任意SQL或表名。

清理範圍只有 `mushrooms` 快照與 `mushroom_observations` 中非3/4紀錄。每批每表最多5000筆、備份總量最多2MiB；每個D1 batch先把全欄位JSON寫入 `retention_backups` 再刪除，任一statement失敗整批回滾。過大資料不強刪，零進度停止。兩表各自原子，跨兩表不是單一大交易；先完成的批次仍可回復。

POST只回報已提交批次，完整盤點獨立GET並降為每10批讀取一次；最終必須獨立盤點為零才宣告完成，避免後續統計失敗把已提交交易誤判成失敗。備份7天，內容不透過HTTP回傳。`restoreMushroomLevelBackup` 是維運函式而非公開寫入入口，只能恢復此政策備份且不覆蓋較新live資料；完整回復須先恢復相容接受政策，再以受控維運通道逐鍵恢復。單純回退程式版本不等於資料已恢復。

保留共用挑戰／地點身分、upload receipts、Agent/config/token、offset、pending ACK、lease、路線與任務歷史。這些不是可任意清除的一般菇清單資料；不得為統計回溯重寫舊計數。

## Hunter／Agent候選來源

Native只更改 `module/cpp/il2cpp_dump.cpp` 的TSV輸出尺寸判定，保留native object刷新marker與所有遊戲版本指紋、offset、NativeBridge、等待及既有hook。不能把沒有大／巨菇的正常object刷新判為故障。

Agent來源預設版本2.2.16，snapshot／useful rows只計3/4；raw bytes仍覆蓋同一完整換行前綴。Capricorn候選2.2.15實測發現：刷新標記可能比大菇註冊早0.28～2.4秒，原先第一次snapshot結算為零，既有等待期間到達的3級資料卻在最後upload送出。2.2.16在原有等待後、最後upload及凍結pending ACK前，重新取得一致的完整TSV前綴與delta；若上傳未涵蓋該前綴，仍保留pending，不能提前ACK。無新增等待或冷啟動。Uploader、認證、ACK／pending格式、冷啟節流及保護設定不因尺寸政策重寫。正式節點是scoped變體，只移植這些必要修改，不整包覆蓋其他主機或Capricorn的暖重試／冷啟策略。

Hunter候選獨立命名157.0-r2-large-giant（遊戲仍157.0／1793360009），不是替換同名r1資產。NDK27.3.13750724與CMake3.22.1的ARM64／x86_64建置及正式packaging script已通過；原APK不變。候選ZIP SHA256：`da3627773970a9cf396d1f32a3ef9048ba46a352314ad9b52cd7250a9aa6fecf`。此處是建置證據，並非各裝置已載入或實機驗收。

## 分機隊部署與驗收

竹北任務只處理竹北；台中需交由台中既有部署／巡檢任務。每次先重核實際身份及原配置、guest內root-only完整且可解壓／雜湊驗證的備份；copied offset≤copied TSV，live複本非跨檔原子。安全邊界停止唯一原Agent，保持原Uploader與私有狀態，就地更新匹配Hunter／scoped Agent，重啟單一guest使Zygisk重新載入，再核對映射檔／PID／版本。

每台至少3個不同新正式target：native object→新非零且全為3/4的TSV→正常接受上傳／游標涵蓋→站端新3/4資料→有效ACK。另觀察有object但無大／巨菇的合法空點，不應因此新增冷啟迴圈。未達標標部分／待驗，不能用舊TSV、心跳、query-only或native.ready湊數。保留有界恢復、原資格與04/12/20、12時柏林3倍及正式複查優先。不跨主機操作、不新增dispatcher或巡檢。

## 產能觀測

使用者已排程的產能盤點需等政策正式生效與清理確認，再以3/4口徑重建至少48小時資料；舊2–4數量不可直接比較。各地Hunter更新前後的傳輸量分開，站端保留量與原始wire bytes分開。實際發布版本、清理數量及逐機部署結果見當地主機交接；此文件不宣稱全天穩定。
