# Pikmin_Dev — 交接包（給接手開發用）

Pikmin Bloom 即時蘑菇雷達專案。root 手機透過常駐 Agent 自動移動 GPS、掃描指定城市，
資料直接送到 Codex Sites／D1，並即時呈現在 `https://mush.odyliao.cc/`。

## 先讀這個（依序）
1. **`CLAUDE_HANDOFF.md`** ← 接手入口、正式現況、操作清單、API、資料表、驗證與陷阱。
2. **`SPEC_GLOBAL_FLEET.md`** ← 多 Agent 全球化、歐美擴充與後續分階段設計。
3. **`SPEC_ON_DEVICE_DISPLAY.md`** ← 手機免電腦 virtual display、reboot 與多機部署規格。
4. **`SPEC_autoscan.md`** ← Zygisk hook、RVA、偏移、TSV 與底層技術規格。
5. `DEV_HISTORY.md` ← 開發背景與走過的死路（遇到相同問題時再讀）。
6. `HOOK_TARGETS.md` / `WORKLOG.md` / `DESIGN_autoscan.md` ← 舊版速查與歷史設計。

## 現況一句話
Zygisk 模組（`module/`）以 Pikmin Bloom 149.0 為版本基準，已能：hook 讀蘑菇
（座標/等級/類型/到期）+ **自動瞬移**（呼叫遊戲內建
SetDeviceLocationOverrideForDebug）；掛 hook 前會驗證目標函式簽章，版本不符時 fail closed。
`site/` 提供公開地圖、受保護的 `/admin` 掃描後台，以及 D1 多 Agent 工作佇列。
每個 `phone_agent/` 節點都有獨立 ID／Token，透過有期限的逐點 lease 平行領取不同座標；
節點離線、停用或逾時後，未完成座標會自動重新排隊。Agent 會移動 GPS、等待遊戲刷新、
增量上傳 `mushrooms.tsv` 並回報進度。國家城市包由 `site/lib/scan-plans.ts` 的
`COUNTRY_PACK_CATALOG` 統一管理，未來增加歐美國家不需修改排程核心。
正常掃描不需要 Windows、USB、ADB、固定手機 IP或同一區域網路；
root 手機可由 `local-display.sh` 在本機維持 trusted virtual display，實體螢幕可關閉；
`scanner/scanner.py` 與 `scanner_gui.py` 僅保留為相容／維修模式。

## 資料夾
- `SPEC_autoscan.md` / `DEV_HISTORY.md` / 其他 .md：文件
- `module/`：Zygisk 模組最新原始碼（`cpp/`）+ 最新產物（`arm64-v8a.so`）+ 安裝包（`pikmin_hunter.zip`）
- `site/`：Codex Sites 網站、D1 schema、公開地圖與 `/admin` 掃描後台
- `phone_agent/`：手機自主掃描 Agent
- `scanner/`：舊 Windows 掃描器，相容／維修用途
- `reference/dump.cs`：IL2CPP 符號（查 RVA/偏移）
- `radar/`：舊版半自動工具（已被 scanner 取代，可忽略）

## 接手第一步
讀 `SPEC_autoscan.md`，確認至少一個 Agent 在線，再開啟 `https://mush.odyliao.cc/admin`
建立短距離單輪工作。多節點測試需確認各 Agent 領到不同 target ID、完成數正確累加，
以及停用節點後其 lease 能由其他 Agent 接手。
