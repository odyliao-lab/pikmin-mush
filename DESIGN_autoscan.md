# 設計規格書：Pikmin 蘑菇雷達 — 全自動瞬移掃描 (Phase 2-③)

> 目標：不必手動移動 joystick，由模組自動把遊戲「瞬移」到網格點，逐點擷取該區蘑菇，
> 主機端拼出整個區域的即時蘑菇地圖。基於已完成的 Zygisk hook 雷達(半自動版)延伸。
> 版本：Pikmin Bloom 148.0 / versionCode 1782528808 / arm64 / libil2cpp RVA 基準同 dump.cs。

---

## 0. 現況(已完成，可直接沿用)
- Zygisk 模組 `zygisk_pikmin_hunter`(原始碼 scratchpad/zygisk-dumper，或見下「檔案位置」)已能：
  Zygisk 注入 Pikmin → 等 libil2cpp → `il2cpp_api_init`(只取 base，不呼叫 il2cpp_is_vm_thread) →
  `install_hooks` 用 A64HookFunction inline hook `MapManager.RegisterMapObject`(RVA 0xCB4596C) →
  讀 MapPoiBlocker 的蘑菇資料(id/lat/lng/level/type/finishMs) → 寫 `/data/user/0/com.nianticlabs.pikmin/files/mushrooms.tsv`。
- 主機 `F:\claude_ws\pikmin\radar\radar.py`(自帶 HTTP:8321 + 每4秒 adb root cat 拉取去重) + `radar.html`(Leaflet 地圖，按等級分色)。
- **關鍵事實**：Zygisk 注入 + inline hook + 記憶體讀 都不觸發 Niantic 反 frida/反竄改(已驗證持續運作)。

---

## 1. 瞬移機制(核心，兩個候選作法)

遊戲定位由 `ILocationController` 提供(見 dump.cs 392136)。有內建 debug 覆蓋：
- 介面方法 `SetDeviceLocationOverrideForDebug(Nullable<LatLngAlt> location)` (Slot 4)
- `ILocationOverride.SetLocationOverride(Nullable<LatLngAlt>)`

兩個實作類：
| 類別 | 說明 | override 欄位偏移 | 關鍵方法 RVA |
|---|---|---|---|
| `LocationController : MonoScope`(392244，真 GPS) | `deviceLocationOverrideForDebug (Nullable<LatLngAlt>)` @**0xB8** | `SetDeviceLocationOverrideForDebug` @**0x6FCC32C**；`get_LatestDeviceLocation` @**0x6FCA628** |
| `LocationOverridingController : ZenScope`(392381，包裝) | `deviceLocationOverride (Nullable<LatLngAlt>)` @**0x30** | `get_LatestDeviceLocation` @**0x6FCCA58**；有 `SetLocationOverride` |

`LatLngAlt` 結構(24 bytes)：`LatLng` @0x0 {lat(double)@0x0, lng(double)@0x8}，`AltitudeMeters(double)` @0x10。
`Nullable<LatLngAlt>` 佈局需實測(見開放問題)：value(24B) + hasValue(bool)，共 ~32B。

### 作法 A（首選，最簡單）：直接寫 override 欄位
1. hook `get_LatestDeviceLocation`(遊戲每幀狂呼叫) 捕捉 `this`(x0=controller 實例)，第一次存到全域。
   - **同時 log `il2cpp_class_get_name(this)`** 確認執行期實際用的是哪個 controller(決定用 0xB8 還是 0x30)。
2. 模組背景執行緒讀控制檔 `/data/user/0/com.nianticlabs.pikmin/files/teleport.txt`("lat,lng")。
3. 值變更時，往 `instance + override偏移` 寫入：lat/lng/alt(doubles) + hasValue=1。
   - 遊戲的 `Update()`(LocationController @0x6FCB738) 會套用 override，位置即改變 → 送伺服器的 RPC 也用新座標。
- 優點：純記憶體寫入，無 ARM64 結構傳參、無 il2cpp 方法呼叫。
- 風險：直接寫欄位可能繞過 setter 的附帶邏輯；若無效改用作法 B。

### 作法 B（後備）：呼叫 SetDeviceLocationOverrideForDebug
- target = il2cpp_base + 0x6FCC32C。以 `void fn(void* this, Nullable<LatLngAlt>* loc, void* methodInfo)` 呼叫。
- ARM64 AAPCS：>16B 結構以「指標指向 caller 配置的副本」傳遞 → 在 stack 配一個 Nullable<LatLngAlt> 填好，x1 傳其位址。
- `this` 同樣由 get_LatestDeviceLocation hook 捕捉。

---

## 2. 模組需要新增的東西(在 il2cpp_dump.cpp install_hooks 之後)
1. 新增 hook：`get_LatestDeviceLocation`(RVA 依作法 A 選定的 controller)。hook 內：首呼記錄 `this` + class name；呼叫原函式回傳。
2. 背景執行緒：每 ~500ms 讀 teleport.txt；格式變更則套用瞬移(作法 A 寫欄位)。
3. 可選：teleport.txt 增加第三欄 alt、第四欄「序號」讓主機確認已套用(模組把目前序號寫回 applied.txt)。

## 3. 主機端網格掃描器(擴充 radar.py 或新 scan.py)
1. 輸入：中心座標 + 範圍(或 bbox) + 網格間距(建議 ~70–100m，對應遊戲可視/擷取半徑)。
2. 產生網格點清單(蛇形順序，鄰點距離小)。
3. 每點：`adb shell su -c 'echo "lat,lng" > .../teleport.txt'` → **等冷卻+載入**(見軟封) → 讀 mushrooms.tsv 併入 master(id 去重) → 更新 mushrooms.json。
4. radar.html 即時顯示進度(已掃點/待掃點可另畫)。

## 4. 軟封 / 速度限制策略(必做，否則掃到一半沒資料)
- Niantic 有 speed limit：瞬移過快過遠 → 伺服器停止回傳(soft-ban)一段時間。
- 對策：**小步跳**(鄰點 <~100m) + 每步 sleep(建議先試 3–5 秒/步，觀察 mushrooms.tsv 是否持續有新點；若某步後多點皆 0，代表被軟封 → 拉長間隔或退回)。
- 不要大跳(跨城市)後立刻掃；換大區域之間留長冷卻(數十分鐘)。
- 小號帳號，容忍度可放寬，但仍要驗證「掃到的點數 vs 該區實際」避免整批被軟封污染。

## 5. build / deploy / test 迴圈(已驗證流程)
```
# 建置(cmake+ninja 已裝，NDK r27c 在 scratchpad/ndk)
cmake --build <build_zygisk>              # 產出 libpikmin_hunter.so
cp libpikmin_hunter.so arm64-v8a.so       # 放到 HTTP(8200) 目錄
# 部署(WiFi，避開壞掉的 adb pull/大 push)
adb shell su -c 'curl -s -o /data/adb/modules/zygisk_pikmin_hunter/zygisk/arm64-v8a.so http://192.168.50.12:8200/arm64-v8a.so'
adb reboot   # Zygisk 只在 zygote 載入，改 .so 必重開機
# 測試：開遊戲 → 進地圖 → 讀 logcat -s Perfare / mushrooms.tsv
```
- 主機 8200 HTTP server 需在跑(部署用)；192.168.50.12=主機、手機同網段。
- 冷啟動首次啟動遊戲常自己崩一次(慢機)，第二次才穩；hook 等 libil2cpp 已放寬到 120 秒。
- 螢幕截圖全黑(secure surface)，需使用者在實機操作進地圖。

## 6. 開放問題 / 待驗證(晚上開工先解這些)
1. **執行期實際的 ILocationController 是哪個類**？→ 在 get_LatestDeviceLocation hook 印 class name 確定 → 選 0xB8 或 0x30。
2. **Nullable<LatLngAlt> 的 hasValue 在 value 前或後**？→ 寫入後看遊戲有沒有瞬移；試 value@0/hasValue@0x18，或 hasValue@0/value 後移。
3. **直接寫欄位是否被 Update() 採用**？無效則走作法 B 呼叫方法。
4. **軟封節流參數**：實測每步最短安全間隔。
5. 瞬移後蘑菇資料多久到齊(RPC 週期)→ 決定每點等待時間。

## 7. 檔案位置
- 模組原始碼：`scratchpad/zygisk-dumper/module/src/main/cpp/`(il2cpp_dump.cpp 內含 hook+install_hooks；hack.cpp；game.h=com.nianticlabs.pikmin)。**注意：scratchpad 是 session 暫存，開工前先確認還在，否則從下方持久檔重建。**
- 逆向素材(持久)：`F:\claude_ws\pikmin\artifacts\`(libil2cpp.so, global-metadata.dat, libNianticLabsPlugin.so, flows.mitm)、`dump\dump.cs`。
- 雷達工具(持久)：`F:\claude_ws\pikmin\radar\`(radar.py, radar.html)。
- 若 scratchpad 沒了：用 artifacts 的 dump.cs 對照本規格 RVA/偏移，重建模組(NDK 需重抓，見 WORKLOG build 指令)。
