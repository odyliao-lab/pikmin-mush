# 手機自主虛擬顯示掃描技術說明書

> 狀態：已在實體手機完成端到端驗證
> 參考實作：`phone_agent/local-display.sh`
> 測試基準：Redmi Note 10 5G、Android 13、Kitsune/Magisk root、scrcpy server 4.1

## 1. 文件目的

本文件定義 rooted Android 掃描 Agent 如何在完全不連接電腦、USB 或 ADB 的情況下，
由手機本機建立並維持一個可信任的 Android virtual display，讓 Pikmin Bloom 長時間
保持前景執行，同時讓實體螢幕關閉或供使用者操作其他 App。

本文件也是未來擴充第二台以上實體 Agent、支援其他 Android 版本、替換 display
backend、診斷現場故障及執行回退時的實作契約。修改相關程式前應先確認本文的安全
不變量、程序身分與狀態機仍然成立。

## 2. 範圍與非目標

### 2.1 本功能負責

- 手機開機後自動建立 trusted virtual display。
- 把遊戲 Activity 啟動到正確 display。
- 維持 display owner 與本機串流 sink 存活。
- 發生明確故障時重建 display 並更新 `game.display`。
- 防止 stale PID 對其他 Android 程序造成誤殺。
- 讓上述能力不依賴 Windows、ADB transport 或區域網路。

### 2.2 本功能不負責

- 雲端工作 claim、lease、renew、ACK 或排程公平性。
- Agent Token、`AGENT_ID`、上傳 offset 或 TSV partial buffer。
- GPS 目標寫入、掃描結果解析或等級過濾。
- 判斷一次掃描是否成功；這仍由 `agent.sh` 負責。
- 模擬器登入或 Play Integrity 規避。

因此 display watchdog 不得修改 Token、Agent config、upload offset、pending ACK、掃描
lease 或 `mushrooms.tsv`。

## 3. 名詞

| 名稱 | 定義 |
|---|---|
| Phone Agent | `agent.sh`，負責雲端派工、GPS、遊戲恢復與資料上傳。 |
| Display daemon | `local-display.sh daemon`，root 身分的長駐健康監控迴圈。 |
| Display server | scrcpy 4.1 device server，實際建立 Android virtual display。 |
| Drain | `localvd-drain`，連線到本機 abstract Unix socket 並丟棄影像資料。 |
| Display ID | Android 動態配置的 logical display id；每次重建或 reboot 都可能改變。 |
| Persistent state | Magisk 模組內跨 reboot 保存的程式、設定及憑證。 |
| Runtime state | `/data/local/tmp` 中可重建的 PID、log 及暫態狀態。 |

## 4. 系統拓樸

```text
                         HTTPS
                 +-------------------+
                 | mush.odyliao.cc   |
                 | jobs / leases /   |
                 | uploads / ACK     |
                 +---------^---------+
                           |
                    phone_agent/agent.sh
                           |
               game.display / am start --display
                           |
+--------------------------+----------------------------------+
| rooted Android phone                                        |
|                                                             |
| Magisk service.sh                                           |
|   +-- local-display.sh daemon (root watchdog)                |
|   |     +-- scrcpy-server 4.1                                |
|   |     |     +-- drops/operates as Android shell uid 2000   |
|   |     |     +-- trusted, always-unlocked virtual display   |
|   |     +-- localvd-drain                                    |
|   |           +-- connects to @scrcpy_50494b4d               |
|   |           +-- discards local H.264 stream                |
|   +-- agent.sh                                               |
|                                                             |
| Display N: Pikmin Bloom (RESUMED)                            |
| Display 0: physical screen (off or another App)              |
+-------------------------------------------------------------+
```

每支手機擁有自己的 Android kernel、socket namespace、PID namespace、Magisk module、
Agent Token 及 upload offset。因此多支手機不會共用 `SCID`、PID file 或 display ID；
固定 `SCID=50494b4d` 只需在單一手機內唯一。

## 5. 元件責任

| 元件 | 執行位置／身分 | 責任 |
|---|---|---|
| `service.sh` | Magisk late_start，root | 等待 boot completed、讀取 config、啟動 display daemon 與 Agent。 |
| `local-display.sh` | Android，root | lifecycle、PID 驗證、display health、重建及 Activity launch。 |
| `scrcpy-server` | Android app_process，shell UID 2000 | 呼叫 Android display service，持有 VirtualDisplay Binder object。 |
| `localvd-drain` | Android native process | 連接 abstract socket、持續消耗 encoder output，避免 server 因 client 缺席結束。 |
| `install-local-display.ps1` | Windows | 驗證裝置、編譯 ARM64 drain、部署資產、啟用 config、等待健康。 |
| `agent.sh` | Android root shell | 雲端掃描工作與遊戲層恢復；讀取 `game.display`。 |

## 6. 為何使用 scrcpy server + drain

Android 公開 `DisplayManager.createVirtualDisplay()` 可以建立 virtual display，Surface
也可以一開始為 null；但一般第三方 App 建立的 private/untrusted display 會遇到跨 App
啟動、鎖屏、system decoration 與權限限制。

scrcpy 已實作跨 Android 版本的 hidden/system API 相容層，並在 Android 13 加入：

- `VIRTUAL_DISPLAY_FLAG_TRUSTED`
- `VIRTUAL_DISPLAY_FLAG_OWN_DISPLAY_GROUP`
- `VIRTUAL_DISPLAY_FLAG_ALWAYS_UNLOCKED`
- `VIRTUAL_DISPLAY_FLAG_TOUCH_FEEDBACK_DISABLED`

目前直接重用經實機驗證的 scrcpy 4.1 server。scrcpy server 只有建立 video pipeline 時
才進入 `NewDisplayCapture`，因此不能單純使用 `--no-video`。本版以最低設定啟動
MediaCodec，再由 7.5 KB 的 `localvd-drain` 在手機內消耗輸出。

這是相容性優先的第一版。第 17 節定義未來移除 encoder 的替換邊界。

## 7. 程序與權限身分

### 7.1 root watchdog

Magisk `service.sh` 與 display daemon 使用 root 執行，原因是它們需要：

- 讀寫 Magisk module 內的 `game.display`。
- 驗證及終止自己的 worker PID。
- 以 `am start --display` 啟動遊戲。
- 跨 reboot 管理 `/data/local/tmp` runtime state。

### 7.2 display owner

scrcpy server 由 root launcher 啟動，但 server 依官方行為切換／使用 Android shell
UID 2000，最終 `dumpsys display` 顯示 owner 為：

```text
owner com.android.shell (uid 2000)
```

這個身分能取得建立 trusted display 所需的系統權限。不要將 server 改成一般 APK
UID；否則可能只得到 private display，遊戲無法正常跨 display 啟動或鎖屏後會停止。

### 7.3 SELinux 注意事項

- Magisk daemon context 不一定能從 `/proc/net/unix` 看到 abstract socket。
- 因此 readiness 不依賴搜尋 `/proc/net/unix`，而是直接重試 `localvd-drain` 連線。
- Magisk module 內腳本可能帶 `system_file` context；由 root 執行沒有問題。
- 所有 `.sh` 必須是 LF。混合 CRLF 曾導致 Magisk 顯示已執行 `service.sh`，但
  `MODDIR` 與條件判斷被 `\r` 污染，造成 daemon 與 Agent 都未啟動。

## 8. 檔案與資料契約

### 8.1 Persistent：Magisk module

```text
/data/adb/modules/pikmin_scanner_agent/
  agent.sh
  service.sh
  local-display.sh
  localvd-drain
  scrcpy-server
  config                  # private，不進 Git
  token                   # private，不進 Git
  game.display            # 目前有效 display id
  agent.pid
  local-display-daemon.log
  local-display-boot.log
```

### 8.2 Runtime：可安全重建

```text
/data/local/tmp/pikmin-local-display-runtime/
  daemon.pid
  server.pid
  drain.pid
  server.log
  drain.log
```

Runtime 內容不得被視為真實狀態來源。每個 PID 都必須再比對 `/proc/<pid>/cmdline`；
display ID 也必須在 `dumpsys display` 中存在。

### 8.3 `game.display`

- 內容只有一個十進位 display ID 與換行。
- 權限為 `0600`。
- 只有 display manager 可以在建立／回收 display 時修改。
- `agent.sh` 每次啟動或恢復遊戲前重新讀取，不得永久 cache。
- Display ID 不具跨重建或跨 reboot 穩定性。

## 9. 設定契約

手機 private `config` 支援：

```sh
SERVER_URL='https://mush.odyliao.cc'
AGENT_ID='每支手機唯一的 Agent ID'
POLL_SECONDS='2'
LOCAL_DISPLAY='1'
```

Display manager 目前另外接受啟動環境變數：

| 變數 | 預設 | 用途 |
|---|---|---|
| `PIKMIN_LOCAL_DISPLAY_DIR` | 腳本所在目錄 | Persistent asset 位置。 |
| `PIKMIN_LOCAL_DISPLAY_RUNTIME` | `/data/local/tmp/pikmin-local-display-runtime` | PID／log 位置。 |
| `PIKMIN_LOCAL_DISPLAY_SIZE` | `720x1600` | 虛擬 display 解析度。 |
| `PIKMIN_LOCAL_DISPLAY_DPI` | `320` | 虛擬 display density。 |

正式部署使用 `LOCAL_DISPLAY=1`；解析度環境變數目前主要供相容性測試。若未來需要每台
手機持久化不同解析度，應把欄位加入 private config 並在 `service.sh` 明確 export。

## 10. 開機時序

```text
Android boot
  -> Magisk late_start service mode
  -> execute module/service.sh
  -> wait until sys.boot_completed == 1
  -> source private config
  -> if LOCAL_DISPLAY=1: local-display.sh start-daemon
  -> validate stale daemon PID by cmdline
  -> daemon invokes start
  -> launch scrcpy server
  -> retry local drain connection
  -> parse dynamic display id from server.log
  -> write game.display
  -> am start --display N Pikmin
  -> service.sh waits until local-display.sh status is healthy
  -> validate/start agent.sh with cmdline-safe PID check
```

`service.sh` 不應在 `sys.boot_completed` 前啟動遊戲。過早啟動可能遇到 ActivityManager、
使用者 storage 或 system service 尚未可用。

## 11. Start 狀態機

1. 驗證既有 server PID、drain PID 與 display。
2. 若三者健康：重寫正確 `game.display` 後回傳成功，保持冪等。
3. 若任一不健康：只終止 cmdline 身分符合的 worker。
   對每個 worker 先送 TERM 並等待，逾時才對同一個已驗證 PID 送 SIGKILL；確認程序與舊
   display 都消失前不得刪除 PID file 或建立 replacement worker。
4. 驗證 `scrcpy-server` 可讀、`localvd-drain` 可執行。
5. 建立 mode `0700` runtime directory。
6. 以 `nohup setsid` 啟動 server，父程序立即用 `$!` 發布 PID。
7. 最多等待 server log readiness。
8. 每秒嘗試啟動 drain；連線失敗的 drain 會自行退出，成功者保持存活。
9. 從 `server.log` 解析 `New display ... (id=N)`。
10. 寫入 `game.display` 並執行 `am start --display N`。

父程序必須先以 `$!` 寫入 PID。若只讓子程序自行寫 PID，父程序可能在子程序尚未排程
前讀到空檔，錯誤判定 server 死亡。這個 race 已在實機測試中發生過。

## 12. 健康與恢復狀態機

Daemon 每 15 秒執行一次 `status`。

```text
                 +----------------+
                 | status healthy |
                 +-------+--------+
                         |
                      sleep 15s
                         |
                         v
              +----------+-----------+
              | PID identity valid?  |
              | display still exists?|
              +-----+------------+----+
                    | yes        | no
                    +------------+------> start/rebuild
```

Healthy 必須同時成立：

1. `server.pid` 存在、PID 存活且 cmdline 包含 `scrcpy.Server` 或 server launcher。
2. `drain.pid` 存在、PID 存活且 cmdline 包含 `localvd-drain` 或 drain launcher。
3. server log 可解析 display ID。
4. `dumpsys display` 仍包含該 `mDisplayId`。

不因 TSV 暫時沒有成長而重建 display。掃描冷卻、網路、伺服器派工與遊戲回應慢都可能
造成 TSV 停滯；遊戲層 recovery 由 `agent.sh` 處理。

### 12.1 Daemon stop 保證

Daemon 可能正同步執行最長約 60 秒的 start retry。daemon 由 `setsid` 啟動，因此 `stop`
先對已驗證 daemon 的 process group 發 TERM，連同進行中的 `start` child 一起停止；最多
等待 2 秒後，仍存活才對已通過身分驗證的 daemon PID 發 SIGKILL。接著逐一停止並等待
drain、server 與舊 display 消失。這避免舊 daemon／start child 在新 daemon 建立後又發布
一組 worker。

## 13. 安裝與升級

### 13.1 Windows prerequisites

- 目標手機已授權 ADB 且可使用 `su -c id`。
- CPU ABI 為 `arm64-v8a`。
- 已存在 `pikmin_scanner_agent` Magisk module 與 private config/token。
- NDK r27d 預設位於：
  `%LOCALAPPDATA%\CodexTools\android-ndk\android-ndk-r27d`
- scrcpy 4.1 server 預設位於：
  `%LOCALAPPDATA%\CodexTools\scrcpy-v4.1\scrcpy-server`

### 13.2 一次性安裝

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\phone_agent\install-local-display.ps1 `
  -Serial ANDROID_ADB_SERIAL
```

安裝器會：

1. 驗證 ADB、root 與 ABI。
2. 若同 serial 的 Windows Supervisor Scheduled Task、Supervisor 程序或手動啟動的 Windows
   headless scrcpy session 仍存在，立即中止，不對手機做任何部署。scrcpy 偵測同時比對
   `--serial` 與 serial-scoped `--window-title` marker；舊版 virtual／screen-off 只有在完整
   固定參數與正確 serial 全部符合時才視為受管理 session。
3. 使用 NDK 編譯 PIE ARM64 `localvd-drain`。
4. 推送到固定 staging directory。
5. 先停止舊 manager 與 cmdline 身分相符的舊 Agent，避免雙 owner 與舊 Agent 繼續把遊戲
   啟動到 display 0。
6. 複製 `agent.sh`、manager、service、drain 與 scrcpy server 到 Magisk module。
7. 保留既有 config、token、offset、log 與 TSV。
8. 設定 `LOCAL_DISPLAY=1`。
9. 透過新版 `service.sh` 啟動 display；確認 healthy 後才啟動新版 `agent.sh`。
10. 最多等待 90 秒直到 `status` healthy。

步驟 5 之後的任何錯誤都會進入自動 rollback：保留原始安裝錯誤供呼叫端診斷，同時嘗試
設定 `LOCAL_DISPLAY=0`、停止 daemon/workers、移除 `game.display`、把 Pikmin Activity 拉回
display 0，並直接啟動且驗證 Agent。若 rollback 本身有步驟失敗，另以 warning 回報，但
最後仍拋出原始安裝錯誤，不以 rollback 訊息覆蓋根因。

### 13.3 scrcpy 升級注意

以下三者必須同步：

- 安裝器的 `ScrcpyServerPath`。
- `local-display.sh` 傳給 server 的版本字串，目前為 `4.1`。
- server options 是否仍支援 `new_display`、`vd_destroy_content` 等名稱。

不可只替換 jar 而不跑 cold-start、Doze、reboot 與故障注入測試。

## 14. 新增第二支以上 Agent

每支手機都是獨立掃描節點，部署流程如下：

1. 使用不同的 Pikmin／Google 遊戲帳號，避免同帳號 session 衝突。
2. 在網站後台建立新 Agent，取得唯一 `AGENT_ID` 與只顯示一次的 Token。
3. 安裝 hook 與 `pikmin_scanner_agent` Magisk module。
4. 將該手機 private config 設為新 `AGENT_ID`，Token 寫入該手機 `token`。
5. 用 `adb devices -l` 取得該手機 serial。
6. 執行 `install-local-display.ps1 -Serial <serial>`。
7. 驗證該手機 reboot 後能單獨掃描。
8. 雲端確認兩支 Agent claim 到不同 target，且各自 upload/ACK。

禁止事項：

- 兩支手機使用相同 `AGENT_ID`。
- 兩支手機共用 Token。
- 複製另一支手機的 `upload.offset`、`pending.ack` 或 runtime PID files。
- 同一手機同時啟用 Windows virtual-display Supervisor 與 on-device daemon。

Windows Scheduled Task 名稱按 ADB serial 隔離，但 autonomous 模式不需要該 Task。若之前
已安裝，應移除：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\phone_agent\install-supervisor-task.ps1 uninstall `
  -Serial ANDROID_ADB_SERIAL
```

## 15. 相容性驗證矩陣

新手機型號或 Android major version 上線前至少完成：

| 測試 | 通過條件 |
|---|---|
| Root/ABI | `su -c id` 為 uid 0；ABI 有對應 drain binary。 |
| Cold start | 90 秒內 manager status healthy。 |
| Install rollback | 注入 server／drain 啟動失敗；最後為 `LOCAL_DISPLAY=0`、無 local daemon、遊戲在 display 0、Agent 存活，且呼叫端收到原始錯誤。 |
| Owner mutex | Windows headless 存活時 autonomous installer 拒絕；local flag／daemon／display 任一存在時 Windows start 拒絕。 |
| Display flags | display 為 trusted/always-unlocked，owner shell UID 2000。 |
| Game launch | Pikmin 是該 display 的 `topResumedActivity`。 |
| Physical screen | Display 0 可關閉；virtual display 維持 `ON`。 |
| Doze | `mWakefulness=Dozing` 時遊戲仍 resumed。 |
| ADB loss | 停止 ADB server／拔線後至少一個完整掃描週期。 |
| Server kill | SIGKILL server 後 daemon 只建立一個 replacement display。 |
| Drain kill | SIGKILL drain 後能重建且無殘留多實例。 |
| Reboot | 不下 ADB start 指令即恢復 daemon、display、遊戲與 Agent。 |
| Data | TSV 成長、offset 推進、ACK 完成且沒有重複 partial buffer。 |
| Battery | 至少記錄 1 小時溫度、耗電與 thermal throttling。 |

## 16. 維運與故障診斷

### 16.1 快速狀態

```sh
su -c '/data/adb/modules/pikmin_scanner_agent/local-display.sh status'
su -c 'cat /data/adb/modules/pikmin_scanner_agent/game.display'
dumpsys activity activities | grep -E 'topResumedActivity|displayId='
dumpsys display | grep -E 'DisplayDeviceInfo|mDisplayId='
```

### 16.2 Process 與 log

```sh
ps -A -o PID,PPID,ARGS | grep 'local-display.sh daemon'
ps -A -o PID,PPID,ARGS | grep 'scrcpy.Server'
ps -A -o PID,PPID,ARGS | grep 'localvd-drain'
su -c 'tail -n 100 /data/adb/modules/pikmin_scanner_agent/local-display-daemon.log'
su -c 'cat /data/local/tmp/pikmin-local-display-runtime/server.log'
su -c 'cat /data/local/tmp/pikmin-local-display-runtime/drain.log'
```

### 16.3 常見故障

| 症狀 | 可能原因 | 處理 |
|---|---|---|
| Magisk log 顯示 exec，但沒有 daemon | `service.sh` CRLF／混合換行 | 檢查 `sed -n l`，重新部署純 LF。 |
| `Text file busy` | 覆寫仍在執行的 drain | 安裝器必須先 stop 再 copy。 |
| Server 活著但沒有 display | drain 未連上 abstract socket | 檢查 `drain.log`、binary ABI/權限。 |
| 多個 daemon | 舊 daemon 未正確停止 | 驗證 daemon PID cmdline，先 stop；必要時精確 SIGKILL。 |
| Display healthy、遊戲不 resumed | Activity launch／遊戲層問題 | 讀 `game.display`，執行 `am start --display`，交由 Agent recovery。 |
| Reboot 後不啟動 | Magisk service、config 或 PID reuse | 查 `/cache/magisk.log`、`LOCAL_DISPLAY=1` 與 cmdline。 |
| Display ID 改變 | 正常重建／reboot 行為 | 不得硬編碼；以 `game.display` 為準。 |

## 17. 效能、耗電與下一代 backend

目前參數：

```text
resolution: 720x1600 @ 320 dpi
video_bit_rate: 100000 bit/s
max_fps: 1
audio: disabled
control: disabled
```

即使串流不離開手機，MediaCodec 與 GPU composition 仍有成本。正式大量擴充 Agent 前，
應建立每型號的溫度與電池基準。

### 17.1 無 encoder backend 目標

下一代實作應抽出 scrcpy `NewDisplayCapture`／DisplayManager wrapper，製作小型 Java/Dex
display owner：

1. 以 shell/system-compatible 身分啟動。
2. 建立相同 trusted flags 的 virtual display。
3. 使用 null Surface 或最低成本 dummy Surface。
4. 不初始化 MediaCodec、不建立串流 socket。
5. 對外仍維持相同契約：寫入 `game.display`、程序存活可檢查、死亡即移除 display。

只要保留以下 backend interface，`agent.sh` 與雲端不需變更：

```text
start -> dynamic display id
status -> healthy / stopped
stop -> release display
owner process death -> display removed
```

現行 scrcpy backend 應保留為相容性 fallback，直到新 backend 在至少兩種 OEM、兩個
Android major version 上通過第 15 節矩陣。

## 18. 回退方案

`install-local-display.ps1` 在安裝或 90 秒健康檢查失敗時會自動執行本節動作。以下命令供
操作者主動切回 Windows 模式或自動 rollback 也無法連線手機時使用。

停用 autonomous display：

```sh
su -c "sed -i 's/^LOCAL_DISPLAY=.*/LOCAL_DISPLAY=0/' \
  /data/adb/modules/pikmin_scanner_agent/config"
su -c '/data/adb/modules/pikmin_scanner_agent/local-display.sh stop'
am start --display 0 -n \
  com.nianticlabs.pikmin/com.nianticproject.ichigo.IchigoUnityPlayerActivity
```

若要恢復 Windows Supervisor，再重新安裝該手機 serial 的 Scheduled Task。Task 安裝器與
`headless-agent.ps1 start` 都會檢查手機 config、daemon PID 身分及 local display health；
任一仍表示 on-device owner 存在，就拒絕建立 Windows owner。反方向的 autonomous
安裝器也會拒絕既有 Supervisor／headless scrcpy。這是程式強制的雙向互斥，不只依賴
操作流程。

## 19. 安全不變量

任何未來修改都必須維持：

1. 不把 Token、config 或憑證寫入 Git／log。
2. 不以未驗證的 stale PID 執行 kill。
3. 不假設 display ID 穩定。
4. 不因 TSV stale 單獨重建 display。
5. 不同手機的 `AGENT_ID`、Token、offset 與 partial buffer 必須獨立。
6. Start 必須冪等，stop 必須只影響本功能擁有的程序。
7. Worker replacement 同時間最多一組 server + drain。
8. Display 建立成功後才更新 `game.display`。
9. 腳本保持 LF，native binary 與裝置 ABI 相符。
10. Windows Supervisor 與 on-device daemon 不得同時管理同一手機。

## 20. 已驗證結果

實體裝置：Redmi Note 10 5G，Android 13。

- 建立 shell-owned trusted display，遊戲正常 resumed。
- 實體手機進入 `Dozing`，virtual display 仍為 `ON`。
- 中斷 PC ADB server 超過 35 秒，display、遊戲與 Agent 持續存活。
- TSV 在斷線狀態繼續成長。
- SIGKILL server 後，daemon 將 display 20 自動替換為 display 21。
- 修正 CRLF 後，手機 reboot 無需 ADB start 即自動建立 display 2。
- Reboot 後 Agent 完成 recovery capture，TSV 由 `869164` 增至 `870048`。

## 21. 上游參考

- Android `DisplayManager` API：
  <https://developer.android.com/reference/android/hardware/display/DisplayManager.html>
- scrcpy 官方專案：<https://github.com/Genymobile/scrcpy>
- scrcpy 4.1 `NewDisplayCapture`：
  <https://github.com/Genymobile/scrcpy/blob/v4.1/server/src/main/java/com/genymobile/scrcpy/video/NewDisplayCapture.java>
- scrcpy developer architecture：
  <https://github.com/Genymobile/scrcpy/blob/v4.1/doc/develop.md>
