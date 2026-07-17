#!/usr/bin/env python3
"""Windows GUI：自訂 bbox 或多城市全自動巡迴掃描。"""
import ctypes, json, math, os, socket, subprocess, sys, threading, time, tkinter as tk, webbrowser
from tkinter import messagebox, ttk

HERE=os.path.dirname(os.path.abspath(__file__)); SCRIPT=os.path.join(HERE,"scanner.py"); proc=None; log_handle=None
GUI_CONFIG_PATH=os.path.join(HERE,"scanner_gui_state.json")
try:
    with open(GUI_CONFIG_PATH,encoding="utf-8") as f:SAVED_GUI=json.load(f)
except (OSError,json.JSONDecodeError):
    SAVED_GUI={}

# Windows PowerShell 5.x 常預設為 cp950；scanner 與 Android 輸出統一使用 UTF-8。
if os.name == "nt":
    try:
        ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        ctypes.windll.kernel32.SetConsoleCP(65001)
    except (AttributeError,OSError):
        pass
for stream in (sys.stdout,sys.stderr):
    if stream is not None and hasattr(stream,"reconfigure"):
        try: stream.reconfigure(encoding="utf-8",errors="backslashreplace")
        except (OSError,ValueError): pass
# 每座城市約 4×6 km，可再由 scanner 的網格間距細分。
CITIES={
 "台北 Taipei":(25.020,25.060,121.500,121.560), "東京 Tokyo":(35.655,35.705,139.720,139.790),
 "首爾 Seoul":(37.545,37.595,126.950,127.020), "香港 Hong Kong":(22.265,22.315,114.145,114.215),
 "新加坡 Singapore":(1.270,1.320,103.825,103.895), "曼谷 Bangkok":(13.725,13.775,100.500,100.570),
 "倫敦 London":(51.485,51.535,-0.155,-0.075), "巴黎 Paris":(48.835,48.885,2.315,2.385),
 "紐約 New York":(40.690,40.740,-74.030,-73.950), "洛杉磯 Los Angeles":(34.025,34.075,-118.280,-118.210),
 "舊金山 San Francisco":(37.750,37.800,-122.450,-122.380), "雪梨 Sydney":(-33.895,-33.845,151.175,151.245),
}
CITY_COUNTRIES={
 "台北 Taipei":"台灣","東京 Tokyo":"日本","首爾 Seoul":"韓國","香港 Hong Kong":"中國",
 "新加坡 Singapore":"新加坡","曼谷 Bangkok":"泰國","倫敦 London":"英國","巴黎 Paris":"法國",
 "紐約 New York":"美國","洛杉磯 Los Angeles":"美國","舊金山 San Francisco":"美國","雪梨 Sydney":"澳洲",
}
JAPAN_CENTERS=[
 ("札幌 Sapporo",43.0618,141.3545),("青森 Aomori",40.8246,140.7406),("盛岡 Morioka",39.7036,141.1527),
 ("仙台 Sendai",38.2682,140.8694),("秋田 Akita",39.7199,140.1025),("山形 Yamagata",38.2404,140.3633),
 ("福島 Fukushima",37.7503,140.4676),("水戶 Mito",36.3418,140.4468),("宇都宮 Utsunomiya",36.5551,139.8828),
 ("前橋 Maebashi",36.3895,139.0634),("埼玉 Saitama",35.8617,139.6455),("千葉 Chiba",35.6073,140.1063),
 ("東京 Tokyo",35.6812,139.7671),("橫濱 Yokohama",35.4437,139.6380),("新潟 Niigata",37.9161,139.0364),
 ("富山 Toyama",36.6953,137.2113),("金澤 Kanazawa",36.5613,136.6562),("福井 Fukui",36.0641,136.2196),
 ("甲府 Kofu",35.6623,138.5684),("長野 Nagano",36.6486,138.1948),("岐阜 Gifu",35.4233,136.7607),
 ("靜岡 Shizuoka",34.9756,138.3828),("名古屋 Nagoya",35.1815,136.9066),("津 Tsu",34.7186,136.5057),
 ("大津 Otsu",35.0179,135.8546),("京都 Kyoto",35.0116,135.7681),("大阪 Osaka",34.6937,135.5023),
 ("神戶 Kobe",34.6901,135.1955),("奈良 Nara",34.6851,135.8048),("和歌山 Wakayama",34.2305,135.1708),
 ("鳥取 Tottori",35.5011,134.2351),("松江 Matsue",35.4681,133.0484),("岡山 Okayama",34.6551,133.9195),
 ("廣島 Hiroshima",34.3853,132.4553),("山口 Yamaguchi",34.1859,131.4714),("德島 Tokushima",34.0703,134.5548),
 ("高松 Takamatsu",34.3428,134.0466),("松山 Matsuyama",33.8392,132.7657),("高知 Kochi",33.5597,133.5311),
 ("福岡 Fukuoka",33.5902,130.4017),("佐賀 Saga",33.2635,130.3009),("長崎 Nagasaki",32.7503,129.8779),
 ("熊本 Kumamoto",32.8031,130.7079),("大分 Oita",33.2396,131.6093),("宮崎 Miyazaki",31.9077,131.4202),
 ("鹿兒島 Kagoshima",31.5966,130.5571),("那霸 Naha",26.2124,127.6809),
]
JAPAN_MAJOR={"札幌 Sapporo","仙台 Sendai","東京 Tokyo","橫濱 Yokohama","新潟 Niigata","金澤 Kanazawa",
             "靜岡 Shizuoka","名古屋 Nagoya","京都 Kyoto","大阪 Osaka","神戶 Kobe","岡山 Okayama",
             "廣島 Hiroshima","高松 Takamatsu","福岡 Fukuoka","熊本 Kumamoto","鹿兒島 Kagoshima","那霸 Naha"}
AUSTRALIA_CENTERS=[
 ("雪梨 Sydney",-33.8688,151.2093),("墨爾本 Melbourne",-37.8136,144.9631),
 ("布里斯本 Brisbane",-27.4698,153.0251),("伯斯 Perth",-31.9523,115.8613),
 ("阿德雷德 Adelaide",-34.9285,138.6007),("坎培拉 Canberra",-35.2809,149.1300),
 ("黃金海岸 Gold Coast",-28.0167,153.4000),("紐卡索 Newcastle",-32.9283,151.7817),
 ("荷巴特 Hobart",-42.8821,147.3272),("達爾文 Darwin",-12.4634,130.8456),
]
NEW_ZEALAND_CENTERS=[
 ("奧克蘭 Auckland",-36.8509,174.7645),("威靈頓 Wellington",-41.2866,174.7756),
 ("基督城 Christchurch",-43.5321,172.6362),("漢密爾頓 Hamilton",-37.7870,175.2793),
 ("陶朗加 Tauranga",-37.6878,176.1651),("但尼丁 Dunedin",-45.8788,170.5028),
 ("北帕默斯頓 Palmerston North",-40.3523,175.6082),("皇后鎮 Queenstown",-45.0312,168.6626),
]
INDIA_CENTERS=[
 ("新德里 New Delhi",28.6139,77.2090),("孟買 Mumbai",19.0760,72.8777),
 ("班加羅爾 Bengaluru",12.9716,77.5946),("欽奈 Chennai",13.0827,80.2707),
 ("加爾各答 Kolkata",22.5726,88.3639),("海得拉巴 Hyderabad",17.3850,78.4867),
 ("艾哈邁達巴德 Ahmedabad",23.0225,72.5714),("浦那 Pune",18.5204,73.8567),
 ("斋浦爾 Jaipur",26.9124,75.7873),("蘇拉特 Surat",21.1702,72.8311),
 ("勒克瑙 Lucknow",26.8467,80.9462),("科欽 Kochi",9.9312,76.2673),
]
BRAZIL_CENTERS=[
 ("聖保羅 Sao Paulo",-23.5505,-46.6333),("里約熱內盧 Rio de Janeiro",-22.9068,-43.1729),
 ("巴西利亞 Brasilia",-15.7939,-47.8828),("薩爾瓦多 Salvador",-12.9777,-38.5016),
 ("福塔雷薩 Fortaleza",-3.7319,-38.5267),("貝洛奧里藏特 Belo Horizonte",-19.9167,-43.9345),
 ("瑪瑙斯 Manaus",-3.1190,-60.0217),("庫里奇巴 Curitiba",-25.4284,-49.2733),
 ("累西腓 Recife",-8.0476,-34.8770),("阿雷格里港 Porto Alegre",-30.0346,-51.2177),
 ("貝倫 Belem",-1.4558,-48.4902),("戈亞尼亞 Goiania",-16.6869,-49.2648),
]
ECUADOR_CENTERS=[
 ("基多 Quito",-0.1807,-78.4678),("瓜亞基爾 Guayaquil",-2.1710,-79.9224),
 ("昆卡 Cuenca",-2.9001,-79.0059),("聖多明各 Santo Domingo",-0.2530,-79.1754),
 ("曼塔 Manta",-0.9677,-80.7089),("洛哈 Loja",-3.9931,-79.2042),
]
ARGENTINA_CENTERS=[
 ("布宜諾斯艾利斯 Buenos Aires",-34.6037,-58.3816),("科爾多瓦 Cordoba",-31.4201,-64.1888),
 ("羅薩里奧 Rosario",-32.9442,-60.6505),("門多薩 Mendoza",-32.8895,-68.8458),
 ("拉普拉塔 La Plata",-34.9215,-57.9545),("圖庫曼 Tucuman",-26.8083,-65.2176),
 ("馬德普拉塔 Mar del Plata",-38.0055,-57.5426),("薩爾塔 Salta",-24.7821,-65.4232),
 ("聖菲 Santa Fe",-31.6333,-60.7000),("內烏肯 Neuquen",-38.9516,-68.0591),
]
COUNTRY_PACKS={
 "日本":[x for x in JAPAN_CENTERS if x[0] in JAPAN_MAJOR],
 "澳洲":AUSTRALIA_CENTERS,"紐西蘭":NEW_ZEALAND_CENTERS,"印度":INDIA_CENTERS,
 "巴西":BRAZIL_CENTERS,"厄瓜多":ECUADOR_CENTERS,"阿根廷":ARGENTINA_CENTERS,
}

def center_region(name, lat, lng, radius_km, country=""):
    dlat=radius_km/111.32; dlng=radius_km/(111.32*max(.2,abs(math.cos(math.radians(lat)))))
    return dict(name=name,country=country,lat_min=lat-dlat,lat_max=lat+dlat,lng_min=lng-dlng,lng_max=lng+dlng)
def val(name):
    try:return float(entries[name].get())
    except ValueError:raise ValueError(f"{name} 必須是數字")
def selected_regions():
    out=[]
    for name,var in city_vars.items():
        if var.get():
            a,b,c,d=CITIES[name];out.append(dict(name=name,country=CITY_COUNTRIES.get(name,""),lat_min=a,lat_max=b,lng_min=c,lng_max=d))
    selected_packs=[country for country,var in country_pack_vars.items() if var.get()]
    if selected_packs:
        try: radius=max(.5,float(pack_radius.get()))
        except ValueError: raise ValueError("城市包半徑必須是數字")
    for country in selected_packs:
        out.extend(center_region(name,lat,lng,radius,country)
                   for name,lat,lng in reversed(COUNTRY_PACKS[country]))
    # 同名城市只保留城市包版本，避免東京等重複掃描。
    unique={(r.get("country",""),r["name"]):r for r in out}
    return list(unique.values())
def stop_existing_scanners():
    """GUI 接管前停止舊的 scanner.py，避免 8787 埠衝突。"""
    if os.name != "nt": return
    ps=("Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '(^|[\\\\/ ])scanner\\.py( |$)' } "
        "| Select-Object -ExpandProperty ProcessId")
    try:
        out=subprocess.run(["powershell","-NoProfile","-Command",ps],capture_output=True,text=True,
                           encoding="utf-8",errors="replace",timeout=10)
        for line in out.stdout.splitlines():
            if line.strip().isdigit() and int(line) != os.getpid():
                subprocess.run(["taskkill","/PID",line.strip(),"/T","/F"],capture_output=True,timeout=10)
    except (OSError,subprocess.SubprocessError): pass
    deadline=time.time()+8
    while time.time()<deadline:
        s=socket.socket();s.settimeout(.3)
        try:s.connect(("127.0.0.1",8787))
        except OSError:s.close();return
        s.close();time.sleep(.25)
def check_started():
    if proc and proc.poll() is not None:
        try:
            with open(os.path.join(HERE,"scanner_gui.log"),encoding="utf-8",errors="replace") as f:tail="".join(f.readlines()[-8:])
        except OSError:tail=""
        status.set(f"scanner 已退出（code {proc.returncode}）")
        messagebox.showerror("scanner 啟動失敗",tail or f"程式退出碼：{proc.returncode}")
def pump_scanner_log(child, sink):
    """scanner 輸出同時送到 PowerShell 與 scanner_gui.log。"""
    try:
        for line in child.stdout:
            if sys.stdout is not None:
                sys.stdout.write(line); sys.stdout.flush()
            sink.write(line); sink.flush()
    except (OSError,ValueError):
        pass
    finally:
        try: sink.close()
        except (OSError,ValueError): pass
def save_gui_config():
    data={
        "auto_mode":auto_mode.get(),"cities":[k for k,v in city_vars.items() if v.get()],
        "country_packs":[k for k,v in country_pack_vars.items() if v.get()],
        "pack_radius":pack_radius.get(),"entries":{k:v.get() for k,v in entries.items()},
        "loop_scan":loop_scan.get(),"resume_scan":resume_scan.get(),
        "device_backend":device_backend.get(),
    }
    try:
        with open(GUI_CONFIG_PATH,"w",encoding="utf-8") as f:
            json.dump(data,f,ensure_ascii=False,indent=2)
    except OSError:
        pass
def start():
    global proc,log_handle
    if proc and proc.poll() is None: status.set(f"掃描器執行中（PID {proc.pid}）");return
    try:
        args=[sys.executable,"-u",SCRIPT,"--device-backend",device_backend.get(),
              "--grid-step-m",str(val("grid")),"--dwell-s",str(val("dwell")),
              "--hop-delay-s",str(val("delay"))]
        if auto_mode.get():
            regions=selected_regions()
            if not regions: raise ValueError("全自動模式至少要選擇一座城市")
            args += ["--regions-json",json.dumps(regions,ensure_ascii=False),"--inter-region-cooldown-s",str(val("cooldown")),
                     "--auto-confirm-speed-warning","--optimize-region-order"]
            if resume_scan.get(): args += ["--resume","--checkpoint-file",os.path.join(HERE,"scan_checkpoint.json")]
        else:
            args += ["--lat-min",str(val("lat_min")),"--lat-max",str(val("lat_max")),"--lng-min",str(val("lng_min")),"--lng-max",str(val("lng_max"))]
        if not loop_scan.get():args.append("--once")
        save_gui_config()
        stop_existing_scanners()
        log_handle=open(os.path.join(HERE,"scanner_gui.log"),"w",encoding="utf-8-sig")
        child_env=os.environ.copy(); child_env["PYTHONIOENCODING"]="utf-8"; child_env["PYTHONUTF8"]="1"
        proc=subprocess.Popen(args,cwd=HERE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
                              text=True,encoding="utf-8",errors="replace",bufsize=1,
                              env=child_env,
                              creationflags=getattr(subprocess,"CREATE_NEW_PROCESS_GROUP",0))
        threading.Thread(target=pump_scanner_log,args=(proc,log_handle),daemon=True).start()
        backend_label="手機 Agent" if device_backend.get()=="agent" else "ADB"
        status.set(f"已啟動（PID {proc.pid}）・{backend_label}・"+
                   (f"巡迴 {len(selected_regions())} 城市" if auto_mode.get() else "自訂範圍"))
        root.after(1500,check_started)
    except (ValueError,OSError) as e:messagebox.showerror("啟動失敗",str(e));status.set("啟動失敗")
def stop():
    global proc
    if proc and proc.poll() is None:proc.terminate();status.set("已送出停止指令")
    else:status.set("目前沒有由此面板啟動的掃描器")
def toggle_mode():
    state="disabled" if auto_mode.get() else "normal"
    for key in ("lat_min","lat_max","lng_min","lng_max"):entries[key].configure(state=state)
    update_estimate()
def select_all(value):
    for v in city_vars.values():v.set(value)
    update_estimate()
def pack_changed(*_):
    if any(v.get() for v in country_pack_vars.values()):
        for v in city_vars.values(): v.set(False)
        auto_mode.set(True); resume_scan.set(True)
        # 城市包套用不漏掃但較實用的預設；使用者仍可自行覆寫。
        if entries.get("grid") and entries["grid"].get() == "500":
            entries["grid"].delete(0,"end"); entries["grid"].insert(0,"600")
        try: cooldown_now=float(entries["cooldown"].get())
        except (KeyError,ValueError): cooldown_now=0
        if entries.get("cooldown") and cooldown_now < 45:
            entries["cooldown"].delete(0,"end"); entries["cooldown"].insert(0,"45")
    toggle_mode()
def update_estimate(*_):
    try:
        regions=selected_regions() if auto_mode.get() else [dict(name="自訂",lat_min=val("lat_min"),lat_max=val("lat_max"),lng_min=val("lng_min"),lng_max=val("lng_max"))]
        step=max(50,val("grid")); seconds=0; points=0
        for r in regions:
            latc=(r["lat_min"]+r["lat_max"])/2; rows=max(1,int((r["lat_max"]-r["lat_min"])*111320/step)+1); cols=max(1,int((r["lng_max"]-r["lng_min"])*111320*math.cos(math.radians(latc))/step)+1);points+=rows*cols
        seconds=points*(val("dwell")+val("delay"))+max(0,len(regions)-1)*val("cooldown")
        mode="・持續循環" if loop_scan.get() else "・單輪停止"
        estimate_text.set(f"預估：{len(regions)} 城市・{points:,} 點・單輪約 {seconds/3600:.1f} 小時{mode}")
    except (ValueError,tk.TclError): estimate_text.set("預估：請確認參數")

root=tk.Tk();root.title("Pikmin 蘑菇雷達控制面板");root.geometry("620x900");root.resizable(False,False)
ttk.Label(root,text="🍄 Pikmin 蘑菇雷達",font=("Segoe UI",16,"bold")).pack(pady=(12,2))
auto_mode=tk.BooleanVar(value=bool(SAVED_GUI.get("auto_mode",False)));ttk.Checkbutton(root,text="全自動世界城市巡迴模式",variable=auto_mode,command=toggle_mode).pack(anchor="w",padx=22,pady=5)
city_box=ttk.LabelFrame(root,text="主要城市（可複選）",padding=8);city_box.pack(fill="x",padx=18)
city_vars={}
for i,name in enumerate(CITIES):
    saved_cities=SAVED_GUI.get("cities")
    v=tk.BooleanVar(value=(name in saved_cities if isinstance(saved_cities,list) else name.startswith("台北")));city_vars[name]=v
    ttk.Checkbutton(city_box,text=name,variable=v,command=update_estimate).grid(row=i//3,column=i%3,sticky="w",padx=6,pady=2)
city_buttons=ttk.Frame(city_box);city_buttons.grid(row=4,column=0,columnspan=3,sticky="e")
ttk.Button(city_buttons,text="全選",command=lambda:select_all(True)).pack(side="left",padx=3);ttk.Button(city_buttons,text="清除",command=lambda:select_all(False)).pack(side="left")
country_box=ttk.LabelFrame(root,text="國家城市包（可組合）",padding=8);country_box.pack(fill="x",padx=18,pady=(8,0))
pack_radius=tk.StringVar(value=str(SAVED_GUI.get("pack_radius","2.0")))
saved_packs=SAVED_GUI.get("country_packs",[])
country_pack_vars={country:tk.BooleanVar(value=country in saved_packs) for country in COUNTRY_PACKS}
pack_labels={"日本":"日本主要都市（18）","澳洲":"澳洲（10）","紐西蘭":"紐西蘭（8）","印度":"印度（12）","巴西":"巴西（12）","厄瓜多":"厄瓜多（6）","阿根廷":"阿根廷（10）"}
for i,country in enumerate(COUNTRY_PACKS):
    ttk.Checkbutton(country_box,text=pack_labels[country],variable=country_pack_vars[country],command=pack_changed).grid(row=i//3,column=i%3,sticky="w",padx=8,pady=3)
ttk.Label(country_box,text="每城中心半徑（km）").grid(row=3,column=0,sticky="w",padx=8,pady=4);radius_entry=ttk.Entry(country_box,textvariable=pack_radius,width=10);radius_entry.grid(row=3,column=1,sticky="w",padx=8);radius_entry.bind("<KeyRelease>",update_estimate)
ttk.Label(country_box,text="可複選國家；日本固定使用主要都市。巡迴順序會自動最佳化。",foreground="#555").grid(row=4,column=0,columnspan=3,sticky="w",padx=8)
box=ttk.LabelFrame(root,text="自訂 GPS 範圍（非全自動模式）",padding=8);box.pack(fill="x",padx=18,pady=9)
entries={};saved_entries=SAVED_GUI.get("entries",{});defaults={"lat_min":"25.020","lat_max":"25.060","lng_min":"121.500","lng_max":"121.560"}
for i,(key,label) in enumerate((("lat_min","南界 latitude"),("lat_max","北界 latitude"),("lng_min","西界 longitude"),("lng_max","東界 longitude"))):
    ttk.Label(box,text=label,width=18).grid(row=i//2,column=(i%2)*2,sticky="w",padx=4,pady=3);e=ttk.Entry(box,width=15);e.insert(0,saved_entries.get(key,defaults[key]));e.grid(row=i//2,column=(i%2)*2+1,padx=4);entries[key]=e
opts=ttk.LabelFrame(root,text="掃描參數",padding=8);opts.pack(fill="x",padx=18)
for i,(key,label,default) in enumerate((("grid","網格間距（公尺）","500"),("dwell","每點等待（秒）","5"),("delay","跳點延遲（秒）","3"),("cooldown","跨城市冷卻（秒）","30"))):
    ttk.Label(opts,text=label,width=18).grid(row=i,column=0,sticky="w",pady=3);e=ttk.Entry(opts,width=16);e.insert(0,saved_entries.get(key,default));e.grid(row=i,column=1,sticky="w");entries[key]=e
ttk.Label(opts,text="全自動模式會偵測『速度太快』提示並自動按確定。",foreground="#555").grid(row=4,column=0,columnspan=2,sticky="w",pady=(6,0))
loop_scan=tk.BooleanVar(value=bool(SAVED_GUI.get("loop_scan",True)));resume_scan=tk.BooleanVar(value=bool(SAVED_GUI.get("resume_scan",True)))
device_backend=tk.StringVar(value=SAVED_GUI.get("device_backend","agent"))
flags=ttk.LabelFrame(root,text="執行模式",padding=6);flags.pack(fill="x",padx=18,pady=6)
ttk.Radiobutton(flags,text="手機 Agent（免 ADB）",variable=device_backend,value="agent").grid(row=0,column=0,sticky="w",padx=4)
ttk.Radiobutton(flags,text="ADB 相容模式",variable=device_backend,value="adb").grid(row=0,column=1,sticky="w",padx=14)
ttk.Checkbutton(flags,text="持續循環（最後一城後回第一城）",variable=loop_scan,command=update_estimate).grid(row=1,column=0,sticky="w",padx=4,pady=(5,0))
ttk.Checkbutton(flags,text="從上次城市進度繼續",variable=resume_scan).grid(row=1,column=1,sticky="w",padx=14,pady=(5,0))
estimate_text=tk.StringVar(value="預估：—");ttk.Label(root,textvariable=estimate_text,foreground="#7a4b10",font=("Segoe UI",10,"bold")).pack(anchor="w",padx=25)
buttons=ttk.Frame(root);buttons.pack(pady=10);ttk.Button(buttons,text="開始掃描",command=start).grid(row=0,column=0,padx=5);ttk.Button(buttons,text="停止掃描",command=stop).grid(row=0,column=1,padx=5);ttk.Button(buttons,text="開啟地圖",command=lambda:webbrowser.open("http://localhost:8787/")).grid(row=0,column=2,padx=5)
status=tk.StringVar(value="尚未啟動");ttk.Label(root,textvariable=status,foreground="#365a7a").pack(pady=4)
ttk.Label(root,text="遊戲仍需保持在地圖前景。跨城市跳躍可能觸發伺服器冷卻；自動確認只處理含速度警告文字的對話框。",wraplength=570).pack(padx=20,pady=5)
for e in entries.values(): e.bind("<KeyRelease>",update_estimate)
root.after(100,update_estimate)
root.mainloop()
