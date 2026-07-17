# Pikmin Bloom 蘑菇搜尋研究 — WORKLOG

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
