#!/usr/bin/env python3
"""
Pikmin 蘑菇雷達 — 全自動區域掃描器
====================================
搭配 Zygisk 模組 zygisk_pikmin_hunter（已內建自動瞬移 + 蘑菇 hook）。
本工具：對指定區域產生網格 → 逐點寫 teleport.txt 讓遊戲瞬移 → 等載入 → 讀 mushrooms.tsv
        → 存 SQLite（id 去重、finishMs 過期）→ 自帶網頁地圖（供 Cloudflare Tunnel 對外）。

用法：先在 CONFIG 設好區域 bbox 與節流參數，然後 `python scanner.py`。
      瀏覽器開 http://localhost:8787/ 看即時地圖。

⚠ 軟封：Niantic 有速度限制，瞬移太快太遠伺服器會暫停回資料。
   - 首次跳進目標區是大跳 → 需一次冷卻（視距離，數十分鐘）。建議先用手機 joystick 移到目標區附近再啟動。
   - 區內用小步跳（GRID_STEP_M）+ 每步延遲（HOP_DELAY_S）即可避免。實測再微調。
"""
import argparse, subprocess, sqlite3, time, math, threading, json, os, re, secrets, http.server, socketserver
import xml.etree.ElementTree as ET
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ADB_LOCK = threading.Lock()

# ----------------- CONFIG -----------------
ADB = os.path.expandvars(
    r"%LOCALAPPDATA%\CodexTools\android-platform-tools\platform-tools\adb.exe"
)
PKG = "com.nianticlabs.pikmin"
DEV_TSV = f"/data/user/0/{PKG}/files/mushrooms.tsv"
DEV_TELE = f"/data/user/0/{PKG}/files/teleport.txt"

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "mushrooms.db")
PORT = 8787

# 要掃描的區域（bbox）。預設：台北市中心一小塊，換成你要的區域。
REGION = dict(lat_min=25.020, lat_max=25.060, lng_min=121.500, lng_max=121.560)
GRID_STEP_M = 500      # 網格間距（公尺）。遊戲可視半徑約 600m，500 有重疊不漏。
DWELL_S = 6            # 每點瞬移後等待載入+擷取的秒數
HOP_DELAY_S = 4        # 每步之間額外延遲（節流，避免軟封）
LOOP_FOREVER = True    # 掃完整區後從頭再掃（抓過期/重生）
START_INDEX = 0        # 校準/續掃時可從指定網格索引開始（0-based）
MAX_POINTS = None      # None=跑完整輪；校準時可限制點數
REGIONS = None         # GUI 全自動模式傳入的多城市 bbox
INTER_REGION_COOLDOWN_S = 30
AUTO_CONFIRM_SPEED_WARNING = False
OPTIMIZE_REGION_ORDER = False
RESUME_CHECKPOINT = False
CHECKPOINT_FILE = os.path.join(HERE, "scan_checkpoint.json")
DEVICE_BACKEND = "adb"
AGENT_TOKEN_FILE = os.path.join(HERE, "agent_token.txt")
AGENT_TOKEN = ""
CONTROLLER_TOKEN_FILE = os.path.join(HERE, "controller_token.txt")
CONTROLLER_TOKEN = ""
CLOUD_API_URL = os.environ.get("PIKMIN_CLOUD_URL", "").strip().rstrip("/")
AGENT_COND = threading.Condition(threading.RLock())
AGENT_STATE = dict(last_seen=0.0, seq=0, ack_seq=0, command=None, ack_ok=False,
                   ack_message="", rows=[], partial=b"", uploaded_bytes=0,
                   current_location=None)

def load_agent_token(path):
    """讀取或建立手機 Agent 專用 bearer token。"""
    try:
        with open(path, encoding="utf-8") as f:
            token = f.read().strip()
    except OSError:
        token = ""
    if len(token) < 32:
        token = secrets.token_urlsafe(36)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(token + "\n")
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    return token

def load_existing_token(path, purpose):
    try:
        with open(path, encoding="utf-8") as f:
            token = f.read().strip()
    except OSError:
        token = ""
    if len(token) < 32:
        raise RuntimeError(f"{purpose} token 檔案不存在或長度不足：{path}")
    return token

def cloud_request(path, method="GET", payload=None, timeout=30):
    """呼叫 Codex Sites 雲端中樞，不在錯誤訊息中暴露 bearer token。"""
    if not CLOUD_API_URL:
        raise RuntimeError("尚未設定 Codex Sites 雲端中樞網址")
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {CONTROLLER_TOKEN}",
        "Accept": "application/json",
        # Codex Sites 的 Cloudflare 邊緣會封鎖 Python urllib 預設指紋
        # （HTTP 403 / Error 1010）。使用固定、可辨識的桌面客戶端 UA。
        "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/126.0 Safari/537.36 PikminScanner/1.0"),
    }
    if body is not None:
        headers["Content-Type"] = "application/json; charset=utf-8"
    request = Request(CLOUD_API_URL + path, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except HTTPError as e:
        detail = e.read(300).decode("utf-8", errors="replace")
        raise RuntimeError(f"雲端中樞 HTTP {e.code}：{detail}") from None
    except (URLError, TimeoutError, OSError) as e:
        raise RuntimeError(f"雲端中樞暫時無法連線：{e}") from None
    if not raw:
        return {}
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {"text": raw.decode("utf-8", errors="replace")}

def cloud_agent_state():
    return cloud_request("/api/controller/state", timeout=20)

def cloud_publish_status():
    if not CLOUD_API_URL:
        return
    try:
        cloud_request("/api/controller/status", method="POST", payload=STATUS, timeout=20)
    except RuntimeError as e:
        print(f"[cloud][warn] 掃描進度暫時無法上報：{e}")

# ----------------- DB -----------------
def db_init():
    con = sqlite3.connect(DB_PATH)
    con.execute("""CREATE TABLE IF NOT EXISTS mushrooms(
        id TEXT PRIMARY KEY, lat REAL, lng REAL, level INT, type INT,
        cluster TEXT, cooldown INT, finish_ms INTEGER,
        first_seen INTEGER, last_seen INTEGER,
        challenger_count INT DEFAULT 0, challenger_capacity INT DEFAULT 0,
        total_power REAL DEFAULT 0, start_ms INTEGER DEFAULT 0)""")
    existing = {row[1] for row in con.execute("PRAGMA table_info(mushrooms)")}
    for name, definition in (("challenger_count", "INT DEFAULT 0"),
                             ("challenger_capacity", "INT DEFAULT 0"),
                             ("total_power", "REAL DEFAULT 0"),
                             ("start_ms", "INTEGER DEFAULT 0")):
        if name not in existing:
            con.execute(f"ALTER TABLE mushrooms ADD COLUMN {name} {definition}")
    con.commit(); con.close()

def db_upsert(rows):
    rows = [row for row in rows if row.get("level", 0) >= 2]
    if not rows: return 0
    con = sqlite3.connect(DB_PATH)
    now = int(time.time())
    added = 0
    for r in rows:
        cur = con.execute("SELECT id FROM mushrooms WHERE id=?", (r["id"],))
        if cur.fetchone():
            con.execute("""UPDATE mushrooms SET lat=?, lng=?, level=?, type=?, cluster=?,
                           cooldown=?, finish_ms=?, challenger_count=?, challenger_capacity=?,
                           total_power=?, start_ms=?, last_seen=? WHERE id=?""",
                        (r["lat"], r["lng"], r["level"], r["type"], r["cluster"],
                         r["cooldown"], r["finish_ms"], r["challenger_count"],
                         r["challenger_capacity"], r["total_power"], r["start_ms"], now, r["id"]))
        else:
            con.execute("""INSERT INTO mushrooms(id,lat,lng,level,type,cluster,cooldown,finish_ms,
                           first_seen,last_seen,challenger_count,challenger_capacity,total_power,start_ms)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (r["id"], r["lat"], r["lng"], r["level"], r["type"], r["cluster"],
                         r["cooldown"], r["finish_ms"], now, now, r["challenger_count"],
                         r["challenger_capacity"], r["total_power"], r["start_ms"]))
            added += 1
    con.commit(); con.close()
    return added

def db_active():
    """回傳未過期的蘑菇（finish_ms 為 0 或 > 現在）。"""
    con = sqlite3.connect(DB_PATH)
    now_ms = int(time.time() * 1000)
    cur = con.execute("""SELECT id,lat,lng,level,type,cluster,cooldown,finish_ms,first_seen,last_seen,
                         challenger_count,challenger_capacity,total_power,start_ms
                         FROM mushrooms
                         WHERE level>=2 AND (finish_ms=0 OR finish_ms>?)""", (now_ms,))
    cols = ["id","lat","lng","level","type","cluster","cooldown","finish_ms","first_seen","last_seen",
            "challenger_count","challenger_capacity","total_power","start_ms"]
    out = [dict(zip(cols, row)) for row in cur.fetchall()]
    con.close()
    return out

# ----------------- device I/O -----------------
def agent_online():
    if CLOUD_API_URL:
        try:
            return bool(cloud_agent_state().get("online"))
        except RuntimeError:
            return False
    with AGENT_COND:
        return time.time() - AGENT_STATE["last_seen"] < 12

def agent_wait_online():
    if CLOUD_API_URL:
        attempt = 0
        while True:
            try:
                state = cloud_agent_state()
                if state.get("online"):
                    if attempt:
                        print("[agent] 手機 Agent 已恢復連線")
                    return
            except RuntimeError as e:
                state = {}
                if attempt == 0 or attempt % 12 == 0:
                    print(f"[cloud][warn] {e}")
            attempt += 1
            STATUS["last_msg"] = "等待手機 Agent 連線；掃描停在目前網格點"
            if attempt == 1 or attempt % 12 == 0:
                print("[agent][warn]", STATUS["last_msg"])
                cloud_publish_status()
            time.sleep(5)
    attempt = 0
    with AGENT_COND:
        while time.time() - AGENT_STATE["last_seen"] >= 12:
            attempt += 1
            STATUS["last_msg"] = "等待手機 Agent 連線；掃描停在目前網格點"
            if attempt == 1 or attempt % 12 == 0:
                print("[agent][warn]", STATUS["last_msg"])
            AGENT_COND.wait(timeout=5)
    if attempt:
        print("[agent] 手機 Agent 已恢復連線")

def agent_send_command(op, *args):
    """送出單一命令並等待手機 Agent ACK；斷網時保留命令持續等待。"""
    agent_wait_online()
    if CLOUD_API_URL:
        result = cloud_request("/api/controller/command", method="POST",
                               payload={"op": op, "args": [str(x) for x in args]})
        seq = int(result.get("seq", 0))
        if seq <= 0:
            raise RuntimeError("雲端中樞未回傳有效命令序號")
        waited = 0
        while True:
            try:
                state = cloud_agent_state()
                if int(state.get("ack_seq", 0)) >= seq:
                    if not state.get("ack_ok"):
                        raise RuntimeError(state.get("ack_message") or
                                           f"手機 Agent 執行 {op} 失敗")
                    return str(state.get("ack_message") or "")
            except RuntimeError as e:
                if "執行" in str(e):
                    raise
            time.sleep(2)
            waited += 2
            if waited % 30 == 0:
                STATUS["last_msg"] = f"等待手機 Agent 完成 {op}（{waited} 秒）"
                print("[agent]", STATUS["last_msg"])
                cloud_publish_status()
    with AGENT_COND:
        AGENT_STATE["seq"] += 1
        seq = AGENT_STATE["seq"]
        AGENT_STATE["command"] = (seq, op, *[str(x) for x in args])
        AGENT_STATE["ack_ok"] = False
        AGENT_STATE["ack_message"] = ""
        AGENT_COND.notify_all()
        waited = 0
        while AGENT_STATE["ack_seq"] < seq:
            AGENT_COND.wait(timeout=5)
            waited += 5
            if waited % 30 == 0:
                STATUS["last_msg"] = f"等待手機 Agent 完成 {op}（{waited} 秒）"
                print("[agent]", STATUS["last_msg"])
        if not AGENT_STATE["ack_ok"]:
            raise RuntimeError(AGENT_STATE["ack_message"] or f"手機 Agent 執行 {op} 失敗")
        return AGENT_STATE["ack_message"]

def parse_tsv_text(text):
    rows = []
    for line in text.splitlines():
        p = line.rstrip("\r").split("\t")
        if len(p) < 4 or not p[1]:
            continue
        try:
            lat, lng = float(p[2]), float(p[3])
        except ValueError:
            continue
        g = lambda i: int(p[i]) if len(p) > i and p[i].lstrip("-").isdigit() else 0
        try:
            total_power = float(p[11]) if len(p) > 11 else 0
        except ValueError:
            total_power = 0
        level = g(6)
        if level < 2:
            continue
        rows.append(dict(id=p[1], lat=lat, lng=lng, cluster=(p[4] if len(p) > 4 else ""),
                         cooldown=g(5), level=level, type=g(7), finish_ms=g(8),
                         challenger_count=g(9), challenger_capacity=g(10),
                         total_power=total_power, start_ms=g(12)))
    return rows

def adb_run(args, timeout=20):
    """Serialize ADB clients and always decode Android output as UTF-8."""
    with ADB_LOCK:
        return subprocess.run([ADB, *args], capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=timeout)

def adb_state():
    try:
        r = adb_run(["get-state"], timeout=8)
        return "device" if r.returncode == 0 and r.stdout.strip() == "device" else (
            (r.stderr or r.stdout or "unknown").strip().lower())
    except (OSError, subprocess.SubprocessError) as e:
        return str(e).lower()

def wait_for_device():
    """Pause on the current grid point until ADB is genuinely usable again."""
    if DEVICE_BACKEND == "agent":
        agent_wait_online()
        return
    attempt = 0
    while True:
        state = adb_state()
        if state == "device":
            if attempt:
                print("[adb] 裝置連線已恢復，繼續目前網格點")
            return
        attempt += 1
        if "unauthorized" in state:
            msg = "ADB 尚未授權；請在手機勾選一律允許並按下允許，掃描已暫停"
        elif "offline" in state:
            msg = "ADB 裝置離線，掃描已暫停於目前網格點並等待重連"
        else:
            msg = f"ADB 無法使用（{state or 'no device'}），掃描已暫停"
        status = globals().get("STATUS")
        if status is not None:
            status["last_msg"] = msg
        if attempt == 1 or attempt % 10 == 0:
            print("[adb][warn]", msg)
        try:
            if "offline" in state:
                adb_run(["reconnect", "offline"], timeout=15)
            else:
                adb_run(["start-server"], timeout=12)
        except (OSError, subprocess.SubprocessError):
            pass
        time.sleep(3)

def adb_su(cmd):
    wait_for_device()
    return adb_run(["shell", f"su -c '{cmd}'"], timeout=20)

def teleport(lat, lng):
    target = f"{lat:.7f},{lng:.7f}"
    if DEVICE_BACKEND == "agent":
        agent_send_command("teleport", f"{lat:.7f}", f"{lng:.7f}")
        return
    attempt = 0
    while True:
        written = adb_su(f'echo "{target}" > {DEV_TELE}')
        verified = adb_su(f"cat {DEV_TELE} 2>/dev/null") if written.returncode == 0 else written
        if written.returncode == 0 and verified.returncode == 0 and verified.stdout.strip() == target:
            if attempt:
                print(f"[adb] GPS 寫入與回讀成功：{target}")
            return
        attempt += 1
        if attempt == 1 or attempt % 6 == 0:
            print(f"[adb][warn] GPS 寫入未確認，停在本點重試：{target}")
        time.sleep(3)

def read_tsv():
    if DEVICE_BACKEND == "agent":
        agent_wait_online()
        with AGENT_COND:
            need_sync = not AGENT_STATE.get("synced", False) and not AGENT_STATE["rows"]
            if AGENT_STATE["rows"]:
                AGENT_STATE["synced"] = True
        if need_sync:
            agent_send_command("sync")
            with AGENT_COND:
                AGENT_STATE["synced"] = True
        with AGENT_COND:
            return list(AGENT_STATE["rows"])
    while True:
        r = adb_su(f"cat {DEV_TSV} 2>/dev/null")
        transport_error = any(x in (r.stderr or "").lower() for x in
                              ("device offline", "device unauthorized", "no devices", "device not found"))
        if not transport_error:
            break
        print("[adb][warn] 讀取蘑菇資料時連線中斷，停在本點重試")
        time.sleep(3)
    return parse_tsv_text(r.stdout)

def capture_snapshot():
    """回傳目前資料與累積擷取計數；雲端模式以 D1 上傳列數判斷新回呼。"""
    if DEVICE_BACKEND == "agent" and CLOUD_API_URL:
        state = cloud_agent_state()
        return [], int(state.get("uploaded_rows", 0))
    rows = read_tsv()
    return rows, len(rows)

def auto_confirm_speed_warning_loop():
    """只在畫面含速度警告時點擊確認，避免誤按其他遊戲對話框。"""
    warning_words = ("移動速度", "速度太快", "移动速度", "moving too fast", "traveling too fast")
    confirm_words = ("確定", "确认", "確認", "OK", "Ok", "ok")
    while True:
        try:
            if adb_state() != "device":
                time.sleep(3)
                continue
            adb_run(["shell", "uiautomator", "dump", "/sdcard/pikmin_ui.xml"], timeout=12)
            r = adb_run(["shell", "cat", "/sdcard/pikmin_ui.xml"], timeout=8)
            if r.returncode != 0 or not r.stdout:
                time.sleep(2)
                continue
            root = ET.fromstring(r.stdout)
            nodes = list(root.iter("node"))
            screen_text = " ".join((n.attrib.get("text", "") + " " +
                                    n.attrib.get("content-desc", "")) for n in nodes).lower()
            if any(w.lower() in screen_text for w in warning_words):
                for n in nodes:
                    label = (n.attrib.get("text", "") or n.attrib.get("content-desc", "")).strip()
                    if label in confirm_words:
                        nums = [int(x) for x in re.findall(r"\d+", n.attrib.get("bounds", ""))]
                        if len(nums) == 4:
                            x, y = (nums[0] + nums[2]) // 2, (nums[1] + nums[3]) // 2
                            adb_run(["shell", "input", "tap", str(x), str(y)], timeout=8)
                            print(f"[ui] 已自動確認速度警告 @{x},{y}")
                            break
        except (subprocess.SubprocessError, ET.ParseError, OSError):
            pass
        time.sleep(2)

def confirm_speed_warning():
    if DEVICE_BACKEND == "agent":
        try:
            agent_send_command("confirm")
        except RuntimeError as e:
            print(f"[ui][warn] 手機 Agent 確認鍵失敗，掃描仍會繼續：{e}")
        return
    wait_for_device()
    adb_run(["shell", "input", "keyevent", "KEYCODE_ENTER"], timeout=8)
    adb_run(["shell", "input", "keyevent", "KEYCODE_DPAD_CENTER"], timeout=8)

def restart_game_session(city_name):
    """保留 teleport.txt 的目前座標，重啟卡住的遊戲地圖 session。"""
    msg = f"{city_name} 連續無擷取，正在同座標重啟遊戲 session"
    STATUS["last_msg"] = msg
    print("[recover]", msg)
    if DEVICE_BACKEND == "agent":
        for attempt in range(2):
            try:
                agent_send_command("restart")
                print(f"[recover] {city_name} 遊戲 session 已由手機 Agent 重啟")
                return
            except RuntimeError as e:
                print(f"[recover][warn] 手機 Agent 重啟失敗（{attempt + 1}/2）：{e}")
                time.sleep(5)
        return
    wait_for_device()
    adb_run(["shell", "am", "force-stop", PKG], timeout=12)
    time.sleep(2)
    launched = adb_run(["shell", "monkey", "-p", PKG, "-c",
                        "android.intent.category.LAUNCHER", "1"], timeout=15)
    if launched.returncode != 0:
        print("[recover][warn] 遊戲啟動指令失敗，稍後仍會繼續嘗試讀取")
    time.sleep(25)
    # Unity 對話框不一定出現在 UIAutomator tree；補送兩種安全確認鍵。
    adb_run(["shell", "input", "keyevent", "KEYCODE_ENTER"], timeout=8)
    adb_run(["shell", "input", "keyevent", "KEYCODE_DPAD_CENTER"], timeout=8)
    time.sleep(5)
    print(f"[recover] {city_name} 遊戲 session 已重啟，重新讀取目前位置")

# ----------------- grid -----------------
def gen_grid(region, step_m):
    latc = (region["lat_min"] + region["lat_max"]) / 2
    dlat = step_m / 111320.0
    dlng = step_m / (111320.0 * math.cos(math.radians(latc)))
    lats, lat = [], region["lat_min"]
    while lat <= region["lat_max"]:
        lats.append(lat); lat += dlat
    lngs, lng = [], region["lng_min"]
    while lng <= region["lng_max"]:
        lngs.append(lng); lng += dlng
    pts, flip = [], False
    for la in lats:                          # 蛇形，鄰點距離小
        row = [(la, lo) for lo in lngs]
        if flip: row.reverse()
        pts += row; flip = not flip
    return pts

def region_center(region):
    return ((region["lat_min"] + region["lat_max"]) / 2,
            (region["lng_min"] + region["lng_max"]) / 2)

def region_distance_km(a, b):
    lat1, lng1 = region_center(a); lat2, lng2 = region_center(b)
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2-lat1), math.radians(lng2-lng1)
    h = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 6371 * 2 * math.asin(min(1, math.sqrt(h)))

def optimize_region_order(regions, start_from=None):
    """由目前 GPS 最近的城市起跑，再以最近鄰減少跨城總移動距離。"""
    if len(regions) < 3: return regions
    remaining = list(regions)
    if start_from is not None:
        first = min(remaining, key=lambda r: region_distance_km(start_from, r))
        remaining.remove(first)
    else:
        first = remaining.pop(0)
    ordered = [first]
    while remaining:
        nxt = min(remaining, key=lambda r: region_distance_km(ordered[-1], r))
        ordered.append(nxt); remaining.remove(nxt)
    return ordered

def checkpoint_signature(regions):
    return [r.get("name", "") for r in regions]

def save_checkpoint(regions, next_region):
    try:
        with open(CHECKPOINT_FILE, "w", encoding="utf-8") as f:
            json.dump({"regions": checkpoint_signature(regions), "next_region": next_region}, f,
                      ensure_ascii=False)
    except OSError:
        pass

def current_teleport_region():
    """將手機目前的 override 座標當成第一城之前的起點。"""
    try:
        if DEVICE_BACKEND == "agent":
            result = agent_send_command("status")
            lat, lng = (float(x.strip()) for x in result.split(",", 1))
            return dict(name="目前 GPS", lat_min=lat, lat_max=lat,
                        lng_min=lng, lng_max=lng)
        r = adb_su(f"cat {DEV_TELE} 2>/dev/null")
        if r.returncode != 0:
            return None
        lat, lng = (float(x.strip()) for x in r.stdout.strip().split(",", 1))
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            return None
        return dict(name="目前 GPS", lat_min=lat, lat_max=lat,
                    lng_min=lng, lng_max=lng)
    except (ValueError, TypeError):
        return None

# ----------------- scan loop -----------------
STATUS = dict(running=False, point=0, total=0, at=None, added_total=0,
              captured_total=0, new_at_point=0, empty_capture_streak=0,
              softban_warn=0, last_msg="")

def scan_loop():
    db_init()
    regions = REGIONS or [dict(name="自訂區域", **REGION)]
    initial_location = current_teleport_region()
    if OPTIMIZE_REGION_ORDER:
        regions = optimize_region_order(regions, initial_location)
    prepared = [(r, gen_grid(r, GRID_STEP_M)) for r in regions]
    total = sum(len(grid) for _, grid in prepared)
    STATUS.update(total=total, running=True, city=regions[0].get("name", "自訂區域"),
                  country=regions[0].get("country", ""),
                  city_index=1, city_total=len(regions))
    cloud_publish_status()
    print(f"[scan] {len(regions)} 個區域、共 {total} 點，間距 {GRID_STEP_M}m，每點 {DWELL_S}+{HOP_DELAY_S}s")
    # mushrooms.tsv 是累積檔，且新版模組會定期重寫相同 ID 的最新狀態。
    # 因此以「新增行數」而非「新 ID 數」判斷本跳是否有收到資料。
    baseline_rows, known_row_count = capture_snapshot()
    initial_added = 0 if CLOUD_API_URL else db_upsert(baseline_rows)
    STATUS["added_total"] += initial_added
    print(f"[scan] 裝置累積檔基線 {known_row_count} 行 / DB+{initial_added}")
    zero_streak = 0
    start_region = 0
    if RESUME_CHECKPOINT and os.path.exists(CHECKPOINT_FILE):
        try:
            with open(CHECKPOINT_FILE, encoding="utf-8") as f: checkpoint = json.load(f)
            if checkpoint.get("regions") == checkpoint_signature(regions):
                start_region = min(max(0, int(checkpoint.get("next_region", 0))), len(regions)-1)
                STATUS["last_msg"] = f"從城市 {start_region + 1}/{len(regions)} 繼續"
                print("[scan]", STATUS["last_msg"])
        except (OSError, ValueError, json.JSONDecodeError):
            pass
    # 重新啟動時第一城也要依手機上次座標判斷跨城距離。
    loop_previous_region = initial_location
    while True:
        global_point = 0
        previous_region = (loop_previous_region if loop_previous_region is not None
                           else (prepared[start_region-1][0] if start_region else None))
        loop_previous_region = None
        for region_index in range(start_region, len(prepared)):
            region, grid = prepared[region_index]
            recovered_region = False
            region_zero_streak = 0
            name = region.get("name", f"區域 {region_index + 1}")
            STATUS.update(city=name, country=region.get("country", ""), city_index=region_index + 1)
            cloud_publish_status()
            print(f"[scan] 城市 {region_index + 1}/{len(regions)}：{name}（{len(grid)} 點）")
            region_cooldown = 0
            if previous_region is not None and INTER_REGION_COOLDOWN_S > 0:
                distance = region_distance_km(previous_region, region)
                region_cooldown = max(INTER_REGION_COOLDOWN_S, min(120, distance / 10))
                STATUS["last_msg"] = (f"跨城 {distance:.0f} km，抵達後冷卻 "
                                      f"{region_cooldown:.0f} 秒：{name}")
                print("[scan]", STATUS["last_msg"])
            scan_grid = list(enumerate(grid))
            if len(regions) == 1:
                scan_grid = scan_grid[START_INDEX:]
                if MAX_POINTS is not None:
                    scan_grid = scan_grid[:MAX_POINTS]
            for point_pos, (i, (lat, lng)) in enumerate(scan_grid):
                global_point += 1
                teleport(lat, lng)
                STATUS.update(point=global_point, at=[round(lat, 5), round(lng, 5)])
                cloud_publish_status()
                # Unity 畫面若未把文字暴露給 UIAutomator，跨城市首跳仍以 Enter
                # 確認預設按鈕；一般地圖畫面收到 Enter 不會觸發危險操作。
                if AUTO_CONFIRM_SPEED_WARNING and point_pos == 0:
                    time.sleep(3)
                    confirm_speed_warning()
                    print(f"[ui] {name} 首跳後送出確認鍵")
                # 速度限制從伺服器收到新 GPS 後才開始計算，必須抵達後再冷卻。
                if point_pos == 0 and region_cooldown > 0:
                    STATUS["last_msg"] = f"已抵達 {name}，冷卻 {region_cooldown:.0f} 秒"
                    print("[scan]", STATUS["last_msg"])
                    time.sleep(region_cooldown)
                time.sleep(DWELL_S)
                rows, row_count = capture_snapshot()
                if CLOUD_API_URL:
                    new_rows = []
                    new_count = max(0, row_count - known_row_count)
                elif len(rows) >= known_row_count:
                    new_rows = rows[known_row_count:]
                    new_count = len(new_rows)
                else:  # 檔案被人工清空/截短後，現有內容全部視為新資料
                    new_rows = rows
                    new_count = len(new_rows)
                # 主要城市連續三點仍完全無回呼，多半是長距離跳躍後 Unity
                # 地圖 session 卡住。保留目前 GPS 重啟一次，實機可恢復 RegisterMapObject。
                if new_count == 0 and region_zero_streak >= 2 and not recovered_region:
                    recovered_region = True
                    restart_game_session(name)
                    rows, row_count = capture_snapshot()
                    if CLOUD_API_URL:
                        new_rows = []
                        new_count = max(0, row_count - known_row_count)
                    else:
                        new_rows = rows[known_row_count:] if len(rows) >= known_row_count else rows
                        new_count = len(new_rows)
                known_row_count = row_count
                added = 0 if CLOUD_API_URL else db_upsert(new_rows)
                STATUS["added_total"] += added
                STATUS["captured_total"] += new_count
                STATUS["new_at_point"] = new_count
                zero_streak = zero_streak + 1 if new_count == 0 else 0
                region_zero_streak = region_zero_streak + 1 if new_count == 0 else 0
                STATUS["empty_capture_streak"] = zero_streak
                if zero_streak and zero_streak % 8 == 0:
                    STATUS["softban_warn"] += 1
                    STATUS["last_msg"] = f"連續 {zero_streak} 點無新擷取（可能軟封、重疊區或該區無蘑菇）"
                    print("[scan][warn]", STATUS["last_msg"])
                print(f"[scan] {name} {i+1}/{len(grid)} @{lat:.5f},{lng:.5f} "
                      f"擷取+{new_count} DB+{added}")
                cloud_publish_status()
                time.sleep(HOP_DELAY_S)
            save_checkpoint(regions, region_index + 1)
            previous_region = region
        if not LOOP_FOREVER:
            STATUS["running"] = False
            STATUS["last_msg"] = "所有選取城市掃描完成"
            cloud_publish_status()
            try: os.remove(CHECKPOINT_FILE)
            except OSError: pass
            print("[scan] 所有區域單輪完成。"); return
        # 下一輪第一城仍視為跨城移動，套用最後一城到第一城的冷卻。
        loop_previous_region = prepared[-1][0]
        start_region = 0
        save_checkpoint(regions, 0)
        print("[scan] 所有區域完成，重新巡迴。")
        cloud_publish_status()

# ----------------- web -----------------
class Handler(http.server.SimpleHTTPRequestHandler):
    def _agent_authorized(self):
        return bool(AGENT_TOKEN) and secrets.compare_digest(
            self.headers.get("Authorization", ""), f"Bearer {AGENT_TOKEN}")

    def _send_bytes(self, code, body, ctype="text/plain; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path in ("/", "/index.html", "/map.html"):
            self._send_file(os.path.join(HERE, "map.html"), "text/html; charset=utf-8")
        elif u.path == "/api/mushrooms":
            if CLOUD_API_URL:
                try:
                    body = json.dumps(cloud_request("/api/mushrooms"), ensure_ascii=False).encode()
                    self._send_bytes(200, body, "application/json; charset=utf-8")
                except RuntimeError as e:
                    self._send_bytes(502, json.dumps(
                        {"updated": int(time.time()), "status": STATUS,
                         "mushrooms": [], "error": str(e)},
                        ensure_ascii=False).encode(), "application/json; charset=utf-8")
                return
            data = db_active()
            with AGENT_COND:
                agent_status = {
                    "backend": DEVICE_BACKEND,
                    "online": time.time() - AGENT_STATE["last_seen"] < 12,
                    "last_seen": int(AGENT_STATE["last_seen"]),
                    "uploaded_rows": len(AGENT_STATE["rows"]),
                    "current_location": AGENT_STATE["current_location"],
                }
            body = json.dumps({"updated": int(time.time()), "count": len(data),
                               "status": STATUS, "agent": agent_status,
                               "mushrooms": data}, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers(); self.wfile.write(body)
        elif u.path == "/api/agent/command":
            if not self._agent_authorized():
                self._send_bytes(401, b"unauthorized\n")
                return
            try:
                since = int(parse_qs(u.query).get("since", ["0"])[0])
            except ValueError:
                since = 0
            with AGENT_COND:
                AGENT_STATE["last_seen"] = time.time()
                command = AGENT_STATE["command"]
                AGENT_COND.notify_all()
                if since > AGENT_STATE["seq"]:
                    line = "0\treset\n"
                elif command and command[0] > since:
                    line = "\t".join(str(x) for x in command) + "\n"
                else:
                    line = f"{max(since, AGENT_STATE['ack_seq'])}\twait\n"
            self._send_bytes(200, line.encode())
        else:
            self.send_error(404)

    def do_POST(self):
        u = urlparse(self.path)
        if u.path not in ("/api/agent/ack", "/api/agent/upload"):
            self.send_error(404)
            return
        if not self._agent_authorized():
            self._send_bytes(401, b"unauthorized\n")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length < 0 or length > 2_000_000:
            self._send_bytes(413, b"payload too large\n")
            return
        body = self.rfile.read(length)
        if u.path == "/api/agent/ack":
            q = parse_qs(u.query)
            try:
                seq = int(q.get("seq", ["0"])[0])
            except ValueError:
                seq = 0
            ok = q.get("ok", ["0"])[0] == "1"
            message = q.get("message", [""])[0]
            lat = q.get("lat", [""])[0]
            lng = q.get("lng", [""])[0]
            if lat and lng:
                message = f"{lat},{lng}"
            with AGENT_COND:
                AGENT_STATE["last_seen"] = time.time()
                if seq >= AGENT_STATE["ack_seq"]:
                    AGENT_STATE["ack_seq"] = seq
                    AGENT_STATE["ack_ok"] = ok
                    AGENT_STATE["ack_message"] = message
                    if lat and lng:
                        try:
                            AGENT_STATE["current_location"] = [float(lat), float(lng)]
                        except ValueError:
                            pass
                AGENT_COND.notify_all()
            self._send_bytes(200, b"ok\n")
            return
        with AGENT_COND:
            AGENT_STATE["last_seen"] = time.time()
            data = AGENT_STATE["partial"] + body
            cut = data.rfind(b"\n")
            if cut >= 0:
                complete, AGENT_STATE["partial"] = data[:cut + 1], data[cut + 1:]
                rows = parse_tsv_text(complete.decode("utf-8", errors="replace"))
                AGENT_STATE["rows"].extend(rows)
            else:
                rows = []
                AGENT_STATE["partial"] = data
            AGENT_STATE["uploaded_bytes"] += len(body)
            AGENT_COND.notify_all()
        self._send_bytes(200, f"accepted={len(rows)}\n".encode())

    def _send_file(self, path, ctype):
        try:
            with open(path, "rb") as f: body = f.read()
            self.send_response(200); self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body))); self.end_headers()
            self.wfile.write(body)
        except OSError:
            self.send_error(404)
    def log_message(self, *a): pass

class ReusableThreadingTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

def serve():
    with ReusableThreadingTCPServer(("0.0.0.0", PORT), Handler) as httpd:
        print(f"[web] http://localhost:{PORT}/")
        httpd.serve_forever()

def parse_args():
    p = argparse.ArgumentParser(description="Pikmin 蘑菇雷達掃描器")
    p.add_argument("--grid-step-m", type=float, default=GRID_STEP_M)
    p.add_argument("--dwell-s", type=float, default=DWELL_S)
    p.add_argument("--hop-delay-s", type=float, default=HOP_DELAY_S)
    p.add_argument("--once", action="store_true", help="掃完一輪後停止")
    p.add_argument("--start-index", type=int, default=START_INDEX,
                   help="從第幾個網格索引開始（0-based）")
    p.add_argument("--max-points", type=int, default=MAX_POINTS,
                   help="本輪最多掃幾點（校準用）")
    p.add_argument("--port", type=int, default=PORT)
    p.add_argument("--lat-min", type=float, default=REGION["lat_min"])
    p.add_argument("--lat-max", type=float, default=REGION["lat_max"])
    p.add_argument("--lng-min", type=float, default=REGION["lng_min"])
    p.add_argument("--lng-max", type=float, default=REGION["lng_max"])
    p.add_argument("--regions-json", help="全自動模式的城市 bbox JSON")
    p.add_argument("--inter-region-cooldown-s", type=float, default=INTER_REGION_COOLDOWN_S)
    p.add_argument("--auto-confirm-speed-warning", action="store_true")
    p.add_argument("--optimize-region-order", action="store_true")
    p.add_argument("--resume", action="store_true", help="從相同城市清單的 checkpoint 繼續")
    p.add_argument("--checkpoint-file", default=CHECKPOINT_FILE)
    p.add_argument("--serve-only", action="store_true", help="只提供網頁與 API，不執行掃描")
    p.add_argument("--device-backend", choices=("adb", "agent"), default=DEVICE_BACKEND,
                   help="手機控制後端：adb 或免 ADB 的手機 Agent")
    p.add_argument("--agent-token-file", default=AGENT_TOKEN_FILE,
                   help="手機 Agent bearer token 檔案")
    p.add_argument("--controller-token-file", default=CONTROLLER_TOKEN_FILE,
                   help="雲端 controller 專用 bearer token 檔案（不可與 Agent token 共用）")
    p.add_argument("--cloud-api-url", default=CLOUD_API_URL,
                   help="Codex Sites 雲端中樞網址；空白時維持本機 Agent 模式")
    return p.parse_args()

if __name__ == "__main__":
    args = parse_args()
    GRID_STEP_M = args.grid_step_m
    DWELL_S = args.dwell_s
    HOP_DELAY_S = args.hop_delay_s
    LOOP_FOREVER = not args.once
    START_INDEX = max(0, args.start_index)
    MAX_POINTS = args.max_points
    REGION = dict(lat_min=args.lat_min, lat_max=args.lat_max,
                  lng_min=args.lng_min, lng_max=args.lng_max)
    REGIONS = json.loads(args.regions_json) if args.regions_json else None
    INTER_REGION_COOLDOWN_S = max(0, args.inter_region_cooldown_s)
    AUTO_CONFIRM_SPEED_WARNING = args.auto_confirm_speed_warning
    OPTIMIZE_REGION_ORDER = args.optimize_region_order
    RESUME_CHECKPOINT = args.resume
    CHECKPOINT_FILE = os.path.abspath(args.checkpoint_file)
    DEVICE_BACKEND = args.device_backend
    AGENT_TOKEN_FILE = os.path.abspath(args.agent_token_file)
    AGENT_TOKEN = load_agent_token(AGENT_TOKEN_FILE)
    CLOUD_API_URL = args.cloud_api_url.strip().rstrip("/")
    CONTROLLER_TOKEN_FILE = os.path.abspath(args.controller_token_file)
    CONTROLLER_TOKEN = load_existing_token(
        CONTROLLER_TOKEN_FILE, "Controller") if CLOUD_API_URL else ""
    PORT = args.port
    print(f"[device] backend={DEVICE_BACKEND}" +
          (f" cloud={CLOUD_API_URL}" if CLOUD_API_URL else ""))
    if args.serve_only:
        db_init()
        STATUS["last_msg"] = "網頁服務模式（目前未掃描）"
    else:
        if AUTO_CONFIRM_SPEED_WARNING and DEVICE_BACKEND == "adb":
            threading.Thread(target=auto_confirm_speed_warning_loop, daemon=True).start()
        threading.Thread(target=scan_loop, daemon=True).start()
    serve()
