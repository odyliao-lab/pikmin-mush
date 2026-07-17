# Pikmin_Dev — 交接包（給接手開發用）

Pikmin Bloom 即時蘑菇雷達專案。root 手機透過常駐 Agent 自動移動 GPS、掃描指定城市，
資料直接送到 Codex Sites／D1，並即時呈現在 `https://mush.odyliao.cc/`。

## 先讀這個（依序）
1. **`SPEC_autoscan.md`** ← **主規格書，從這裡開始**。當前需求、已完成且驗證的部分（別重做）、待完成工作、完整技術規格（hook RVA/偏移/瞬移機制）、build/deploy 流程、關鍵陷阱。
2. `DEV_HISTORY.md` ← 開發背景與走過的死路（可選讀，理解「為何是這個做法」）。
3. `HOOK_TARGETS.md` / `WORKLOG.md` / `DESIGN_autoscan.md` ← 速查 / 日誌 / 舊版瞬移設計（部分已被 SPEC 取代）。

## 現況一句話
Zygisk 模組（`module/`）已能：hook 讀蘑菇（座標/等級/類型/到期）+ **自動瞬移**（實測可運作，呼叫遊戲內建 SetDeviceLocationOverrideForDebug）。
`site/` 提供公開地圖、受保護的 `/admin` 掃描後台、D1 任務 checkpoint 與手機命令 API。
`phone_agent/` 的 Magisk 常駐 Agent 會自行取得下一個網格點、移動 GPS、等待遊戲刷新、
增量上傳 `mushrooms.tsv` 並回報進度。正常掃描不需要 Windows、USB、ADB、固定手機 IP
或同一區域網路；`scanner/scanner.py` 與 `scanner_gui.py` 僅保留為相容／維修模式。

## 資料夾
- `SPEC_autoscan.md` / `DEV_HISTORY.md` / 其他 .md：文件
- `module/`：Zygisk 模組最新原始碼（`cpp/`）+ 最新產物（`arm64-v8a.so`）+ 安裝包（`pikmin_hunter.zip`）
- `site/`：Codex Sites 網站、D1 schema、公開地圖與 `/admin` 掃描後台
- `phone_agent/`：手機自主掃描 Agent
- `scanner/`：舊 Windows 掃描器，相容／維修用途
- `reference/dump.cs`：IL2CPP 符號（查 RVA/偏移）
- `radar/`：舊版半自動工具（已被 scanner 取代，可忽略）

## 接手第一步
讀 `SPEC_autoscan.md`，確認手機 Agent 在線，再開啟 `https://mush.odyliao.cc/admin`
建立短距離單輪工作，驗證 GPS、`mushrooms.tsv`、D1 與公開地圖端到端。
