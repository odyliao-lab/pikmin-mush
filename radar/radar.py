#!/usr/bin/env python3
"""
Pikmin Bloom 蘑菇雷達 — 主機端收集器 + 地圖伺服器
--------------------------------------------------
搭配 Zygisk 模組 zygisk_pikmin_hunter：模組在遊戲內 hook RegisterMapObject，
把蘑菇(id/lat/lng/cluster/cooldown)寫到裝置的 mushrooms.tsv。
本工具持續拉取該檔、用 id 去重、累積成主資料，並開一個網頁地圖即時標點。

用法:  python radar.py
然後瀏覽器開:  http://localhost:8321/radar.html
移動手機 joystick 逛地圖 → 蘑菇會自動被標到地圖上。
"""
import subprocess, json, time, os, threading, http.server, socketserver, sys

ADB = r"C:\Program Files\Netease\MuMuPlayer\nx_main\adb.exe"
DEV_FILE = "/data/user/0/com.nianticlabs.pikmin/files/mushrooms.tsv"
HERE = os.path.dirname(os.path.abspath(__file__))
JSON_PATH = os.path.join(HERE, "mushrooms.json")
MASTER_PATH = os.path.join(HERE, "mushrooms_master.tsv")
PORT = 8321
POLL_SEC = 4

seen = {}   # id -> {id, lat, lng, ts, cluster, cooldown, first_seen, last_seen}

def load_master():
    if os.path.exists(MASTER_PATH):
        with open(MASTER_PATH, encoding="utf-8") as f:
            for line in f:
                p = line.rstrip("\n").split("\t")
                if len(p) >= 4 and p[1]:
                    g = lambda i: int(p[i]) if len(p) > i and p[i].lstrip("-").isdigit() else 0
                    seen[p[1]] = {
                        "id": p[1], "lat": float(p[2]), "lng": float(p[3]),
                        "cluster": p[4] if len(p) > 4 else "",
                        "cooldown": g(5), "level": g(6), "type": g(7), "finish": g(8),
                        "first_seen": g(0), "last_seen": g(0),
                    }
    print(f"[radar] 載入既有主資料 {len(seen)} 個蘑菇")

def pull_device():
    try:
        r = subprocess.run([ADB, "shell", f"su -c 'cat {DEV_FILE} 2>/dev/null'"],
                           capture_output=True, text=True, timeout=15)
        return r.stdout
    except Exception as e:
        print("[radar] adb 讀取失敗:", e)
        return ""

def merge(text):
    added = 0
    now = int(time.time())
    for line in text.splitlines():
        p = line.rstrip("\r").split("\t")
        if len(p) < 4 or not p[1]:
            continue
        mid = p[1]
        try:
            lat, lng = float(p[2]), float(p[3])
        except ValueError:
            continue
        def gi(i):
            return int(p[i]) if len(p) > i and p[i].lstrip("-").isdigit() else 0
        cluster = p[4] if len(p) > 4 else ""
        cooldown = gi(5); level = gi(6); ctype = gi(7); finish = gi(8)
        ts = int(p[0]) if p[0].isdigit() else now
        if mid not in seen:
            seen[mid] = {"id": mid, "lat": lat, "lng": lng, "cluster": cluster,
                         "cooldown": cooldown, "level": level, "type": ctype, "finish": finish,
                         "first_seen": ts, "last_seen": ts}
            added += 1
        else:
            seen[mid]["last_seen"] = max(seen[mid]["last_seen"], ts)
            seen[mid].update(cooldown=cooldown, level=level, type=ctype, finish=finish)
    return added

def write_outputs():
    data = list(seen.values())
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump({"updated": int(time.time()), "count": len(data), "mushrooms": data},
                  f, ensure_ascii=False)
    with open(MASTER_PATH, "w", encoding="utf-8") as f:
        for m in data:
            f.write(f'{m["last_seen"]}\t{m["id"]}\t{m["lat"]:.7f}\t{m["lng"]:.7f}\t{m["cluster"]}'
                    f'\t{m["cooldown"]}\t{m.get("level",0)}\t{m.get("type",0)}\t{m.get("finish",0)}\n')

def collector():
    load_master()
    write_outputs()
    while True:
        text = pull_device()
        added = merge(text) if text else 0
        write_outputs()
        if added:
            print(f"[radar] +{added} 新蘑菇，總計 {len(seen)}")
        time.sleep(POLL_SEC)

def serve():
    os.chdir(HERE)
    handler = http.server.SimpleHTTPRequestHandler
    with socketserver.TCPServer(("0.0.0.0", PORT), handler) as httpd:
        print(f"[radar] 地圖伺服器: http://localhost:{PORT}/radar.html")
        httpd.serve_forever()

if __name__ == "__main__":
    threading.Thread(target=collector, daemon=True).start()
    serve()
