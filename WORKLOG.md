# Pikmin Bloom 蘑菇搜尋研究 — WORKLOG

## 2026-09-20 — Cancer 自動降溫續掃（Agent 2.2.1，單機啟用）

- 背景：老化電池在接電且 Android 仍顯示充電中時也可能持續掉電。此次保留所有原廠熱／充電保護、使用者最低亮度與手動暫停，不改 Aries／Leo，不變更網站、情報時間或區域配置。
- 新增 opt-in `power-guard.sh`：每約 30 秒讀取真實 Android battery／thermalservice，Severe 熱限制、43°C 電池熱、低電量、感測未知、接電 10 分鐘仍掉電時停止遊戲。至少降載 3 分鐘，溫度、電量及供電連續穩定 2 分鐘才回到雲端派工。
- `power.hold` 與 `pause.until` 分開；手動暫停優先，重啟後重新觀察安全窗。冷卻時只續租／保留 target，不為中斷點寫成功／失敗 ACK；既有 offset、token、pending ACK 保留。新增 root-only、限大小的 `power.log` 和 `control.sh power-status/cool-now`。舊 APK 仍只顯示手動暫停狀態，未發布新 APK。
- 本機通過：shell 語法、保護政策／感測解析／取樣間隔／未知與過期讀值、低電量及充電標籤仍掉電、恢復遲滯與重啟 latch、手動暫停、零 dwell／啟動／fallback 中斷不誤 ACK、正常 ACK、控制腳本、UTF-8 分批上傳、Windows process identity、deployment hardening。修正 hardening 測試對既有 `run_as_shell_timeout` 的過時斷言，沒有改回錯誤的 `timeout shell-function` 寫法。
- Cancer（Pixel 3 / Android 12 / Pikmin 152）已先做 root-only 設定／程式／狀態備份，再部署相同雜湊的 2.2.1 與保護程式；未重開手機或改 native 模組。
- 實機測試（台北時間）：08:24:35 以 `cool-now` 請求額外降溫，08:24:36 遊戲 PID 消失；沒有偽造感測器或刻意加熱。電池 38.0°C → 35.0°C、Thermal Status 2 → 1、電量保持 100%，charge counter 1,262,000 → 1,264,000 uAh。08:28:10 通過真實復原條件，重新領到同一個 109/2775 target；其後 ACK 成功並繼續工作。API 在 08:29 查得 4 筆 Cancer 恢復後的觀測資料（不宣稱這是 4 個全新地點）。
- 這是單次真實降載／續掃驗證，加上政策回歸測試，不是過熱強制測試、整夜 soak 或「電池老化已修好」的證據。完整門檻、限制及查詢方式見 `phone_agent/README.md`。本次沒有 Sites／Discord 發布需求。

## 2026-09-14 — 平日巨菇通知前複查介面

- 新增獨立 `candidate-giant` 複查種類，由 Discord 服務提交凍結候選；沿用指定 Agent、D1 分批、返回原座標及同批次冪等行為。既有 `candidate` 與報後 48 小時 `giant-recheck` 不變，無 schema migration。
- GET 結果要求相同 target、完成 Agent、本次 challenge 的精確收件證據；巨菇必須仍 Lv4 且 0–4 人，重生為大菇、其他 Agent 觀測、滿員不能通過。
- 自動換區保護與手動換區取消邏輯納入新種類，避免正在複查時被當普通任務換掉。
- 配對的 ody-discord-bot 改動：週一至週五（台北發布日期）同時複查巨菇；大菇及平日巨菇列出實際發送總數與剩餘額度；巨菇仍最多 20、大菇不限，週末維持原規則，時間及 90 分鐘提前量不變。
- 本機網站 build/43 tests、正式依賴 audit 0 漏洞；Bot 61 tests 通過。正式發布與重啟需另核對部署狀態；本機通過不代表真實時段的 Discord 送達。

## 2026-09-08 — 無人職守改善第一階段，Sites v77 與三台診斷上線

- PR #85/#86 已合併：全球搜尋與排序分頁一致性、每點刷新/重啟/上傳診斷、參加人數更新與複查時間區分、受保護的情報流程明細。各功能獨立 commit，未改區域分配或 GPS 跳點節奏。
- Sites v77 於台北 07:07:36 發布成功；正式 API 五種排序在同一六小時窗口均取得 76/76 筆有效大菇、無重複。中文查詢及地圖資源 200；匿名 audit 存取被拒絕。
- Aries/Cancer/Leo 均更新 agent.sh，遊戲 PID 未變，恢復掃描與上傳，健康狀態確認。僅新診斷的短窗口不是效能結論，不把 query-only 或 +0 解讀成空點。
- 獨立通知 repo PR #2/#3 已合併，49 tests；服務重新啟動、單一 listener、原 00:00/07:00/14:00 發送及提前 90 分鐘複查均保留。既有使用者 startup 檔案未提交或覆蓋。
- 網站 build/29 tests/lint 通過，另加實際 API 的中文搜尋及游標分頁測試通過。標記為 release-validation 的 audit 事件已同步，尚不可當作真實複查到發送的完整驗收。
- 剩餘真實排程驗收及城市內路線優化接入既有 `discord` 自動化，維持 10:30/19:30 檢查及區域 shadow/canary 閘門。全部適用驗收完成後才發 Discord 完整結案報告。目前尚未結案。
- 版本、證據、回滾與限制：`docs/UNATTENDED_IMPROVEMENTS_2026-09-08.md`。

## 2026-09-07 — Leo 152 恢復正式掃描

- PR #81：Hunter 152 的 RVA／簽章及封裝預設版本，網站保留 149–151 並加入配對的 152 支援；24 tests、build、lint、GitHub checks 通過。
- 暫停測試時 Android mock GPS 雖啟用卻沒有 fix，造成有道路無 POI；有效系統 GPS + Hunter 152 實機擷取及 1km 換點成功。`GmoManager unavailable` 並不代表擷取失敗。
- 移除 Leo 寫死的 GAME_VERSION=151.0，MODULE_VERSION 改為 152.0；Sites v76 發布成功，恢復原休士頓排程。前四點全為 direct/object，3/6/6/3 筆、14/12/12/13 秒，正常上傳；後台 healthy、無資料連續次數歸零。
- 未更動 Aries/Cancer；GPS Copy/Nectar 維持原停用狀態。這是恢復驗證，不冒稱 24h soak。完整證據見 `docs/LEO_152_VALIDATION_2026-09-07.md`。

## 專案目標
不依附開啟遊戲 APP，搜尋全世界符合條件的蘑菇（Pikmin Bloom）。

## 環境 / 關鍵事實
- 手機：實體 Redmi（marble / 23049PCD8G），Android 13，arm64-v8a，Magisk root。序號 `f40b1e06`。
- adb：只有 MuMuPlayer 附帶的 `C:\Program Files\Netease\MuMuPlayer\nx_main\adb.exe`。**這版 adb 大檔 `pull` 會靜默失敗、`exec-out` 約 3.5MB 截流** → 傳大檔改走 **WiFi + nc**（`scripts/pull_via_wifi.py`，主機 192.168.50.12 / 手機 192.168.50.101 同網段）。
- Pikmin Bloom：`com.nianticlabs.pikmin` v148.0，Unity + IL2CPP，Ichigo 平台。
- 已模擬 GPS：24.166352, 120.633812（台中）。

## 已完成（截至 2026-07-13）
1. **抓包管線打通**：mitmproxy + 系統憑證（bind-mount，hash `c8750f0d`）。**無 TLS pinning**，能攔明文 HTTPS。加密封包存於 `artifacts/flows.mitm`。
2. **協定架構確認**：所有 API 打單一端點 `ichigo-rel.nianticlabs.com/frontend/rpc2`（POST）。外層 FlatBuffers 傳輸封裝，內層是 **encrypted protobuf**（payload 熵 7.97，無明文）。地圖物件在進地圖後的 22–23k 大回應。
3. **Il2CppDumper 成功**（Metadata v31，雖有保護但 `dump/dump.cs` 85MB 完整）。**核心發現**：
   - 蘑菇是**固定座標地圖物件**：`MapObjectProto{ Point point=1; oneof{ PoiMushroom=22 } }`，`PointProto{ double LatDegrees=1; double LngDegrees=2 }`，`PoiMushroomProto{ MushroomClusterId=5; OverrideCooldownSeconds=4; VisibilityControl=3; PoiChallenge=22 }`。
   - `RpcManager`（dump.cs 行 423564）列出所有 RPC。
4. 素材保存於 `artifacts/`（含 libil2cpp.so、libNianticLabsPlugin.so、global-metadata.dat）、`dump/dump.cs`、`scripts/`。

## 兩道牆（決定成敗）
- **執行期 frida attach 被反調試擋**（已證：frida 可 attach 設定 app，不能 attach Pikmin，`ptrace pokedata I/O error`）。frida-il2cpp-bridge agent 已建好（`scripts/il2cpp-agent.js`）。
- **rpc2 加密在 native `libNianticLabsPlugin.so`（session key）**，非 C# 靜態 AES（`Niantic.Ichigo.Utils.Crypto.DefaultDecrypt` 是本地存檔用）。→ 純離線解密已抓封包很難。

## 2026-07-13/14 續：反作弊實測 + OSM 交付
- **小號手機**（camellian / M2103K19G，Android13 root，已裝 playintegrityfix/tricky_store/LSPosed，Play Integrity 已偽造通過）測 frida：
  - attach 過得了 ptrace（主機主帳過不了），但 **app 有執行期反 frida 偵測，一注入就自殺重啟**。
  - 手工 patch frida-server → 改壞（GObject 型別註冊）。
  - **Florida 防偵測 server（17.11.0）**：attach 仍被偵測殺、spawn 報 `undefined symbol: main`。結論：通用 frida（含 Florida）擋不住這支 app 的反 frida，即時資料路線暫時卡住。
  - 註：這台 adb 大檔 push 也會弄掛 USB → 改用 **WiFi HTTP 下載**（手機 curl 主機 192.168.50.12:8200）。
- **改走 OSM 交付**（使用者選擇）：`scripts/mushroom_decor_finder.py` 完成並實測成功。
  - 原理：蘑菇掉的裝飾種類由所在 POI 類別決定，POI 衍生自 OSM。對應表取自社群 bloom-decor-map（39 類，見腳本內 DECOR_MAPPINGS）。
  - 用 Overpass API（多鏡像 fallback+重試，主站常 504）。用法：`python mushroom_decor_finder.py <lat> <lng> [radius] [--decor 類型] [--csv 檔]`。
  - 實測台中 24.166352,120.633812 半徑1200m --decor Cafe → 33 家、有店名+GMap 連結。

## 2026-07-14 突破：Zygisk native hook 成功擷取即時蘑菇座標 ★★★
方案2(Zygisk native-hook)**成功**。基於 Perfare/Zygisk-Il2CppDumper 改造(scratchpad/zygisk-dumper)。
- **工具鏈**：NDK r27c(scratchpad/ndk)、cmake+ninja(pip)、And64InlineHook(inline hook)。build 指令見下。
- **模組**：`zygisk_pikmin_hunter`(scratchpad/pikmin_hunter.zip)。game.h 設 com.nianticlabs.pikmin。
  - 已移除 il2cpp_dump(走遍 metadata 會被反竄改殺)。改成 install_hooks：base+RVA → A64HookFunction。
  - 修掉 il2cpp_api_init 的 il2cpp_is_vm_thread 等待(冷啟動未 init 完會 SIGSEGV)。
- **hook 點**：`MapManager.RegisterMapObject(MapObjectBase)` RVA **0xCB4596C**(v148)。讀 obj+0x38=lat, +0x40=lng；型別用 il2cpp_object_get_class/get_name。
- **關鍵驗證全過**：Zygisk 注入不被反 frida 偵測、inline hook 裝上遊戲不死、持續 hook 2000+ 物件遊戲仍活。
- **蘑菇型別 = `Niantic.Ichigo.Game.Challenge.MushroomChallenge.MapPoiBlocker`**，帶精確經緯度。實測新竹一帶抓到 15 個不重複蘑菇座標。
- 版本必須對齊：小號已升到 148(versionCode 1782528808)=離線 dump 來源，RVA 才對。
- 輸出：/data/user/0/com.nianticlabs.pikmin/files/mapobjects.log（型別\tlat\tlng）。

### build 指令
cmake -G Ninja -DCMAKE_TOOLCHAIN_FILE=ndk/.../android.toolchain.cmake -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-28 -DMODULE_NAME=pikmin_hunter -DCMAKE_BUILD_TYPE=Release -S <cpp> -B build_zygisk; cmake --build build_zygisk
更新 .so：手機 curl http://192.168.50.12:8200/arm64-v8a.so 覆蓋 /data/adb/modules/zygisk_pikmin_hunter/zygisk/arm64-v8a.so → reboot(Zygisk 只在 zygote 載入)

## 2026-07-14 續：hook 精修 + 半自動雷達完成
- **hook 精修(Phase1)**：只記蘑菇(class==MapPoiBlocker)、用蘑菇 id 去重。讀法改用 ProtoBasedMapObject 在 **0x68 的原始 MapObjectProto**：id@0x18, point@0x20(lat@0x18/lng@0x20), objectCase@0x38, PoiMushroom@0x30(clusterId@0x30,cooldown@0x28)。輸出 `/data/user/0/com.nianticlabs.pikmin/files/mushrooms.tsv`(ts\tid\tlat\tlng\tcluster\tcd)。clusterId 目前空(在 client mushroomInternal@0xD8，非 proto oneof；待補)。
- **半自動雷達(Phase2-①)**：`F:\claude_ws\pikmin\radar\radar.py`(自帶 HTTP:8321 + 背景 adb root cat 拉取、id 去重、寫 mushrooms.json) + `radar.html`(Leaflet+OSM 即時標點)。用法：`python radar.py` → 開 http://localhost:8321/radar.html → 手機 joystick 逛地圖 → 蘑菇自動標上地圖。
- 全自動瞬移(Phase2-②)未做：需 hook 送進 RPC 的座標(ILocationController/DeviceLocation 鏈)，較深；先用 joystick 半自動。

## 2026-07-14 續(2)：清理 + 蘑菇等級 完成
- ①環境清理：小號 kill fl_srv/frida-server + 刪 /data/local/tmp 大檔；主機停 mitmdump。保留 radar(8321)、部署 server(8200)、Zygisk 模組。
- ②蘑菇等級/metadata：**關鍵在 `PoiChallengeInfoProto`(在 PoiMushroomProto 的 0x18)**：
  - level_@0x4C(int,實測 1-3)、type_@0x48、challengeFinishTimeMs_@0x40、mushroomClusterId_@0x30、poiId_@0x28。
  - hook 讀取路徑：MapPoiBlocker+0x68→MapObjectProto；+0x30→PoiMushroomProto(objCase==22)；+0x18→PoiChallengeInfoProto→level/type/finish。
  - clusterId 伺服器未填(空)；mushroomInternal@0xD8 在 RegisterMapObject 當下為 null(async)故不可用，改讀 proto。
  - tsv 格式：ts\tid\tlat\tlng\tcluster\tcd\tlevel\ttype\tfinishMs。radar.py/html 已更新(按 level 分色、顯示 Lv/type/結束時間)。
- ③全自動瞬移：進行中。要 hook 送進伺服器 RPC 的座標(ILocationController/DeviceLocation 鏈)。

## 2026-07-14 收工暫存(使用者出門，晚上繼續做 ③全自動瞬移)
- 進度：①清理、②蘑菇等級 皆完成。半自動雷達可用(radar.py 在跑，pid 每次不同；開 http://localhost:8321/radar.html)。
- **③全自動瞬移設計規格書已寫好：`F:\claude_ws\pikmin\DESIGN_autoscan.md`**(含瞬移 hook 作法A/B、controller 偏移、RVA、軟封策略、開放問題、build/deploy 迴圈)。晚上直接照它開工。
- **模組已持久化到 `F:\claude_ws\pikmin\module\`**：cpp/(原始碼含所有 hook 修改)、arm64-v8a.so(目前可用版，含等級)、pikmin_hunter.zip(安裝包)、template/。→ scratchpad 若被清，從這裡重建/重部署;NDK r27c 需重抓(見上方 build 指令)。
- 環境狀態：主機 radar.py(8321)+部署 HTTP(8200) 在跑;小號已裝 Zygisk 模組(重開機自動載入)、frida/mitmproxy 已清。晚上部署新 .so 記得 8200 server 要在、手機同網段(主機 192.168.50.12)。
- 晚上第一步：照 DESIGN_autoscan §6 先解「執行期是哪個 ILocationController + Nullable 佈局 + 直接寫欄位是否生效」三個開放問題(作法A：hook get_LatestDeviceLocation 抓 this、寫 override 欄位 0xB8 或 0x30)。
待辦：環境收尾（小號 Florida server、mitmproxy/proxy、主機 HTTP server 8200、frida-server）。

---

## 2026-08-20：掃描效率調查、機隊重啟根因、agent.sh 修復、新裝置（agent5）加入正式機隊、後台效率參數調整

> 這則之前（07-14 → 08-20）的機隊化開發（`phone_agent/`、`site/` 後台、多機隊 lease 系統等）都在 git commit history 裡，沒有逐次寫進本檔；細節見 `git log main` 與 `CLAUDE_HANDOFF.md`。這則記錄的是這一次 session（Claude Code，非 Codex）從頭到尾做的事。

### 背景：使用者觀察到的問題
機隊（3 台正式 agent）掃描時「每掃一次就要重啟遊戲才能觸發蘑菇資訊更新」，懷疑是效率瓶頸，要求先查根因、再驗證是否能不靠重啟穩定掃描、最後把這台測試手機（f40b1e06，同一支後來變成 agent5）也接上正式機隊。

### 一、掃描速度 vs 效率實測
用手機上編好的 `zygisk_pikmin_hunter`（150.0-r1，`build_zygisk/` 產物），透過 `teleport.txt`（`lat,lng,token` 格式，token 需遞增才觸發套用）做瞬移＋即時擷取測試。多輪對照實驗（同城市、多方位角、8 秒刷新間隔）：

| 等效時速 | 跳點距離 | 個/分鐘（實測） |
|---|---|---|
| 100 km/h | 222m | 27.7 |
| 200 km/h | 444m | 25.4 |
| 300 km/h | 667m | 16.2 |
| 400 km/h | 889m | 18.0（雜訊大） |

**結論：跳點距離越大，單位時間收穫越少，667m 以上開始明顯漏收。** 350m 是實測支持的高效區間，也是 `gridStepM` 新預設值的依據。

### 二、機隊重啟頻繁的根因（三層，逐一排查出來的）
1. **`MAP_REFRESH_TIMEOUT_SECONDS=0`（舊預設）**：讓 `wait_for_map_refresh()` 的等待迴圈直接跳過、每個沒抓到新資料的點都無條件冷重啟，不管即時刷新有沒有機會成功。改成 `18`。
2. **螢幕休眠**：Android 螢幕進入 doze 後 Unity 的 `Update()` 每幀迴圈被系統暫停，`teleport.txt` 檔案讀寫本身不需要螢幕（背景執行緒），但套用（`SetOverride`）跟刷新都掛在 `Update()` 上，螢幕一暗整條鏈路靜默停擺，沒有任何錯誤訊號。
3. **畫面狀態（最隱蔽、影響最大）**：`RegisterMapObject`（真正的蘑菇擷取 hook）**只有在遊戲真的停在「即時地圖／探索」畫面時才會觸發**——GPS 覆寫（`SetOverride applied`）與地圖查詢往返（`map query response received`）從安全提示彈窗、每日步數回顧卡、心情打卡、分享卡、首頁儀表板送出時，全部照樣回報成功，沒有任何訊號能分辨「真的在地圖畫面」跟「卡在其他畫面」。一般 app 內重啟（`restart_game_for_scan`，非完整裝置重開機）幾乎都會直接落在首頁儀表板，不是地圖。

### 三、`phone_agent/agent.sh` 修復（已在這個 worktree 改好，見 git diff，**尚未部署到正式站台**）
- `MAP_REFRESH_TIMEOUT_SECONDS` 0→18、`MAP_REFRESH_FALLBACK_TIMEOUT_SECONDS` 40→60。
- `wait_for_map_refresh()` fallback 分支新增畫面復原邏輯，三個固定時間點各觸發一次（**不重複、不用 `KEYCODE_BACK`**）：
  - `elapsed=8s`：ENTER/DPAD_CENTER + `MAP_VIEW_TAP_*`（首頁儀表板的探索／羅盤圖示——**排最前面是刻意的**，因為外層迴圈一偵測到成功就立刻結束，排越前面的動作實際決定權越大，這個動作在一般 app 內重啟後最常見的「卡在儀表板」情境下最可靠）。
  - `elapsed=20s`：`SPEED_WARNING_TAP_*`（新發現的 Niantic「移動過快／我不是司機」對話框，長時間高速瞬移後可能出現）＋既有的 `STARTUP_WARNING_Y`／`STARTUP_CONTINUE_Y`（裝置真正重開機才會用到）。
  - `elapsed=30s`：`STARTUP_LOGIN_CONTINUE_Y` ＋再點一次 `MAP_VIEW_TAP_*` 保底。
- **繞了不少彎路，記下來避免重踩**：
  - 一開始設計成「每 20 秒重複掃過所有已知座標」，結果發現**連既有、已在正式機隊沿用的 `STARTUP_WARNING_Y` 座標**，在只有首頁儀表板、沒有真對話框時單獨點擊都可能誤觸「完成N場探索」進度條，被帶去不相干的活動／挑戰選單——這是既有座標本身就有、這次才發現的限制，不是新問題；重複點擊只會放大這個風險，不會收斂。
  - 試過加 `KEYCODE_BACK` 想收斂，結果從首頁儀表板按 BACK（沒有更上層畫面可退）會把遊戲整個切到背景、跳出到桌面或其他 App——比任何誤觸都更糟（掃描完全停擺，需要人工切回遊戲），已完全移除。
  - 最終定案：不重複、不用 BACK、把已驗證最可靠的動作排最前面。**端對端在 f40b1e06 上重複驗證多次穩定成功**（force-stop 重啟遊戲 → 8 秒後自動回到地圖畫面 → 擷取正常）。
- `SPEED_WARNING_TAP_*` 座標只驗證過「對話框存在時會被觸發」，沒有機會刻意重現「我不是司機」對話框驗證點擊精準度（那次是意外撞見）。
- `AGENT_VERSION` 2.1.0→2.2.0。

### 四、獨立運作驗證（南美，未接正式機隊前）
用 `MAP_VIEW_TAP` 手動進地圖後，寫 `scratchpad/run_sa_scan.py`（不在 repo 內，純測試腳本）：
- 10 分鐘、6 城市：零重複、零重啟，通過門檻。
- 1 小時、15 城市（聖保羅/里約/布宜諾斯艾利斯/波哥大/利馬/聖地牙哥/卡拉卡斯/基多/蒙特維多/拉巴斯/亞松森/麥德林/巴西利亞/薩爾瓦多/科爾多瓦）：**530 筆、100% 不重複、全程零重啟**。等級分布 Lv2=523(98.7%)／Lv3=7(1.3%)，當天（週四）沒有 Lv4（使用者確認合理，巨大蘑菇通常綁定週末/官方活動）。

### 五、這台手機正式加入機隊（agent5）
- 使用者透過 `mush.odyliao.cc/admin`（OpenAI workspace 登入，`adminAuthorized` 檢查 `oai-authenticated-user-email`）自行 enroll，給了 `AGENT_ID=agent5-9431de09` 與一次性 token（**沒有寫入任何會進 git 的檔案**，只存在手機上的本機 config）。
- 部署細節／踩雷：
  - `agent.sh` 的 `MODDIR=${0%/*}` 用相對路徑執行（`sh agent.sh`）會算錯目錄（`$0` 沒有 `/` 時 `${0%/*}` 不會 strip 掉任何東西），必須用絕對路徑 `sh /data/local/tmp/agent5/agent.sh`——這是舊 code 本來就有的小陷阱，跟今晚改動無關。
  - device config 的觸控座標**必須用這台裝置實測過的真實 1080x2400 像素值**，不能直接套用 `config.example` 裡 720x1600（virtual display 基準）的預設值——`agent.sh` 不會自動依解析度換算。
- 啟動後立即在正式任務佇列拿到既有任務（越南 5243 點，跟另外 3 台機隊共用同一佇列、搶不同點，任務點號因此跳來跳去）。**實測到一次完整的 `direct refresh timeout → fallback → cold restart → 復原成功（source=object）` 全流程**，206 秒後正常接續，之後連續多點都是 `mode=direct` 8-11 秒完成——今晚修的復原邏輯在正式環境第一次實戰考驗通過。

### 六、後台效率參數調整（`site/lib/scan-plans.ts` / `site/app/admin/admin-client.tsx`，**尚未部署**）
使用者要求：更多城市、範圍從市中心擴大到含郊區（數公里）、跨城市時間壓到 10 秒、機制未來要推廣到所有 agent。
- **跨城市冷卻公式**：原本 `max(設定值, min(120, 距離公里/10))`——不管 `cooldownS` 設多低，遠距離城市永遠至少等到接近 120 秒。今晚的瞬移實測（含洲際跳點）沒有觀察到距離造成任何額外失敗率或延遲，這個按距離疊加的安全邊際沒有實測依據，**已拿掉，改成直接用 `cooldownS`**（預設 45→10）。
- **`radiusKm` 預設 2km→8km**（市中心→含郊區）。副作用：搭配 `gridStepM=350`，單一城市點數暴增約 40 倍（49→2116 點）。
- **任務點數上限 10,000→30,000**：使用者選擇「提高上限」而非壓低廣度或深度，但**沒有直接衝到「全世界 65 個城市包＋滿 8km」需要的近百萬點**——那個量級沒有實測過會不會讓 `materializeTargets()` 的 D1 batch 寫入（每 50 個 statement 一次 `db.batch()`）觸發 Cloudflare Worker 執行時間逾時，先求穩，之後真的要衝更大需要把 materialize 改成非同步/分批背景處理（不在這次最小成本改動範圍內）。
- 後台管理頁加「全選全世界」一鍵按鈕；補上台灣、加拿大兩個原本缺的城市包（現在共 65 個城市包、443 個城市）。

### 七、卡住的地方：部署需要 Codex Sites 平台憑證，Claude Code 沒有
`mush.odyliao.cc` 部署流程（見 `CLAUDE_HANDOFF.md` §11.3）：`npm test` → commit → `git subtree split --prefix site` → **取得短效 Sites source credential** → push 到 `codex-sites` remote（`git.chatgpt-team.site/.../appgprj_....git`，已存在但憑證已失效）→ 用 Sites `package-site.sh` → save version → deploy version → poll succeeded。**第 4 步「取得短效 Sites source credential」需要 OpenAI Codex CLI 平台的專屬對接能力，這個 session（Claude Code）沒有這個管道**，環境變數、`.git-credentials`、credential helper 都查過，沒有殘留可用的憑證。

### 現況總結
- **已做、已驗證**：速度效率結論、機隊重啟三層根因、`agent.sh` 復原邏輯修復（多次端對端驗證）、agent5 已連上正式機隊且實戰跑過完整的 fallback 復原流程、後台效率參數改好且過 typecheck/lint。
- **尚未做**：這批程式碼變更（`phone_agent/*`、`site/lib/scan-plans.ts`、`site/app/admin/admin-client.tsx`、`README.md`、`CLAUDE_HANDOFF.md`）**尚未 commit**（本則之後會 commit＋push 到 GitHub `origin`）；**尚未部署**到正式 `mush.odyliao.cc`（卡在上述憑證問題）；`phone_agent` 修復版也還沒推廣到另外 3 台正式機隊（同樣需要部署管道，或對那些手機的直接存取權）。
- **下次接手（不論是 Codex 或下一個 Claude session）從哪開始**：① 用 Codex CLI 完成上述部署流程，或提供／協助取得 Sites source credential 給 Claude 直接操作；② 部署後觀察 agent5（及未來擴大到的其他機隊）在新設定下的實際效率，尤其 30,000 點上限附近 `materializeTargets` 的實際耗時；③ 把 `phone_agent/agent.sh` 修復版推廣到另外 3 台正式機隊。

---

## 2026-08-20（續5）：PR #44/#45 已部署上線、找到 3 台正式機隊、推廣修復版時發現並修好一個嚴重迴歸（PR #48）

- **部署確認**：Codex 那邊已經完成 PR #44 + #45 的部署（Sites version 39），`GET mush.odyliao.cc/api/mushrooms?limit=1` 回 200，正式站台在跑新程式碼。另外開了 `D1_MATERIALIZATION_CAPACITY_TASK_2026-08-20.md`（PR #47）交辦給 Codex 去實測 30,000 點上限附近 `materializeTargets()` 的實際耗時。
- **意外找到 3 台正式機隊手機**：主機（這台電腦）跟機隊手機同一個區網（`192.168.50.0/24`），機隊本來就設計了 `WIFI_ADB_PORT` 這個功能（`service.sh` 開機時會設定固定 WiFi ADB 埠）。掃這個網段的 5555 埠，找到並用 `adb connect` 連上 3 台：
  - `192.168.50.23` → `primary`（camellian，Android 13，`LOCAL_DISPLAY=1` 虛擬顯示）
  - `192.168.50.43` → `agent-2-asus-cc9c0d70`（ASUS Zenfone，Android 9，`LOCAL_DISPLAY=0` 實體螢幕，已裝 `cc.odyliao.pikmingpsbridge`）
  - `192.168.50.52` → `agent-4-pixel-3-cd8643b9`（Pixel 3，Android 12，`LOCAL_DISPLAY=1` 虛擬顯示）
  - （另外掃到 `192.168.50.90` 序號比對後確認是 f40b1e06/agent5 本機同時掛 WiFi，不是新裝置。）
- **把修好的 `agent.sh`（2.2.0）推到這 3 台**，過程中在 `192.168.50.23`（camellian）重啟後發現卡住：`[display] virtual display unavailable`，但手動查 `cmd display get-displays`／`game.display` 檔都顯示虛擬顯示（display id 2）正常。追下去發現是**合併進來的 Android 9 修復 PR 本身就有的 bug**：`game_display_id()` 裡的 `timeout -k 2 "$N" run_as_shell "..."`——`run_as_shell` 是 shell function，不是執行檔，`timeout` 沒辦法 exec 它（`timeout: exec run_as_shell: No such file or directory`，exit 127）。這個路徑**只有 `LOCAL_DISPLAY=1` 的裝置會踩到**（`game_display_id()` 只在虛擬顯示模式下被呼叫），所以在 `LOCAL_DISPLAY=0` 的 agent5／agent2 上完全沒發現。
  - 修法：新增 `run_as_shell_timeout()`，把 `timeout` 包在真正的 `$MAGISK_SU` 執行檔外面（`timeout` 可以正確 exec 這個），而不是包在 shell function 外面。手動驗證過修復前後的確切指令（修復前 exit 127、修復後 exit 0 且輸出正確）才動手改，改完在 camellian 跟 agent4 上重新部署驗證都恢復正常（`mode=direct`，無 `[display]` 錯誤，任務正常完成）。
  - 已開 **PR #48** 送回 repo。
- **agent2（ASUS 實體螢幕）的 `MAP_VIEW_TAP` 座標**：不能沿用範本或 agent5 的數值（解析度不同：1080x1920 vs agent5 的 1080x2400），現場截圖＋PIL 精確量測後校準為 `(500, 1802)`；量出來的安全提示按鈕位置 `(500, 1093)` 跟裝置既有設定的 `(540, 1065)` 很接近，互相印證既有校準可信。
- **現況**：4 台（primary/camellian、agent2、agent4、agent5）**全部在跑 2.2.0**，含這次修的 display-timeout bug。PR #48 已推送，CI 跑完待合併。
- 未完成：PR #48 尚未合併；`D1_MATERIALIZATION_CAPACITY_TASK`（PR #47）的實測還沒人做；agent2 的 `SPEED_WARNING_TAP` 座標是用既有 `STARTUP_WARNING_Y` 的值估的，沒有實際畫面驗證過。
- 下次從哪開始：① 合併 PR #48；② 觀察 4 台機隊在新版下運作一段時間是否穩定（尤其確認 `query-only empty streak` 是否顯著下降）；③ Codex 那邊處理 D1 materialization 實測任務。

---

## 2026-08-20（續6）：D1 materialization capacity 實測 — 30,000 點工作目前無法建立

- 依 `D1_MATERIALIZATION_CAPACITY_TASK_2026-08-20.md` 採 **Option A** 在正式後台執行真實工作建立測試。測試配置為「美國東部」（12 城市）＋「貝里斯」（2 城市），`radiusKm=8`、`gridStepM=350`、`dwellS=8`、`hopDelayS=2`、`cooldownS=10`、持續循環；`buildScanPlan()` 的實際結果為 **29,624 點**，距 30,000 點上限 376 點。
- 測試前先停止既有工作 #120；測試工作建立要求在後台回傳/顯示錯誤 **`D1_ERROR: string or blob too big: SQLITE_TOOBIG`**。UI 操作至取得明確結果的觀測上限為 8.3 秒；這不是 `materializeTargets()` 慢或 Worker timeout。
- 根因在 `site/app/api/admin/scans/start/route.ts`：它先把完整 `targets` 陣列序列化並寫入 `scan_jobs.plan_json`，再呼叫 `materializeTargets()`。29,624 點的 `plan_json` 已超出 D1/SQLite 單一字串/資料列可接受大小，因此失敗發生在 `scan_jobs` INSERT，`materializeTargets()` **尚未執行**。
- 結果：此輪 `db.batch()` 呼叫數為 **0**；沒有建立可量測的 job、沒有 `scan_targets` 寫入，因此不存在 partial materialization 或可比對的 target row count。原本「30,000 點 cap」雖在 `buildScanPlan()` 層允許，實際上受 `plan_json` 儲存模型限制而不可達。
- 後續：先設計並實作不依賴完整 `plan_json` 的可恢復工作描述（例如僅持久化 normalized config/regions、分段生成與寫入 targets，並保存 materialization progress）。完成後再重新執行接近 30,000 點的實測，記錄真正的 batch 數、D1 寫入耗時、完成列數與 Worker headroom；不要把此次 `SQLITE_TOOBIG` 當成同步 materialization 可安全支援 30,000 點的證據。
