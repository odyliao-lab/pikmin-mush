# Pikmin_Dev — 交接包（給接手開發用）

Pikmin Bloom 即時蘑菇雷達專案。目標：一支常接電腦的 root 手機，自動移動 GPS 掃描**指定區域**的蘑菇，
即時呈現在**自有網域**的網頁地圖（走 Cloudflare Tunnel）。

## 先讀這個（依序）
1. **`SPEC_autoscan.md`** ← **主規格書，從這裡開始**。當前需求、已完成且驗證的部分（別重做）、待完成工作、完整技術規格（hook RVA/偏移/瞬移機制）、build/deploy 流程、關鍵陷阱。
2. `DEV_HISTORY.md` ← 開發背景與走過的死路（可選讀，理解「為何是這個做法」）。
3. `HOOK_TARGETS.md` / `WORKLOG.md` / `DESIGN_autoscan.md` ← 速查 / 日誌 / 舊版瞬移設計（部分已被 SPEC 取代）。

## 現況一句話
Zygisk 模組（`module/`）已能：hook 讀蘑菇（座標/等級/類型/到期）+ **自動瞬移**（實測可運作，呼叫遊戲內建 SetDeviceLocationOverrideForDebug）。
主機端 `scanner/scanner.py` 逐點瞬移掃描、存 SQLite、自帶網頁地圖 `scanner/map.html`（:8787）。
目前預設改用 `phone_agent/` 的 Magisk 常駐 Agent：手機主動透過 HTTPS 取得 GPS 命令並增量上傳
`mushrooms.tsv`，正常掃描已不需要 USB、ADB、固定手機 IP或同一區域網路；ADB 僅保留為相容／維修模式。
**剛修好一個檔案 handle bug（見 SPEC §7），待端到端確認** → Codex 首要工作。

## 資料夾
- `SPEC_autoscan.md` / `DEV_HISTORY.md` / 其他 .md：文件
- `module/`：Zygisk 模組最新原始碼（`cpp/`）+ 最新產物（`arm64-v8a.so`）+ 安裝包（`pikmin_hunter.zip`）
- `scanner/`：**當前主程式** scanner.py + map.html
- `reference/dump.cs`：IL2CPP 符號（查 RVA/偏移）
- `radar/`：舊版半自動工具（已被 scanner 取代，可忽略）

## 接手第一步
讀 `SPEC_autoscan.md`。先照 §6 build/deploy 最新模組、跑 `scanner/scanner.py`，驗證 §7 的檔案修正是否讓端到端通（mushrooms.tsv 持續累積、網頁有標點）。接著校準掃描速度（§5.2）、做 Cloudflare Tunnel（§5.4）。
