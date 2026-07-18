# 規格設計書：Pikmin Bloom 區域自動掃描蘑菇雷達

> 給接手開發者/AI（Codex）。本文件聚焦**當前需求**與**當前程式碼狀態**，自足可執行。
> 開發背景/走過的死路見同資料夾 `DEV_HISTORY.md`（可選讀）。本文件 = 要做什麼 + 現況 + 待完成 + 技術規格。

---

## 1. 需求（最終目標）

> 2026-07 更新：下方早期單機規格保留作為模組技術參考；正式架構已升級為
> **Codex Sites／D1 控制中心 + 多個自主 Android Agent**。Windows、USB、ADB 與
> Cloudflare Tunnel 都不再是正常掃描的必要元件。

多個已 root 的 Android Agent 由雲端後台統一排程，平行掃描不同國家與城市，
把蘑菇（座標/等級/類型/到期時間）直接送至 D1，並呈現在使用者自有網域的網頁地圖上。

- 範圍模型：國家城市包、獨立城市或自訂 bbox；城市目錄可持續增加歐美國家。
- 多 Agent：每個節點使用獨立 ID／Token；每個掃描點以 lease 派發，逾時自動回收。
- 派工：區域標籤為優先偏好，空閒 Agent 可動態接手其他國家。
- 掃到的蘑菇即時顯示在網頁地圖，過期的自動移除。
- 網站與資料層由 Codex Sites／D1 託管，不依賴本地 PC。

---

## 2. 現況：**已完成且實機驗證**（不要重做）

### 2.1 Zygisk 模組 `zygisk_pikmin_hunter`（已裝在手機、原始碼在 `module/cpp/`）
繞過 Niantic 反 frida/反竄改/payload 加密，在遊戲行程內用 inline hook 直接讀解密後記憶體。已具備兩大功能：

**(A) 蘑菇擷取 hook** — 已驗證：
- hook `MapManager.RegisterMapObject(MapObjectBase)` @RVA `0xCB4596C`。
- 過濾 `class == "MapPoiBlocker"`（蘑菇）→ 讀原始 proto（見 §4）→ 取 id/lat/lng/level/type/finishMs。
- 寫入 `/data/user/0/com.nianticlabs.pikmin/files/mushrooms.tsv`，格式：
  `ts \t id \t lat \t lng \t cluster \t cooldown \t level \t type \t finishMs`
- **id 去重**（模組內 std::set g_seen，同一 session 不重複寫）。

**(B) 自動瞬移** — **已驗證可運作**（實測地圖跟著 teleport.txt 動態移動）：
- hook `LocationController.Update()` @RVA `0x6FCB738` 捕捉 controller 實例（`this`=x0）。
- 背景執行緒讀 `/data/user/0/.../files/teleport.txt`（內容 `"lat,lng"`），值變更時在**主執行緒**呼叫
  `LocationController.SetDeviceLocationOverrideForDebug(Nullable<LatLngAlt>)` @RVA `0x6FCC32C`。
- **關鍵**：直接寫 override 欄位**無效**；必須**呼叫該方法**才生效（會正確推進定位 stream + 送伺服器）。

### 2.2 主機端 `scanner/scanner.py` + `scanner/map.html`（已寫好，骨架驗證過）
- `scanner.py`：讀 CONFIG 的區域 bbox → 產生蛇形網格 → 逐點寫 teleport.txt（`adb shell su -c 'echo ... > teleport.txt'`）→
  等待 → 讀 mushrooms.tsv → 存 SQLite（`mushrooms.db`，id 去重、finishMs 過期）→ 自帶 HTTP(:8787) 服務網頁 + `/api/mushrooms`。
- `map.html`：Leaflet+OSM 地圖，每 4 秒 fetch `/api/mushrooms`，按等級分色標點、顯示掃描進度、過期倒數、自動移除過期。
- 骨架已測：網格產生、瞬移驅動（teleport.txt 有跟著變）、SQLite、HTTP/API/網頁 全部正常。

---

## 3. 系統架構

```
[手機常接電腦]
  Pikmin 遊戲 ← Zygisk 模組
     ├─ (A) hook RegisterMapObject → 蘑菇 → mushrooms.tsv
     └─ (B) 背景讀 teleport.txt → 呼叫 SetDeviceLocationOverrideForDebug → 瞬移
        ↑ teleport.txt        ↓ mushrooms.tsv
[PC scanner.py]  逐點 adb 寫 teleport.txt → 等 → adb 讀 mushrooms.tsv → SQLite → HTTP(:8787) + /api/mushrooms + map.html
        ↓
[Cloudflare Tunnel]  cloudflared 把 localhost:8787 接到使用者網域 → 公開網頁地圖
```

---

## 4. 技術規格（v148；執行期位址 = libil2cpp 載入基址 + RVA）

### 蘑菇資料讀取路徑（obj = MapPoiBlocker）
- `ProtoBasedMapObject.initialMapObjectProto`(MapObjectProto*) @`0x68`
- `MapObjectProto`: id_(string)@`0x18`, point_(PointProto*)@`0x20`, object_@`0x30`, objectCase_(int)@`0x38`(PoiMushroom=22)
- `PointProto`: latDegrees_(double)@`0x18`, lngDegrees_(double)@`0x20`
- objectCase==22 → object_(0x30)=`PoiMushroomProto`: overrideCooldownSeconds_(int)@`0x28`, poiChallenge_(PoiChallengeInfoProto*)@`0x18`
- `PoiChallengeInfoProto`: poiId_(str)@`0x28`, mushroomClusterId_(str)@`0x30`, challengeFinishTimeMs_(long)@`0x40`, type_(int)@`0x48`, **level_(int)@`0x4C`**
  - 實測 level 1–3；clusterId 伺服器常留空；finishMs = 蘑菇到期(ms epoch)。
- il2cpp string：length(int)@`0x10`，UTF-16 chars@`0x14`。

### 自動瞬移
- `LocationController.Update()` RVA `0x6FCB738`（捕捉 this，void，每幀）
- `LocationController.SetDeviceLocationOverrideForDebug(Nullable<LatLngAlt>)` RVA `0x6FCC32C`
- `Nullable<LatLngAlt>` 佈局（.NET `{bool hasValue; T value}`，8-align）：hasValue@`0x00`, lat@`0x08`, lng@`0x10`, alt@`0x18`（共 32B）。
- 呼叫方式（ARM64）：`void fn(void* this, NullablePtr* nv, void* methodInfo=nullptr)`；nv 為 caller 配置的 32B 結構指標。
- 必須在遊戲主執行緒呼叫（現作法：在 Update hook 內、目標變更時呼叫一次）。

---

## 5. 待完成工作（給 Codex，依序）

1. **端到端驗證掃描器**（最優先）：檔案 handle bug 剛修好（見 §7），需實機確認 scanner.py 跑起來後 mushrooms.tsv 持續累積、SQLite 有資料、網頁有標點。流程見 §6。
   - 注意：遊戲畫面是 secure surface（截圖全黑），無法自動化 UI；**需人工把遊戲切到地圖**，location 系統與 RegisterMapObject 才會啟動。要想辦法讓遊戲保持在地圖前景。
2. **實測校準掃描速度 vs 軟封**：Niantic 有速度限制，瞬移太快太遠 → 伺服器暫停回資料(soft-ban)。
   - 已知：500m/10s 的跳速下遊戲仍有回資料（未觸發）；大跳(數十 km)會觸發、需冷卻。
   - 找出「不觸發軟封的最快網格掃描節奏」（scanner.py 的 GRID_STEP_M / DWELL_S / HOP_DELAY_S）。首次跳進目標區是大跳，建議先用手機 joystick 移到區域附近再啟動，或接受一次冷卻。
3. **重生/刷新處理**：模組 g_seen 永不遺忘 → 同 id 蘑菇過期後重生不會被重記。考慮：週期性重置 g_seen（模組加控制檔/定時），或掃描器分輪清 DB 中過期項。
4. **Cloudflare Tunnel 上線**：`cloudflared tunnel` 把 `localhost:8787` 接到使用者網域（需使用者 Cloudflare 帳號登入、建 tunnel、設 DNS）。PC 常開所以 Tunnel 最合適。
5. **穩健性**：冷啟動首次啟動遊戲常自崩一次（慢機），需自動重試；遊戲更新後 RVA 全變，需重跑 Il2CppDumper 更新偏移。

---

## 6. 環境與 build/deploy/test

### 環境
- 手機：Redmi Note 10 5G（camellian / M2103K19G），Android 13，arm64，**Magisk Kitsune + Zygisk 啟用**，已裝 playintegrityfix/tricky_store（Play Integrity 已過）。**Pikmin 必須維持 148.0 / versionCode 1782528808**（= 偏移來源）。模組 `zygisk_pikmin_hunter` 已安裝。
- PC：Windows。adb 只有 MuMuPlayer 版 `C:\Program Files\Netease\MuMuPlayer\nx_main\adb.exe`。**此 adb 大檔 pull 靜默失敗、push 大檔弄斷 USB** → 部署大檔走 **WiFi**：PC 開 `python -m http.server 8200`（在含 arm64-v8a.so 的目錄），手機 `curl` 下載。PC IP `192.168.50.12`，手機同網段。
- 工具：NDK **r27c**（重抓 https://dl.google.com/android/repository/android-ndk-r27c-windows.zip）、`pip install cmake ninja`。

### build（cpp 目錄 = module/cpp）
```
cmake -G Ninja -DCMAKE_TOOLCHAIN_FILE=<NDK>/build/cmake/android.toolchain.cmake \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-28 \
  -DMODULE_NAME=pikmin_hunter -DCMAKE_BUILD_TYPE=Release -S module/cpp -B build_zygisk
cmake --build build_zygisk          # → libpikmin_hunter.so
cp build_zygisk/libpikmin_hunter.so arm64-v8a.so   # 放到 8200 http 目錄
```
### deploy（模組已裝過，換 .so 必 reboot；Zygisk 只在 zygote 載入）
```
adb shell su -c 'curl -s -o /data/adb/modules/zygisk_pikmin_hunter/zygisk/arm64-v8a.so http://192.168.50.12:8200/arm64-v8a.so'
adb reboot
```
### test
```
adb shell monkey -p com.nianticlabs.pikmin -c android.intent.category.LAUNCHER 1
# 人工把遊戲切到地圖
adb logcat -s Perfare                 # [HOOK]/[MUSH]/[TP] 日誌（注意 buffer 轉很快）
adb shell su -c 'echo "25.04,121.53" > /data/user/0/com.nianticlabs.pikmin/files/teleport.txt'   # 手動瞬移
adb shell su -c 'cat /data/user/0/com.nianticlabs.pikmin/files/mushrooms.tsv'
# 全自動：python scanner/scanner.py → 開 http://localhost:8787/
```

---

## 7. 關鍵陷阱（gotchas，務必知道）

- **檔案 handle bug（剛修）**：模組原本 install_hooks 只 fopen 一次持有 handle；掃描器每點 `rm` 該檔 → Linux 上刪已開啟檔 = handle 指向已刪 inode，之後寫入全遺失（表現為 mushrooms.tsv 一直空、誤以為軟封）。**已改為每次寫入才 fopen/fclose**（module/cpp/il2cpp_dump.cpp），且 **scanner 不再 rm**、改讀整個累積檔 + SQLite 去重。⚠ 此修正剛部署、**尚未端到端確認**，Codex 首要驗證。
- **軟封 ≠ 檔案 bug**：先前「無資料」其實多半是上面的檔案 bug。真軟封是大跳造成、伺服器暫停回資料。兩者要分清（遊戲畫面若有蘑菇更新=沒軟封=看檔案/管線）。
- **Zygisk 只在 zygote 載入**：改 .so 一定 reboot。
- **反竄改殺「大量 metadata 走訪」**：只做定點 hook，勿在模組跑 il2cpp_dump/列舉全類別。
- **遊戲畫面 secure surface**：截圖全黑，無法用截圖自動化 UI；需人工/其他方式讓遊戲在地圖前景。
- **冷啟動首次常自崩一次**（慢機），第二次才穩；模組等 libil2cpp 已放寬到 120s。
- **MuMu adb 大檔傳輸壞**：見 §6，一律 WiFi。**絕不要 `pkill toybox`**（會弄斷 adb/系統）。
- **版本綁死 RVA**：遊戲一更新，本文所有 RVA/偏移失效，須重 dump。維持手機在 148（versionCode 1782528808）。

---

## 8. 檔案位置（本資料夾 Pikmin_Dev）

- `SPEC_autoscan.md`（本檔）、`DEV_HISTORY.md`（開發背景/死路）、`DESIGN_autoscan.md`（舊版瞬移設計，部分已被本文取代）、`HOOK_TARGETS.md`、`WORKLOG.md`。
- `module/cpp/`：Zygisk 模組**最新原始碼**（含蘑菇 hook + 自動瞬移 + 檔案修正）。`module/arm64-v8a.so`：最新編譯產物。`module/pikmin_hunter.zip`：Magisk 安裝包（首次安裝用；.so 為舊版，安裝後用 §6 deploy 更新到最新）。
- `scanner/scanner.py`、`scanner/map.html`：主機端自動掃描器 + 網頁地圖（**當前主程式**）。
- `reference/dump.cs`：IL2CPP 符號 dump（查 RVA/偏移；85MB）。
- 舊版半自動工具在 `radar/`（已被 scanner/ 取代，可忽略）。
- 未附：NDK、libil2cpp.so/global-metadata.dat（依 §6/DEV_HISTORY 重取）。
