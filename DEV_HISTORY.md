# Pikmin Bloom 蘑菇雷達 — 完整開發歷程與交接文件

> 本文件供接手的開發者/AI（Codex）從目前進度繼續。內容涵蓋：目標、環境、完整歷程（含走過的死路）、
> 最終架構、所有技術細節（hook 點/RVA/結構偏移/protobuf 資料模型）、build/deploy/test 流程、
> 目前狀態、以及下一步（全自動瞬移掃描）。程式碼與素材在同資料夾。

---

## 1. 專案目標

**不依附開啟遊戲操作，取得「各地區即時蘑菇狀態」**（Pikmin Bloom）——哪裡有蘑菇、等級、何時消失。
使用者最初想要「完全不開遊戲的獨立 client」，但因 Niantic 加密+簽章+反作弊無法達成（見歷程）；
**最終達成的形態**：遊戲在（已 root 的）手機上跑，用 Zygisk 原生 hook 直接讀遊戲解密後的記憶體物件，
把蘑菇資料（座標/等級/類型/結束時間）外傳到主機，主機端在地圖上即時標點。**這已可運作。**

---

## 2. 環境

### 手機
- **小號手機（目前開發用）**：Redmi Note 10 5G，代號 `camellian`，型號 `M2103K19G`，Android 13(SDK33)，arm64-v8a。
  - **Magisk Kitsune (27001)，Zygisk 已啟用**。已裝：`playintegrityfix`、`tricky_store`（Play Integrity 已偽造通過）、`zygisk_lsposed`。
  - GPS 用 **joystick app** 假定位（隨機包名 `com.thetkwkldwmv.bduhvigrlqqgydt`，透過 GMS mock location）。
  - Pikmin Bloom **148.0 / versionCode 1782528808**（= 離線 dump 來源，RVA 才對得上）。
  - 已裝 Zygisk 模組 `zygisk_pikmin_hunter`（重開機自動載入）。
- 主帳手機（marble / 23049PCD8G，Android13 root）：早期用來抓包，現已清乾淨、與後續無關。

### 主機（Windows 10）
- adb：只有 MuMuPlayer 附帶的 `C:\Program Files\Netease\MuMuPlayer\nx_main\adb.exe`。
  - **此 adb 大檔 `pull` 會靜默失敗、`exec-out` 約 3.5MB 截流** → 傳大檔一律走 **WiFi**（見下）。`push` 小檔可用、大檔會弄斷 USB。
- 網路：主機 `192.168.50.12`、手機 WiFi 同網段。主機開 `python -m http.server 8200`（在含 .so 的目錄）供手機 `curl` 下載新 .so。
- 工具鏈：Python 3.12、cmake+ninja（pip 裝）、Android **NDK r27c**、Il2CppDumper(win)、.NET8 可攜 runtime。
- 逆向素材：`libil2cpp.so`(251MB)、`global-metadata.dat`(31.8MB)、`libNianticLabsPlugin.so`(12.9MB) — 太大未放雲端，可用 WiFi 從裝置 APK 重取（見 §7）。**`reference/dump.cs`(85MB) 已附**，是查 RVA/偏移的主要依據。

---

## 3. 完整開發歷程（含死路，理解「為何是現在這個做法」）

1. **抓包**：mitmproxy + 手機系統憑證（Magisk tmpfs bind-mount 到 /system/etc/security/cacerts）。
   - **無 TLS pinning**，能攔明文 HTTPS。所有 API 打單一端點 `ichigo-rel.nianticlabs.com/frontend/rpc2`（POST）。
   - 但 **payload 是加密的**（熵 7.97、無明文字串、座標掃不到）。外層是 FlatBuffers 傳輸框，內層是**加密的 protobuf**。
   - → **死路**：純離線解密不可行（加密在 native `libNianticLabsPlugin.so`，用 session key + 簽章 + Play Integrity）。
2. **frida 執行期 hook**：
   - 主帳手機：frida attach 直接被 **ptrace 擋死**（`ptrace pokedata I/O error`）。
   - 小號手機：attach 過得了 ptrace，但 **app 有執行期反 frida 偵測，一注入就自殺重啟**。
   - 換 **Florida 防偵測 frida**（strongR/Florida，17.11.0）：attach 仍被偵測、spawn 報錯。
   - → **死路**：通用 frida（含防偵測版）擋不住這支 app 的反 frida。
3. **Il2CppDumper 離線還原符號**：成功產出 `dump.cs`（85MB，全部 C# 類別/方法/protobuf 定義）。**這是後續一切的地圖**。
   - 確認蘑菇資料模型：`MapObjectProto{ Point; oneof{ PoiMushroom=22 } }`，`PointProto{ double LatDegrees; double LngDegrees }`。
4. **社群調查**：Pikmin 沒有公開的即時抓取工具（只有手動標記/OSM 推測）。PoGO 社群（RealDeviceMap/MAD/PogoDroid）的做法是**裝置端注入讀解密資料**，不逆加密。→ 決定走「裝置端注入」。
5. **Zygisk 原生 hook（成功的路）**：基於 `Perfare/Zygisk-Il2CppDumper` 改造。
   - **關鍵驗證全過**：Zygisk 在 zygote 注入的原生模組**不被反 frida 偵測**、inline hook 修改遊戲程式碼**不被反竄改殺**、持續 hook 2000+ 物件遊戲仍活。
   - 踩雷修正：① 原 dumper 的 il2cpp_dump 走遍 metadata 會被反竄改殺 → 移除，只做定點 hook。② `il2cpp_api_init` 呼叫 `il2cpp_is_vm_thread` 在冷啟動未 init 完會 SIGSEGV → 移除該等待。③ NDK r27c 新版 clang 對 zygisk.hpp 的 attribute 位置較嚴 → 已修。
6. **OSM 裝飾工具（中途插曲，非最終需求）**：`mushroom_decor_finder.py` 用 Overpass 依 OSM 推測裝飾類型——使用者說這種已有現成網站、不是要的（要即時蘑菇狀態），故放棄，改回 Zygisk 路線。

---

## 4. 最終架構（資料流）

```
[Pikmin Bloom 遊戲行程]
   └─ Zygisk 模組 zygisk_pikmin_hunter（zygote 注入，繞過反 frida/反竄改）
        └─ inline hook  MapManager.RegisterMapObject(MapObjectBase)   (RVA 0xCB4596C)
             └─ 每個地圖物件註冊時：判斷是否蘑菇(class==MapPoiBlocker)
                  └─ 從 obj 讀原始 MapObjectProto → 蘑菇 id/座標/等級/類型/結束時間
                       └─ append 到 /data/user/0/com.nianticlabs.pikmin/files/mushrooms.tsv
                              ↑ (遊戲自己已解密，我們只是讀記憶體)
[主機 radar.py]  每4秒 `adb shell su -c 'cat mushrooms.tsv'` 拉取 → 用 id 去重累積 → mushrooms.json
[主機 radar.html] Leaflet+OSM 地圖，每4秒 fetch mushrooms.json，按等級分色標點
使用者用 joystick 移動手機位置 → 遊戲抓該區蘑菇 → 自動出現在地圖（半自動）
```

---

## 5. 技術細節總表（v148；執行期位址 = libil2cpp 載入基址 + RVA）

### Hook 點
- **`MapManager.RegisterMapObject(MapObjectBase obj)`** — RVA **`0xCB4596C`**（namespace `Niantic.TokyoStudio.Map`）。
  - native 簽章：`void(void* this, void* obj, void* methodInfo)`（IL2CPP 尾參 MethodInfo*）。

### 從 MapObjectBase 讀蘑菇（obj 是 `MapPoiBlocker : ProtoBasedMapObject : MapObjectBase`）
- 判斷蘑菇：`il2cpp_object_get_class(obj)` → `il2cpp_class_get_name` == `"MapPoiBlocker"`（namespace `...Challenge.MushroomChallenge`）。
- **`ProtoBasedMapObject.initialMapObjectProto` (原始 MapObjectProto*) @ `0x68`**。
- `MapObjectProto`：`id_`(string)@`0x18`、`point_`(PointProto*)@`0x20`、`object_`(oneof*)@`0x30`、`objectCase_`(int)@`0x38`（PoiMushroom=22）。
- `PointProto`：`latDegrees_`(double)@`0x18`、`lngDegrees_`(double)@`0x20`。
- 當 objectCase==22：`object_`(0x30) 是 `PoiMushroomProto`：`overrideCooldownSeconds_`(int)@`0x28`、`poiChallenge_`(PoiChallengeInfoProto*)@`0x18`。
- **`PoiChallengeInfoProto`（蘑菇 metadata 在這）**：`poiId_`(string)@`0x28`、`mushroomClusterId_`(string)@`0x30`、`challengeFinishTimeMs_`(long)@`0x40`、`type_`(int)@`0x48`、**`level_`(int)@`0x4C`**。
  - 實測：level 1–3（蘑菇難度）；type 為活動類型枚舉；finishMs 為蘑菇消失時間(ms epoch)。**clusterId 伺服器未填(空)**。

### il2cpp string 讀法
- Il2CppString：length(int)@`0x10`、UTF-16 chars@`0x14`。

### 輸出格式（mushrooms.tsv，tab 分隔）
`ts \t id \t lat \t lng \t cluster \t cooldown \t level \t type \t finishMs`

---

## 6. 模組程式碼（`module/cpp/`，改自 Zygisk-Il2CppDumper）

- `game.h`：`GamePackageName = "com.nianticlabs.pikmin"`。
- `main.cpp`：標準 Zygisk 模組（偵測套件 → postAppSpecialize 開 hack 執行緒）。**未改**。
- `hack.cpp`：`hack_start` 等 libil2cpp 載入（重試 120 次，冷啟動慢）→ `il2cpp_api_init` → `install_hooks`（**已把原本的 il2cpp_dump 換成 install_hooks**）。
- `il2cpp_dump.cpp`：**主要改動處**。
  - `il2cpp_api_init`：取 il2cpp_base（dladdr）；**移除了 il2cpp_is_vm_thread 等待/thread_attach**（冷啟動會 SIGSEGV）。
  - `install_hooks`：`A64HookFunction(il2cpp_base + 0xCB4596C, hooked_RegisterMapObject, &orig)`；開 mushrooms.tsv。
  - `hooked_RegisterMapObject`：過濾 MapPoiBlocker → 讀 proto（§5）→ id 去重（std::set）→ 寫檔 + LOGI(tag `Perfare`)。
  - `read_cs_string`：讀 il2cpp string。
- `And64InlineHook.cpp/.hpp`：arm64 inline hook 庫（Rprop）。
- `CMakeLists.txt`：已加 And64InlineHook.cpp；已移除會誤報的 POST_BUILD strip。
- `zygisk.hpp`：已修 attribute 位置以相容 NDK r27c clang。

---

## 7. build / deploy / test（可複製流程）

```bash
# 前置：NDK r27c（重抓 https://dl.google.com/android/repository/android-ndk-r27c-windows.zip）
#       pip install cmake ninja
ADB="C:\Program Files\Netease\MuMuPlayer\nx_main\adb.exe"

# 建置（cpp 目錄 = module/cpp）
cmake -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE=<NDK>/build/cmake/android.toolchain.cmake \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-28 \
  -DMODULE_NAME=pikmin_hunter -DCMAKE_BUILD_TYPE=Release \
  -S module/cpp -B build_zygisk
cmake --build build_zygisk        # 產出 libpikmin_hunter.so
cp build_zygisk/libpikmin_hunter.so arm64-v8a.so   # 放到 http.server(8200) 目錄

# 首次安裝：把 arm64-v8a.so 放進 pikmin_hunter.zip 的 zygisk/arm64-v8a.so，magisk 安裝：
#   adb shell su -c 'magisk --install-module /path/pikmin_hunter.zip' ; adb reboot
# 更新 .so（模組已裝過）：WiFi 覆蓋 + 重開機（Zygisk 只在 zygote 載入）
$ADB shell su -c 'curl -s -o /data/adb/modules/zygisk_pikmin_hunter/zygisk/arm64-v8a.so http://192.168.50.12:8200/arm64-v8a.so'
$ADB reboot

# 測試
$ADB shell monkey -p com.nianticlabs.pikmin -c android.intent.category.LAUNCHER 1
# 進遊戲地圖（實機操作；截圖全黑=secure surface，看不到）
$ADB logcat -s Perfare                # 看 [HOOK]/[MUSH]
$ADB shell su -c 'cat /data/user/0/com.nianticlabs.pikmin/files/mushrooms.tsv'
```

若要重取逆向素材（換遊戲版本時）：`adb shell su -c 'unzip -p <base.apk> assets/bin/Data/Managed/Metadata/global-metadata.dat > /data/local/tmp/gmeta.dat'`、`unzip -p <split_config.arm64_v8a.apk> lib/arm64-v8a/libil2cpp.so`，用 **WiFi nc**（裝置當 client 送、主機當 listener）傳回主機，再跑 Il2CppDumper 產新 dump.cs、更新 RVA。

---

## 8. 主機雷達工具（`radar/`）

- `radar.py`：自帶 HTTP:8321 + 背景每4秒 `adb shell su -c cat mushrooms.tsv` → id 去重 → 寫 mushrooms.json / mushrooms_master.tsv。
- `radar.html`：Leaflet+OSM，每4秒 fetch mushrooms.json，🍄 標點，按 level 分色（1-5綠/6-10黃/11-15橙/16-20紅/21+紫），popup 顯示 Lv/POI/type/結束時間。
- 用法：`python radar.py` → 瀏覽器開 `http://localhost:8321/radar.html`。移動 joystick 逛地圖，蘑菇自動標上。

---

## 9. 目前狀態（交接時）

- ✅ 半自動雷達可用（等級/座標/類型/結束時間都到位）。
- ✅ ①環境清理、②蘑菇等級 完成。
- ⏳ ③ **全自動瞬移掃描**：只完成設計，未實作。**詳見 `DESIGN_autoscan.md`**（同資料夾）。
- 殘留：小號已裝模組；主機若要開發需自備 8200 http server + 同網段。frida/mitmproxy 已清。

---

## 10. 下一步：③ 全自動瞬移掃描（Codex 從這裡開始）

**目標**：不用手動 joystick，模組自動把遊戲瞬移到網格點，逐點擷取，主機拼出整區蘑菇圖。
**完整規格見 `DESIGN_autoscan.md`**。摘要：
- 遊戲定位由 `ILocationController` 提供，有內建 debug 覆蓋 `SetDeviceLocationOverrideForDebug(Nullable<LatLngAlt>)`。
- 兩個實作：`LocationController`(真GPS，override 欄位 @0xB8，`SetDeviceLocationOverrideForDebug` RVA `0x6FCC32C`，`get_LatestDeviceLocation` RVA `0x6FCA628`)；`LocationOverridingController`(包裝，override @0x30，`get_LatestDeviceLocation` RVA `0x6FCCA58`)。
- **作法 A（首選）**：hook `get_LatestDeviceLocation` 抓 controller `this` → 背景執行緒讀控制檔座標 → 直接寫 override 欄位（純記憶體寫，免 ARM64 結構傳參）。
- **作法 B（後備）**：呼叫 `SetDeviceLocationOverrideForDebug`（ARM64 >16B 結構以指標傳）。
- **軟封風險**：Niantic 速度限制——瞬移太快太遠會停止回資料。須小步跳（鄰點 <~100m）+ 每步等待節流。
- **先解三個開放問題**（DESIGN_autoscan §6）：①執行期實際用哪個 controller（hook 印 class name）②`Nullable<LatLngAlt>` 的 hasValue 佈局 ③直接寫欄位是否被 Update() 採用。

---

## 11. 重要陷阱與教訓（gotchas）

- **MuMu 版 adb 大檔傳輸壞掉**：`pull` 大檔靜默失敗、`push` 大檔弄斷 USB、`exec-out` 約 3.5MB 截流。→ 大檔一律 WiFi（HTTP 下載 或 nc）。
- **`pkill toybox` 會弄斷 adb/系統**（很多系統工具是 toybox symlink）——絕對不要用。清 nc 用精確 pattern 或不清。
- **Zygisk 只在 zygote 載入**：改 .so 一定要 reboot 才生效。
- **反竄改會殺「大量 metadata 走訪」**：只做定點 hook，別在模組裡跑 il2cpp_dump/列舉全類別。
- **冷啟動首次啟動遊戲常自己崩一次**（慢機），第二次才穩；等 libil2cpp 已放寬到 120s。
- **遊戲畫面截圖全黑**（secure surface）——自動化看不到 UI，進地圖等操作需人工。
- **版本綁死 RVA**：遊戲更新後所有 RVA/偏移會變，必須重跑 Il2CppDumper。小號務必維持在與 dump.cs 相同的 versionCode。
- **Google Drive(G:) 可寫路徑在 `G:\我的雲端硬碟\`，不是 G:\ 根**。

---

## 12. 檔案清單（本資料夾）

- `DEV_HISTORY.md`（本檔）、`DESIGN_autoscan.md`（③規格）、`HOOK_TARGETS.md`（hook 偏移速查）、`WORKLOG.md`（逐日日誌）。
- `module/cpp/`：Zygisk 模組原始碼（含所有 hook 修改）。`module/arm64-v8a.so`：目前可用的編譯產物（含等級）。`module/pikmin_hunter.zip`：Magisk 安裝包。`module/template/`：模組模板。
- `radar/radar.py`、`radar/radar.html`：主機雷達工具。
- `reference/dump.cs`：IL2CPP 符號 dump（查 RVA/偏移用；85MB）。

（未附：NDK、libil2cpp.so/global-metadata.dat/libNianticLabsPlugin.so 等大型二進位——依 §7 重取。）
