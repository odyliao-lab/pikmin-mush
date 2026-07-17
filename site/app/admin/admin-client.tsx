"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CITY_CHOICES, COUNTRY_PACK_LABELS } from "../../lib/scan-plans";
import styles from "./admin.module.css";

type Job = {
  id: number;
  status: string;
  config: Record<string, unknown> | null;
  total_points: number;
  current_index: number;
  cycle: number;
  loop: boolean;
  captured_rows: number;
  captured_bytes: number;
  current_country: string;
  current_city: string;
  current_location: [number, number] | null;
  message: string;
  created_at: number;
  updated_at: number;
};

type Dashboard = {
  now: number;
  agent: {
    online: boolean;
    last_seen: number;
    current_location: [number, number] | null;
    uploaded_rows: number;
    uploaded_bytes: number;
  };
  job: Job | null;
  logs: Array<{ id: number; at: number; level: string; message: string }>;
};

const ACTIVE = new Set(["queued", "running", "paused"]);

function statusLabel(status: string) {
  return ({
    queued: "等待手機",
    running: "掃描中",
    paused: "已暫停",
    completed: "已完成",
    cancelled: "已停止",
    error: "發生錯誤",
  } as Record<string, string>)[status] ?? status;
}

function formatTime(value: number) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit", day: "2-digit", hour: "2-digit",
    minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(value));
}

export default function AdminClient({
  displayName,
  signOutPath,
}: {
  displayName: string;
  signOutPath: string;
}) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [mode, setMode] = useState<"auto" | "custom">("auto");
  const [cityIds, setCityIds] = useState<string[]>([]);
  const [packs, setPacks] = useState<string[]>(["日本"]);
  const [radiusKm, setRadiusKm] = useState(2);
  const [gridStepM, setGridStepM] = useState(600);
  const [dwellS, setDwellS] = useState(8);
  const [hopDelayS, setHopDelayS] = useState(2);
  const [cooldownS, setCooldownS] = useState(45);
  const [loop, setLoop] = useState(true);
  const [custom, setCustom] = useState({
    latMin: 25.020, latMax: 25.060, lngMin: 121.500, lngMax: 121.560,
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/scans", { cache: "no-store" });
    if (!response.ok) throw new Error("後台狀態讀取失敗");
    setDashboard(await response.json());
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      refresh().catch((error) => setNotice(String(error)));
    }, 0);
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 3000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const estimate = useMemo(() => {
    const squarePoints = (diameterKm: number) =>
      Math.max(1, Math.floor(diameterKm * 1000 / gridStepM) + 1) ** 2;
    let cities = 0;
    let points = 0;
    if (mode === "custom") {
      cities = 1;
      const latKm = Math.max(0, custom.latMax - custom.latMin) * 111.32;
      const midLat = (custom.latMax + custom.latMin) / 2;
      const lngKm = Math.max(0, custom.lngMax - custom.lngMin) * 111.32 *
        Math.max(0.2, Math.abs(Math.cos(midLat * Math.PI / 180)));
      points = Math.max(1, Math.floor(latKm * 1000 / gridStepM) + 1) *
        Math.max(1, Math.floor(lngKm * 1000 / gridStepM) + 1);
    } else {
      for (const id of cityIds) {
        const city = CITY_CHOICES.find((entry) => entry[0] === id);
        if (!city) continue;
        cities += 1;
        const latKm = (city[4] - city[3]) * 111.32;
        const lngKm = (city[6] - city[5]) * 111.32 *
          Math.abs(Math.cos(((city[3] + city[4]) / 2) * Math.PI / 180));
        points += Math.max(1, Math.floor(latKm * 1000 / gridStepM) + 1) *
          Math.max(1, Math.floor(lngKm * 1000 / gridStepM) + 1);
      }
      for (const pack of packs) {
        const count = COUNTRY_PACK_LABELS.find((item) => item.name === pack)?.count ?? 0;
        cities += count;
        points += count * squarePoints(radiusKm * 2);
      }
    }
    const seconds = points * (dwellS + hopDelayS) + Math.max(0, cities - 1) * cooldownS;
    return { cities, points, hours: seconds / 3600 };
  }, [cityIds, cooldownS, custom, dwellS, gridStepM, hopDelayS, mode, packs, radiusKm]);

  const toggle = (value: string, current: string[], setter: (next: string[]) => void) => {
    setter(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };

  const start = async () => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/scans/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode, cityIds, countryPacks: packs, radiusKm, gridStepM,
          dwellS, hopDelayS, cooldownS, loop, custom,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "建立掃描工作失敗");
      setNotice(`已建立：${result.regions} 城市、${result.points} 點`);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const action = async (name: "pause" | "resume" | "stop") => {
    if (!dashboard?.job) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/scans/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: dashboard.job.id, action: name }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "操作失敗");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const job = dashboard?.job;
  const active = Boolean(job && ACTIVE.has(job.status));
  const progress = job?.total_points
    ? Math.min(100, (job.current_index / job.total_points) * 100) : 0;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>PIKMIN MUSHROOM CONTROL</span>
          <h1>蘑菇掃描後台</h1>
          <p>雲端排程、手機執行，不需要 Windows 持續開機。</p>
        </div>
        <nav>
          <Link href="/">公開地圖</Link>
          <a href={signOutPath}>登出</a>
          <span>{displayName}</span>
        </nav>
      </header>

      <section className={styles.healthGrid}>
        <article className={dashboard?.agent.online ? styles.healthGood : styles.healthBad}>
          <span>手機 Agent</span>
          <strong>{dashboard?.agent.online ? "已連線" : "離線"}</strong>
          <small>最後回報 {formatTime(dashboard?.agent.last_seen ?? 0)}</small>
        </article>
        <article>
          <span>目前工作</span>
          <strong>{job ? statusLabel(job.status) : "尚未建立"}</strong>
          <small>{job?.message ?? "可建立新的掃描工作"}</small>
        </article>
        <article>
          <span>擷取成果</span>
          <strong>{job?.captured_rows ?? 0} 行</strong>
          <small>手機累計上傳 {dashboard?.agent.uploaded_rows ?? 0} 行</small>
        </article>
        <article>
          <span>掃描位置</span>
          <strong>{job?.current_city || "—"}</strong>
          <small>{job?.current_country || "尚未開始"}</small>
        </article>
      </section>

      {job && (
        <section className={styles.progressCard}>
          <div className={styles.progressTop}>
            <div>
              <span>工作 #{job.id}・第 {job.cycle + 1} 輪</span>
              <strong>{job.current_index.toLocaleString()} / {job.total_points.toLocaleString()} 點</strong>
            </div>
            <div className={styles.actions}>
              {job.status === "running" || job.status === "queued"
                ? <button onClick={() => action("pause")} disabled={busy}>暫停</button> : null}
              {job.status === "paused"
                ? <button className={styles.primary} onClick={() => action("resume")} disabled={busy}>繼續</button> : null}
              {active
                ? <button className={styles.danger} onClick={() => action("stop")} disabled={busy}>停止</button> : null}
            </div>
          </div>
          <div className={styles.progressTrack}><i style={{ width: `${progress}%` }} /></div>
        </section>
      )}

      <div className={styles.columns}>
        <section className={styles.panel}>
          <div className={styles.panelTitle}>
            <div><span>NEW SCAN</span><h2>建立掃描工作</h2></div>
            <div className={styles.segment}>
              <button className={mode === "auto" ? styles.selected : ""}
                onClick={() => setMode("auto")}>城市巡迴</button>
              <button className={mode === "custom" ? styles.selected : ""}
                onClick={() => setMode("custom")}>自訂範圍</button>
            </div>
          </div>

          {mode === "auto" ? (
            <>
              <fieldset>
                <legend>國家城市包（可複選）</legend>
                <div className={styles.choiceGrid}>
                  {COUNTRY_PACK_LABELS.map((pack) => (
                    <label key={pack.name} className={packs.includes(pack.name) ? styles.checked : ""}>
                      <input type="checkbox" checked={packs.includes(pack.name)}
                        onChange={() => toggle(pack.name, packs, setPacks)} />
                      <span>{pack.name}</span><small>{pack.count} 城市</small>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>獨立主要城市（可複選）</legend>
                <div className={styles.cityGrid}>
                  {CITY_CHOICES.map((city) => (
                    <label key={city[0]}>
                      <input type="checkbox" checked={cityIds.includes(city[0])}
                        onChange={() => toggle(city[0], cityIds, setCityIds)} />
                      <span>{city[1]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          ) : (
            <fieldset>
              <legend>GPS 邊界</legend>
              <div className={styles.inputGrid}>
                {([
                  ["latMin", "南界 latitude"], ["latMax", "北界 latitude"],
                  ["lngMin", "西界 longitude"], ["lngMax", "東界 longitude"],
                ] as const).map(([key, label]) => (
                  <label key={key}><span>{label}</span>
                    <input type="number" step="0.000001" value={custom[key]}
                      onChange={(event) => setCustom({ ...custom, [key]: Number(event.target.value) })} />
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend>掃描參數</legend>
            <div className={styles.inputGrid}>
              {mode === "auto" && (
                <label><span>每城中心半徑（km）</span>
                  <input type="number" min="0.5" max="10" step="0.5"
                    value={radiusKm} onChange={(event) => setRadiusKm(Number(event.target.value))} />
                </label>
              )}
              <label><span>網格間距（m）</span>
                <input type="number" min="100" max="2000" value={gridStepM}
                  onChange={(event) => setGridStepM(Number(event.target.value))} />
              </label>
              <label><span>每點等待（秒）</span>
                <input type="number" min="3" max="120" value={dwellS}
                  onChange={(event) => setDwellS(Number(event.target.value))} />
              </label>
              <label><span>跳點延遲（秒）</span>
                <input type="number" min="0" max="60" value={hopDelayS}
                  onChange={(event) => setHopDelayS(Number(event.target.value))} />
              </label>
              <label><span>跨城市冷卻（秒）</span>
                <input type="number" min="0" max="300" value={cooldownS}
                  onChange={(event) => setCooldownS(Number(event.target.value))} />
              </label>
            </div>
            <label className={styles.loop}>
              <input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} />
              <span>持續循環（最後一城後回第一城）</span>
            </label>
          </fieldset>

          <div className={styles.estimate}>
            <span>預估</span>
            <strong>{estimate.cities} 城市・約 {estimate.points.toLocaleString()} 點・單輪 {estimate.hours.toFixed(1)} 小時</strong>
          </div>
          {notice && <p className={styles.notice}>{notice}</p>}
          <button className={styles.startButton} disabled={busy || active || !dashboard?.agent.online}
            onClick={start}>
            {active ? "目前已有掃描工作" : dashboard?.agent.online ? "開始雲端掃描" : "等待手機 Agent 上線"}
          </button>
        </section>

        <section className={`${styles.panel} ${styles.logPanel}`}>
          <div className={styles.panelTitle}>
            <div><span>LIVE LOG</span><h2>手機執行紀錄</h2></div>
            <button onClick={() => refresh()} disabled={busy}>重新整理</button>
          </div>
          <div className={styles.logs}>
            {dashboard?.logs.length ? dashboard.logs.map((log) => (
              <div key={log.id} className={styles[log.level] ?? ""}>
                <time>{formatTime(log.at)}</time>
                <p>{log.message}</p>
              </div>
            )) : <p className={styles.empty}>尚無掃描紀錄</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
