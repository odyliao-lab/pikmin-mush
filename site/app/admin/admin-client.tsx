"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ReportAudit from './report-audit';
import {useVisiblePolling} from './use-visible-polling';
import {ADMIN_PAGES, agentState, needsAttention, ageLabel} from '../../lib/admin-view.mjs';
import { COUNTRY_PACK_LABELS } from "../../lib/scan-plans";
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

type Agent = {
  id: string;
  name: string;
  enabled: boolean;
  paused: boolean;
  online: boolean;
  last_seen: number;
  current_location: [number, number] | null;
  current_job_id: number | null;
  current_target_id: number | null;
  current_country?: string;
  current_city?: string;
  uploaded_rows: number;
  uploaded_bytes: number;
  region_tags: string[];
  version: string;
  game_version: string;
  module_version: string;
  token_rotated_at: number;
  previous_token_expires_at: number;
  health: {
    status: string;
    message: string;
    no_data_streak: number;
    last_data_at: number;
    last_target_at: number;
    compatibility: {
      status: string;
      compatible: boolean;
      reasons: string[];
      required: { agent: string; game: string; module: string };
    };
  };
};

type SoakReport = {
  generated_at: number;
  window_start: number;
  requested_hours: number;
  observed_hours: number;
  complete_window: boolean;
  verdict: "collecting" | "pass" | "warn" | "fail";
  fleet: {
    agents: number;
    online: number;
    critical: number;
    warning: number;
    completed_targets: number;
    failed_targets: number;
    no_data_targets: number;
    expired_leases: number;
    captured_rows: number;
    average_target_ms: number;
  };
  agents: Array<{
    id: string;
    name: string;
    heartbeat_samples: number;
    continuity_percent: number;
    completed_targets: number;
    failed_targets: number;
    no_data_targets: number;
    expired_leases: number;
    captured_rows: number;
    average_target_ms: number;
    health: Agent["health"];
    diagnostics?: {measured_targets:number;average_refresh_ms:number;restarts:number;upload_failures:number;query_only_targets:number} | null;
    observations?: {observed_challenges:number;new_challenges:number} | null;
  }>;
};

type JobEfficiencyReport = {
  generated_at: number;
  job: {
    id: number;
    status: string;
    total_points: number;
    cycle: number;
    loop: boolean;
    created_at: number;
    updated_at: number;
    started_at: number;
    finished_at: number;
  };
  fleet: {
    completed_targets: number;
    failed_targets: number;
    no_data_targets: number;
    captured_rows: number;
    captured_bytes: number;
    elapsed_ms: number;
    points_per_hour: number;
    data_target_percent: number;
    failure_percent: number;
  };
  agents: Array<{
    id: string;
    name: string;
    enabled: boolean;
    completed_targets: number;
    failed_targets: number;
    no_data_targets: number;
    captured_rows: number;
    captured_bytes: number;
    average_target_ms: number;
    first_event_at: number;
    last_event_at: number;
    elapsed_ms: number;
    points_per_hour: number;
    data_target_percent: number;
    failure_percent: number;
  }>;
};

type Dashboard = {
  now: number;
  fleet: {
    total: number;
    online: number;
    uploaded_rows: number;
    uploaded_bytes: number;
  };
  agents: Agent[];
  agent: {
    online: boolean;
    last_seen: number;
    current_location: [number, number] | null;
    uploaded_rows: number;
    uploaded_bytes: number;
  };
  job: Job | null;
  target_counts: Record<string, number>;
  logs: Array<{ id: number; at: number; level: string; message: string }>;
  rotation: {
    enabled: boolean;
    timezone: string;
    schedule_date: string;
    next_switch_at: number;
    status: string;
    job_id: number | null;
    message: string;
    assignments: Array<{
      agentId: string;
      label: string;
      cityCount: number;
      countries: string[];
    }>;
  };
};

type CopyAudit = {
  retention_days: number;
  summary: { rows: number; copies: number; sources: number; mushrooms: number };
  analytics: {
    daily_active_sources: number;
    popular_mushrooms: Array<{ mushroom_id: string; mushroom_lat: number; mushroom_lng: number; mushroom_level: number; mushroom_type: number; copies: number; sources: number }>;
    filter_stats: Array<{ dimension: string; uses: number; sources: number }>;
    map_focus_stats: Array<{ mushroom_id: string; opens: number; sources: number }>;
    api_errors: Array<{ dimension: string; errors: number; sources: number }>;
    anomalous_copy_sources: Array<{ source_hash: string; country: string; asn: number; copies: number; mushrooms: number }>;
  };
  events: Array<{
    id: number; at: number; event_type: "copy_gps" | "copy_info";
    mushroom_id: string; mushroom_lat: number; mushroom_lng: number;
    mushroom_level: number; mushroom_type: number; source_hash: string;
    country: string; asn: number; device_class: string; event_count: number;
  }>;
};

const ACTIVE = new Set(["queued", "running", "paused"]);
const NORDIC_REGION_NAMES = COUNTRY_PACK_LABELS
  .filter((pack) => pack.region === "北歐")
  .map((pack) => pack.name);
const COUNTRY_PACK_GROUPS = [...new Set(COUNTRY_PACK_LABELS.map((pack) => pack.region))]
  .map((region) => ({
    region,
    packs: COUNTRY_PACK_LABELS.filter((pack) => pack.region === region),
  }));

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
    minute: "2-digit", second: "2-digit", hour12: false, timeZone:'Asia/Taipei',
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
  const [page, setPage] = useState('overview');
  const [powerHistory,setPowerHistory] = useState<{key:string;agent_id:string;agent_name:string;paused_at:number;resumed_at:number|null;reason:string}[]|null>(null);
  const [powerError,setPowerError] = useState('');
  const refreshPower=useCallback(async()=>{try{
      const response=await fetch('/api/admin/power-events',{cache:'no-store'});
      if(!response.ok)throw new Error();
      const data=await response.json();
      setPowerHistory(data.pauses);setPowerError(data.truncated?'紀錄較多，僅顯示最近 1,000 筆':'');
    }catch{setPowerError('保護紀錄暫時無法更新，以下可能為舊資料');}
  },[]);
  useVisiblePolling(refreshPower,30_000,page==='overview'||page==='fleet');
  const [showSoak, setShowSoak] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const [showEfficiency, setShowEfficiency] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [overviewMetrics, setOverviewMetrics] = useState<SoakReport|null>(null);
  const [overviewError, setOverviewError] = useState('');
  const [mode, setMode] = useState<"auto" | "custom">("auto");
  const [scanProfile, setScanProfile] = useState<"global" | "precision">("global");
  const [packs, setPacks] = useState<string[]>([]);
  const [radiusKm, setRadiusKm] = useState(8);
  const [gridStepM, setGridStepM] = useState(1000);
  const [dwellS, setDwellS] = useState(8);
  const [hopDelayS, setHopDelayS] = useState(2);
  const [cooldownS, setCooldownS] = useState(10);
  const [loop, setLoop] = useState(true);
  const [custom, setCustom] = useState({
    latMin: 25.020, latMax: 25.060, lngMin: 121.500, lngMax: 121.560,
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentRegions, setAgentRegions] = useState("");
  const [editingAgentId, setEditingAgentId] = useState("");
  const [editingAgentRegions, setEditingAgentRegions] = useState("");
  const [editingAgentNameId, setEditingAgentNameId] = useState("");
  const [editingAgentName, setEditingAgentName] = useState("");
  const [deletingAgentId, setDeletingAgentId] = useState("");
  const [credential, setCredential] = useState<{ id: string; token: string } | null>(null);
  const [soak, setSoak] = useState<SoakReport | null>(null);
  const [jobReport, setJobReport] = useState<JobEfficiencyReport | null>(null);
  const [dashboardError, setDashboardError] = useState("");
  const [dashboardLoadedAt, setDashboardLoadedAt] = useState(0);
  const [soakError, setSoakError] = useState("");
  const [jobReportError, setJobReportError] = useState("");
  const [copyAudit, setCopyAudit] = useState<CopyAudit | null>(null);
  const [copyAuditError, setCopyAuditError] = useState("");
  const changePage=(next:string)=>{setShowSoak(false);setShowUsage(false);setShowEfficiency(false);setShowLogs(false);setPage(next);};
  const dashboardRequest=useRef(0);
  const includeLogs=page==='fleet'&&showLogs;

  const refresh = useCallback(async () => {
    const version=++dashboardRequest.current;
    try {
      const response = await fetch(`/api/admin/scans?logs=${includeLogs?'1':'0'}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data=await response.json();if(version!==dashboardRequest.current)return;
      setDashboard(data);
      setDashboardLoadedAt(Date.now());
      setDashboardError("");
    } catch (error) {
      if(version!==dashboardRequest.current)return;
      setDashboardError(`後台狀態暫時無法更新（${error instanceof Error ? error.message : "連線失敗"}）`);
      throw error;
    }
  }, [includeLogs]);

  const refreshMetrics = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/metrics?hours=24", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setSoak(await response.json());
      setSoakError("");
    } catch (error) {
      setSoakError(`24 小時報表暫時無法更新（${error instanceof Error ? error.message : "連線失敗"}）`);
      throw error;
    }
  }, []);

  const refreshOverview = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/metrics?hours=6', {cache:'no-store'});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      setOverviewMetrics(await response.json());setOverviewError('');
    }catch{setOverviewError('產出暫時無法更新；保留上次資料，不以零筆代替。');}
  },[]);

  const refreshJobReport = useCallback(async (jobId: number) => {
    try {
      const response = await fetch(`/api/admin/scans/report?jobId=${jobId}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setJobReport(await response.json());
      setJobReportError("");
    } catch (error) {
      setJobReportError(`本輪效率報告暫時無法更新（${error instanceof Error ? error.message : "連線失敗"}）`);
    }
  }, []);

  const refreshCopyAudit = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/copy-audit?hours=24&limit=200", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setCopyAudit(await response.json());
      setCopyAuditError("");
    } catch (error) {
      setCopyAuditError(`使用者複製紀錄暫時無法更新（${error instanceof Error ? error.message : "連線失敗"}）`);
    }
  }, []);

  const currentJobId=dashboard?.job?.id;
  const refreshCurrentJob = useCallback(async()=>{
    if(currentJobId)await refreshJobReport(currentJobId);
  },[currentJobId,refreshJobReport]);
  useVisiblePolling(refresh,10_000,page==='overview'||page==='fleet');
  useVisiblePolling(refreshOverview,60_000,page==='overview');
  useVisiblePolling(refreshMetrics,60_000,page==='more'&&showSoak);
  useVisiblePolling(refreshCopyAudit,60_000,page==='more'&&showUsage);
  useVisiblePolling(refreshCurrentJob,30_000,page==='more'&&showEfficiency);

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
      for (const pack of packs) {
        const count = COUNTRY_PACK_LABELS.find((item) => item.name === pack)?.count ?? 0;
        cities += count;
        points += count * squarePoints(radiusKm * 2);
      }
    }
    const seconds = points * (dwellS + hopDelayS) + Math.max(0, cities - 1) * cooldownS;
    return { cities, points, hours: seconds / 3600 };
  }, [cooldownS, custom, dwellS, gridStepM, hopDelayS, mode, packs, radiusKm]);

  const toggle = (value: string, current: string[], setter: (next: string[]) => void) => {
    setter(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };

  const start = async () => {
    if(!window.confirm(`建立 ${estimate.cities} 城市、約 ${estimate.points.toLocaleString()} 點的掃描工作？每日輪替設定不會因此停用。`))return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/scans/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode, scanProfile, countryPacks: packs, radiusKm, gridStepM,
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
    if(!window.confirm(`${name==='stop'?'停止':name==='pause'?'暫停':'恢復'}工作 #${dashboard.job.id}？此操作影響該工作的所有執行節點。`))return;
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

  const redeployFleet = async () => {
    if(!window.confirm('立即重新分配全機隊？目前未完成工作會中止，所有 Agent 重新領取新區域；原定換區時間不變。'))return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/rotation/redeploy", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "重新分配失敗");
      setNotice(`已重新分配：${result.regions} 城市、${result.points} 點；原定換區時間不變`);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const enrollAgent = async () => {
    setBusy(true);
    setNotice("");
    setCredential(null);
    try {
      const response = await fetch("/api/admin/agents/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: agentName,
          regionTags: agentRegions.split(",").map((value) => value.trim()).filter(Boolean),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "建立 Agent 失敗");
      setCredential({ id: result.agent.id, token: result.token });
      setAgentName("");
      setAgentRegions("");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const agentAction = async (agent: Agent, action: "enable" | "disable" | "pause" | "resume" |
    "rotate-token" | "revoke-old-token" | "rename" | "delete", displayName?: string) => {
    if(['pause','disable','enable','resume'].includes(action)&&!window.confirm(`${agent.name}：${({pause:'暫停掃描',disable:'停用節點並釋放工作',enable:'啟用節點',resume:'恢復掃描'} as Record<string,string>)[action]}？`))return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/agents/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agent.id, action, displayName }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Agent 操作失敗");
      if (action === "rotate-token") {
        setCredential({ id: agent.id, token: result.token });
        setNotice(`${agent.name} 已換發 Token；舊 Token 24 小時後失效`);
      } else if (action === "revoke-old-token") {
        setNotice(`${agent.name} 的舊 Token 已立即撤銷`);
      } else if (action === "rename") {
        setEditingAgentNameId("");
        setEditingAgentName("");
        setNotice(`${agent.name} 已重新命名為 ${result.display_name}`);
      } else if (action === "delete") {
        setDeletingAgentId("");
        setNotice(`${agent.name} 已永久自後台移除`);
      }
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const saveAgentRegions = async (agent: Agent) => {
    setBusy(true);
    setNotice("");
    try {
      const regionTags = editingAgentRegions.split(",")
        .map((value) => value.trim()).filter(Boolean);
      const response = await fetch("/api/admin/agents/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agent.id, action: "update-regions", regionTags }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "區域偏好更新失敗");
      setEditingAgentId("");
      setEditingAgentRegions("");
      setNotice(`${agent.name} 已更新為「優先指定國家、其餘任務候補」`);
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
  const soakLabel = soak?.verdict === "pass" ? "通過" : soak?.verdict === "warn" ? "注意" :
    soak?.verdict === "fail" ? "異常" : "收集中";
  const downloadSoak = () => {
    if (!soak) return;
    const blob = new Blob([JSON.stringify(soak, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `pikmin-soak-${new Date(soak.generated_at).toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const downloadJobReport = () => {
    if (!jobReport) return;
    const blob = new Blob([JSON.stringify(jobReport, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `pikmin-job-${jobReport.job.id}-efficiency.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>PIKMIN MUSHROOM CONTROL</span>
          <h1>探險隊後台</h1>
          <p>管理員 · Asia/Taipei</p>
        </div>
        <nav>
          <Link href="/">公開地圖</Link>
          <a href={signOutPath}>登出</a>
          <span>{displayName}</span>
        </nav>
      </header>

      <nav className={styles.appNav} aria-label="後台導覽">
        {ADMIN_PAGES.map(item=><button key={item.id} type="button" aria-pressed={page===item.id}
          onClick={()=>changePage(item.id)}><span aria-hidden="true">{item.icon}</span>{item.label}</button>)}
      </nav>
      <div className={styles.workspace}>
      {notice&&<p className={styles.notice} role="status">{notice}</p>}
      {(page==='overview'||page==='fleet')&&<details className={styles.disclosure}>
        <summary>保護暫停與恢復 · 最近 24 小時{powerHistory?.some(p=>!p.resumed_at)?' · 有尚未回報恢復的裝置':''}</summary>
        {powerError&&<p role="status">{powerError}</p>}
        {powerHistory===null?<p>等待紀錄…</p>:!powerHistory.length?<p>此期間沒有保護暫停紀錄</p>:powerHistory.map(p=><p key={p.key}>
          <strong>{p.agent_name||p.agent_id}</strong> · {p.reason}<br/>
          暫停 {formatTime(p.paused_at)}<br/>
          {p.resumed_at?`解除保護 ${formatTime(p.resumed_at)}`:'尚未收到解除保護回報'}
        </p>)}
        <p className={styles.caption}>時間為台北時間。解除保護表示允許恢復，實際掃描請對照最後上傳；不包含手動暫停。</p>
      </details>}

      {dashboardError && (
        <div className={styles.dataWarning} role="status">
          <strong>{dashboardError}</strong>
          <span>{dashboard
            ? `目前保留最近一次成功結果（${formatTime(dashboardLoadedAt)}）`
            : "尚未取得有效資料，不會以 0 筆或 0 台 Agent 代替"}</span>
        </div>
      )}

      {page==='overview'&&<div className={styles.overview}>
        <div className={styles.overviewHeading}><h2>機隊總覽</h2><button type="button" onClick={()=>{void refresh().catch(()=>{});void refreshOverview();}}>重新整理</button></div>
        <div className={styles.overviewStats}>
          <article><span>裝置在線</span><strong>{dashboard?`${dashboard.fleet.online} / ${dashboard.fleet.total}`:'—'}<small> 台</small></strong></article>
          <article><span>需要留意</span><strong>{dashboard?dashboard.agents.filter(needsAttention).length:'—'}<small> 台</small></strong></article>
        </div>
        {dashboard?.agents.filter(needsAttention).map(agent=><button className={styles.attention} type="button" key={agent.id} onClick={()=>setPage('fleet')}>△ {agent.name}：{agent.health.message} →</button>)}
        <section className={styles.overviewPanel} aria-label="Agent 產出比較">
          <div className={styles.overviewHeading}><h2>觀測到的不同挑戰</h2><span>最近 6 小時</span></div>
          {overviewError&&<p role="status" className={styles.inlineWarning}>{overviewError}</p>}
          {!overviewMetrics?<p>等待觀測資料…</p>:!overviewMetrics.agents.length?<p>尚無 Agent 觀測資料</p>:
            overviewMetrics.agents.map(agent=>{
              const value=agent.observations?.observed_challenges;
              const max=Math.max(1,...overviewMetrics.agents.map(a=>a.observations?.observed_challenges??0));
              return <div className={styles.chartRow} key={agent.id}><span>{agent.name.replace(/^Agent\s+/,'')}</span><div className={styles.chartTrack} aria-hidden="true"><i style={{width:`${value===undefined?0:value/max*100}%`}} /></div><span>{value??'—'}</span></div>;
            })}
          <p className={styles.caption}>各台期間去重；跨台可能重疊。不是上傳行數，也不等同現場新生蘑菇。</p>
          {overviewMetrics&&<p className={styles.caption}>資料窗口 {formatTime(overviewMetrics.window_start)} ～ {formatTime(overviewMetrics.generated_at)}</p>}
        </section>
        <section className={styles.overviewPanel}>
          <div className={styles.overviewHeading}><h2>正在掃描</h2><button type="button" onClick={()=>setPage('fleet')}>查看機隊</button></div>
          {dashboard?.agents.map(agent=><div className={styles.compactAgent} key={agent.id}>
            <div><strong>{agent.name}</strong><span data-attention={needsAttention(agent)}>{powerHistory?.some(p=>p.agent_id===agent.id&&!p.resumed_at)?'保護暫停（尚無恢復回報）':agentState(agent)}</span></div>
            <p>{[agent.current_country,agent.current_city].filter(Boolean).join('－')||'目前城市未回報'} · 上傳 {ageLabel(agent.health.last_data_at,dashboard.now)}</p>
          </div>)}
          {!dashboard&&<p>等待有效的機隊資料…</p>}
        </section>
        <p className={styles.caption}>下次換區 {dashboard?.rotation.enabled?formatTime(dashboard.rotation.next_switch_at):'—'} · 台北時間<br/>狀態更新 {formatTime(dashboardLoadedAt)} · 每 10 秒更新</p>
      </div>}

      {page==='more'&&<details className={styles.disclosure}><summary>系統與輪替摘要</summary><section className={styles.healthGrid}>
        <article className={!dashboard ? styles.healthUnknown :
          dashboard.fleet.online ? styles.healthGood : styles.healthBad}>
          <span>Agent 叢集</span>
          <strong>{dashboard
            ? `${dashboard.fleet.online} / ${dashboard.fleet.total} 在線`
            : "讀取中…"}</strong>
          <small>多節點平行掃描與故障接手</small>
        </article>
        <article>
          <span>目前工作</span>
          <strong>{!dashboard ? "讀取中…" : job ? statusLabel(job.status) : "尚未建立"}</strong>
          <small>{!dashboard ? "等待有效的後台資料" : job?.message ?? "可建立新的掃描工作"}</small>
        </article>
        <article>
          <span>擷取成果</span>
          <strong>{dashboard ? `${job?.captured_rows ?? 0} 行` : "讀取中…"}</strong>
          <small>{dashboard ? `叢集累計上傳 ${dashboard.fleet.uploaded_rows} 行` : "等待有效的後台資料"}</small>
        </article>
        <article>
          <span>工作佇列</span>
          <strong>{dashboard ? `${dashboard.target_counts?.leased ?? 0} 執行中` : "讀取中…"}</strong>
          <small>{dashboard
            ? `${dashboard.target_counts?.queued ?? 0} 待派・${dashboard.target_counts?.completed ?? 0} 完成`
            : "等待有效的後台資料"}</small>
        </article>
        <article>
          <span>每日自動換區</span>
          <strong>{!dashboard ? "讀取中…" : dashboard.rotation.enabled ? "04:00 / 12:00 / 20:00 啟用" : "未啟用"}</strong>
          <small>{dashboard ? `下次換區 ${formatTime(dashboard.rotation.next_switch_at)}・台北時間` : "等待有效的後台資料"}</small>
        </article>
        <article className={soak?.verdict === "pass" ? styles.healthGood :
          soak?.verdict === "fail" ? styles.healthBad : undefined}>
          <span>24 小時 Soak</span>
          <strong>{soakLabel}</strong>
          <small>{soak ? `已觀測 ${soak.observed_hours} 小時・完成 ${soak.fleet.completed_targets} 點` : "讀取中"}</small>
        </article>
      </section></details>}

      {page==='fleet'&&job && (
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
              {active && dashboard?.rotation.enabled
                ? <button className={styles.primary} onClick={redeployFleet} disabled={busy}>立即換區</button> : null}
            </div>
          </div>
          <div className={styles.progressTrack}><i style={{ width: `${progress}%` }} /></div>
        </section>
      )}

      {page==='more'&&<details className={styles.disclosure} onToggle={e=>setShowEfficiency(e.currentTarget.open)}><summary>本輪效率與下載</summary>
      {!jobReport&&<p>展開後載入本輪報告；尚無資料時不推測為零。</p>}
      {jobReport && (
        <section className={styles.metricsPanel}>
          <div className={styles.panelTitle}>
            <div><span>JOB EFFICIENCY</span><h2>本輪 Agent 實際效率報告</h2></div>
            <div className={styles.metricsActions}>
              <button type="button" onClick={() => refreshJobReport(jobReport.job.id)} disabled={busy}>重新整理</button>
              <button type="button" onClick={downloadJobReport}>下載 JSON</button>
            </div>
          </div>
          <p className={styles.reportCaption}>
            工作 #{jobReport.job.id}・{statusLabel(jobReport.job.status)}・
            {jobReport.job.loop ? `累計至第 ${jobReport.job.cycle + 1} 輪` : "單輪結果"}
            。資料以不可覆寫的 Agent 事件紀錄統計；工作結束後仍可查看。
          </p>
          {jobReportError && <p className={styles.inlineWarning}>{jobReportError}；目前保留最近一次成功結果。</p>}
          <div className={styles.metricSummary}>
            <div><span>完成掃描點</span><strong>{jobReport.fleet.completed_targets}</strong></div>
            <div><span>有效資料率</span><strong>{jobReport.fleet.data_target_percent}%</strong></div>
            <div><span>失敗率</span><strong>{jobReport.fleet.failure_percent}%</strong></div>
            <div><span>總擷取行數</span><strong>{jobReport.fleet.captured_rows}</strong></div>
            <div><span>叢集點／小時</span><strong>{jobReport.fleet.points_per_hour}</strong></div>
          </div>
          <div className={styles.metricAgents}>
            {jobReport.agents.map((agent) => (
              <article key={agent.id} data-health={agent.completed_targets ? "healthy" : "collecting"}>
                <div><strong>{agent.name}</strong><span>{agent.enabled ? "agent" : "disabled"}</span></div>
                <p>完成 {agent.completed_targets}・有效資料率 {agent.data_target_percent}%・失敗 {agent.failed_targets}</p>
                <small>無資料 {agent.no_data_targets}・擷取 {agent.captured_rows} 行・{agent.points_per_hour} 點／小時・平均 {Math.round(agent.average_target_ms / 1000)} 秒／點</small>
              </article>
            ))}
          </div>
        </section>
      )}</details>}

      {page==='more'&&<details className={styles.disclosure} onToggle={e=>setShowSoak(e.currentTarget.open)}><summary>24 小時穩定度與診斷</summary><section className={styles.metricsPanel}>
        <div className={styles.panelTitle}>
          <div><span>FLEET OBSERVABILITY</span><h2>24 小時穩定度與無資料偵測</h2></div>
          <div className={styles.metricsActions}>
            <button type="button" onClick={() => refreshMetrics()} disabled={busy}>重新整理</button>
            <button type="button" onClick={downloadSoak} disabled={!soak}>下載 JSON</button>
          </div>
        </div>
        {soakError && <p className={styles.inlineWarning}>{soakError}；目前保留最近一次成功報表。</p>}
        <div className={styles.metricSummary}>
          <div><span>觀測時間</span><strong>{soak ? `${soak.observed_hours} / 24h` : "—"}</strong></div>
          <div><span>完成掃描點</span><strong>{soak?.fleet.completed_targets ?? "—"}</strong></div>
          <div><span>無資料掃描點</span><strong>{soak?.fleet.no_data_targets ?? "—"}</strong></div>
          <div><span>失敗／租約逾時</span><strong>{soak ? `${soak.fleet.failed_targets} / ${soak.fleet.expired_leases}` : "—"}</strong></div>
          <div><span>平均每點</span><strong>{soak ? `${Math.round(soak.fleet.average_target_ms / 1000)} 秒` : "—"}</strong></div>
        </div>
        <div className={styles.metricAgents}>
          {soak?.agents.map((agent) => (
            <article key={agent.id} data-health={agent.health.status}>
              <div><strong>{agent.name}</strong><span>{agent.health.status}</span></div>
              <p>{agent.health.message}</p>
              <small>心跳覆蓋 {agent.continuity_percent}%・完成 {agent.completed_targets}・無資料 {agent.no_data_targets}・失敗 {agent.failed_targets}</small>
              <p>{agent.diagnostics ? `診斷 ${agent.diagnostics.measured_targets} 點・首次刷新平均 ${Math.round(agent.diagnostics.average_refresh_ms/1000)} 秒・復原重啟 ${agent.diagnostics.restarts} 次・上傳失敗 ${agent.diagnostics.upload_failures} 次・僅查詢回應 ${agent.diagnostics.query_only_targets} 點` : '尚未收到新版手機診斷；+0 不代表空點'}</p>
              <small>{agent.observations ? `期間觀測 ${agent.observations.observed_challenges} 個不同挑戰・首次入庫 ${agent.observations.new_challenges} 個（依接收時間，不等同現場新生蘑菇）` : '尚無觀測歷史'}</small>
            </article>
          ))}
        </div>
      </section></details>}

      {page==='fleet'&&<section className={styles.fleetPanel}>
        <div className={styles.panelTitle}>
          <div><span>AGENT FLEET</span><h2>全球掃描節點</h2></div>
          <small>每日 04:00、12:00、20:00（台北）換區。詳細控制預設收合。</small>
        </div>
        <div className={styles.agentGrid}>
          {dashboard?.agents.map((agent) => (
            <details key={agent.id} className={styles.agentDisclosure}>
              <summary><strong>{agent.name}</strong><span data-attention={needsAttention(agent)}>{agentState(agent)}</span><small>{[agent.current_country,agent.current_city].filter(Boolean).join('－')||'目前城市未回報'}</small></summary>
              <div className={styles.agentBody}>
              <code>{agent.id}</code>
              <span>
                {agent.online ? "在線" : "離線"}
                {agent.paused ? "・已暫停掃描" : ""}・最後回報 {formatTime(agent.last_seen)}
              </span>
              <small>
                {agent.paused
                  ? "已暫停：不派工"
                  : agent.current_job_id
                    ? `工作 #${agent.current_job_id}・掃描點 #${agent.current_target_id}`
                    : "目前待命"}
                {agent.version ? `・Agent ${agent.version}` : ""}
              </small>
              <small className={styles.agentHealth} data-health={agent.health.status}>
                {agent.health.message}・遊戲 {agent.game_version || "未回報"}・模組 {agent.module_version || "未回報"}
              </small>
              <p>{dashboard.rotation.enabled
                ? `今日自動分配：${dashboard.rotation.assignments
                    .find((item) => item.agentId === agent.id)?.label ?? "等待排程"}`
                : agent.region_tags.length ? agent.region_tags.join("・") : "全球支援"}</p>
              {editingAgentId === agent.id && (
                <div className={styles.agentRegionEditor}>
                  <label>
                    <span>優先國家（逗號分隔；空白代表全球支援）</span>
                    <input value={editingAgentRegions}
                      onChange={(event) => setEditingAgentRegions(event.target.value)} />
                  </label>
                  <div>
                    <button type="button" disabled={busy}
                      onClick={() => setEditingAgentRegions(NORDIC_REGION_NAMES.join(","))}>
                      套用北歐五國
                    </button>
                    <button type="button" className={styles.agentResume} disabled={busy}
                      onClick={() => saveAgentRegions(agent)}>儲存偏好</button>
                    <button type="button" disabled={busy}
                      onClick={() => setEditingAgentId("")}>取消</button>
                  </div>
                  <small>新設定會在目前掃描點完成後生效，並依左到右順序掃描指定地區。</small>
                </div>
              )}
              {editingAgentNameId === agent.id && (
                <div className={styles.agentRegionEditor}>
                  <label>
                    <span>Agent 名稱</span>
                    <input value={editingAgentName}
                      maxLength={48}
                      onChange={(event) => setEditingAgentName(event.target.value)} />
                  </label>
                  <div>
                    <button type="button" className={styles.agentResume} disabled={busy || !editingAgentName.trim()}
                      onClick={() => agentAction(agent, "rename", editingAgentName.trim())}>儲存名稱</button>
                    <button type="button" disabled={busy}
                      onClick={() => { setEditingAgentNameId(""); setEditingAgentName(""); }}>取消</button>
                  </div>
                </div>
              )}
              <div className={styles.agentActions}>
                {!dashboard.rotation.enabled && (
                  <button className={styles.agentToggle} disabled={busy}
                    onClick={() => {
                      setEditingAgentId(editingAgentId === agent.id ? "" : agent.id);
                      setEditingAgentRegions(agent.region_tags.join(","));
                    }}>
                    {editingAgentId === agent.id ? "關閉區域設定" : "修改區域"}
                  </button>
                )}
                {agent.enabled
                  ? <button
                      className={`${styles.agentToggle} ${agent.paused ? styles.agentResume : ""}`}
                      disabled={busy}
                      onClick={() => agentAction(agent, agent.paused ? "resume" : "pause")}>
                      {agent.paused ? "繼續掃描" : "暫停掃描"}
                    </button>
                  : null}
                <button className={styles.agentToggle} disabled={busy}
                  onClick={() => agentAction(agent, agent.enabled ? "disable" : "enable")}>
                  {agent.enabled ? "停用節點" : "啟用節點"}
                </button>
                <button className={styles.agentToggle} disabled={busy}
                  onClick={() => {
                    setEditingAgentNameId(editingAgentNameId === agent.id ? "" : agent.id);
                    setEditingAgentName(agent.name);
                  }}>
                  {editingAgentNameId === agent.id ? "關閉改名" : "重新命名"}
                </button>
                <button className={styles.agentToggle} disabled={busy}
                  onClick={() => window.confirm(`確定換發 ${agent.name} 的 Token？舊 Token 會保留 24 小時。`) &&
                    agentAction(agent, "rotate-token")}>
                  換發 Token
                </button>
                {agent.previous_token_expires_at > (dashboard?.now ?? 0) && (
                  <button className={`${styles.agentToggle} ${styles.agentDanger}`} disabled={busy}
                    onClick={() => window.confirm(`確定立即撤銷 ${agent.name} 的舊 Token？`) &&
                      agentAction(agent, "revoke-old-token")}>
                    撤銷舊 Token
                  </button>
                )}
                {!agent.enabled && agent.id !== "primary" && (
                  deletingAgentId === agent.id ? (
                    <button className={`${styles.agentToggle} ${styles.agentDanger}`} disabled={busy}
                      onClick={() => agentAction(agent, "delete")}>
                      確認永久刪除
                    </button>
                  ) : (
                    <button className={`${styles.agentToggle} ${styles.agentDanger}`} disabled={busy}
                      onClick={() => setDeletingAgentId(agent.id)}>
                      永久刪除
                    </button>
                  )
                )}
              </div>
              </div>
            </details>
          ))}
          {!dashboard && <p className={styles.empty}>Agent 資料讀取中，不顯示推測結果</p>}
          {dashboard && !dashboard.agents.length && <p className={styles.empty}>尚未建立 Agent</p>}
        </div>
        <details className={styles.disclosure}><summary>建立新 Agent 憑證</summary><div className={styles.enroll}>
          <label><span>新節點名稱</span>
            <input value={agentName} placeholder="例如：歐洲 Agent 01"
              onChange={(event) => setAgentName(event.target.value)} />
          </label>
          <label><span>優先國家（逗號分隔）</span>
            <input value={agentRegions} placeholder="法國,德國,荷蘭"
              onChange={(event) => setAgentRegions(event.target.value)} />
          </label>
          <button onClick={enrollAgent} disabled={busy || agentName.trim().length < 2}>
            建立 Agent 憑證
          </button>
        </div></details>
        {credential && (
          <div className={styles.credential}>
            <strong>請立即保存，Token 關閉頁面後不會再次顯示</strong>
            <code>{`AGENT_ID='${credential.id}'\nTOKEN='${credential.token}'`}</code>
          </div>
        )}
      </section>}

      <div className={styles.columns}>
        {page==='fleet'&&<details className={styles.disclosure}><summary>建立掃描工作</summary><section className={styles.panel}>
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
                <details className={styles.packDisclosure}>
                  <summary>
                    <span>
                      <strong>選擇國家與地區</strong>
                      <small>
                        {packs.length
                          ? `已選 ${packs.length} 個城市包 · ${estimate.cities} 城市`
                          : "尚未選擇城市包"}
                      </small>
                    </span>
                  </summary>
                  <div className={styles.packGroups}>
                    <div className={styles.packGroup}>
                      <button type="button"
                        onClick={() => setPacks(COUNTRY_PACK_LABELS.map((pack) => pack.name))}>
                        全選全世界（{COUNTRY_PACK_LABELS.length} 個城市包）
                      </button>{" "}
                      <button type="button" onClick={() => setPacks([])}>清空</button>
                    </div>
                    {COUNTRY_PACK_GROUPS.map((group) => (
                      <section className={styles.packGroup} key={group.region}>
                        <h3>{group.region}</h3>
                        <div className={styles.choiceGrid}>
                          {group.packs.map((pack) => (
                            <label key={pack.name}
                              className={packs.includes(pack.name) ? styles.checked : ""}>
                              <input type="checkbox" checked={packs.includes(pack.name)}
                                onChange={() => toggle(pack.name, packs, setPacks)} />
                              <span>{pack.name}</span><small>{pack.count} 城市</small>
                            </label>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </details>
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

          <details className={styles.disclosure}><summary>掃描參數（進階）</summary><fieldset>
            <legend>掃描參數</legend>
            <div className={styles.profileChoices} role="radiogroup" aria-label="掃描密度模式">
              <button type="button" className={scanProfile === "global" ? styles.profileSelected : ""}
                aria-pressed={scanProfile === "global"}
                onClick={() => { setScanProfile("global"); setGridStepM(1000); }}>
                全域預設・1km
              </button>
              <button type="button" className={scanProfile === "precision" ? styles.profileSelected : ""}
                aria-pressed={scanProfile === "precision"}
                onClick={() => { setScanProfile("precision"); setGridStepM(500); }}>
                精細模式・500m
              </button>
            </div>
            <p className={styles.profileHint}>{scanProfile === "global"
              ? "每完成一輪就錯開半格，避免反覆掃到同一批座標。"
              : "固定 500m 網格，適合短期針對單一區域加密掃描。"}</p>
            <div className={styles.inputGrid}>
              {mode === "auto" && (
                <label><span>每城中心半徑（km）</span>
                  <input type="number" min="0.5" max="10" step="0.5"
                    value={radiusKm} onChange={(event) => setRadiusKm(Number(event.target.value))} />
                </label>
              )}
              <label><span>網格間距（m，依模式固定）</span>
                <input type="number" min="100" max="2000" value={gridStepM}
                  readOnly aria-readonly="true" />
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
          </fieldset></details>

          <div className={styles.estimate}>
            <span>預估</span>
            <strong>{estimate.cities} 城市・約 {estimate.points.toLocaleString()} 點・單輪 {estimate.hours.toFixed(1)} 小時</strong>
          </div>
          <button className={styles.startButton} disabled={busy || active || !dashboard?.fleet.online || Boolean(dashboardError) || (mode==='auto'&&!packs.length)}
            onClick={start}>
            {!dashboard ? "等待有效的後台資料" : dashboardError ? "後台資料恢復後可操作" :
              active ? "目前已有掃描工作" : dashboard.fleet.online ? "開始分散式掃描" : "等待 Agent 上線"}
          </button>
        </section></details>}

        {page==='fleet'&&<details className={styles.disclosure} onToggle={e=>setShowLogs(e.currentTarget.open)}><summary>手機執行紀錄</summary><section className={`${styles.panel} ${styles.logPanel}`}>
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
            )) : <p className={styles.empty}>{dashboard ? "尚無掃描紀錄" : "掃描紀錄讀取中"}</p>}
          </div>
        </section></details>}

        {page==='more'&&<details className={styles.disclosure} onToggle={e=>setShowUsage(e.currentTarget.open)}><summary>使用者行為與複製紀錄</summary><section className={`${styles.panel} ${styles.copyAuditPanel}`}>
          <div className={styles.panelTitle}>
            <div><span>PUBLIC USAGE</span><h2>GPS 複製紀錄（最近 24 小時）</h2></div>
            <button onClick={() => refreshCopyAudit()} disabled={busy}>重新整理</button>
          </div>
          <p className={styles.copyAuditNote}>來源以不可逆雜湊識別碼呈現；不保存完整 IP，資料保留 {copyAudit?.retention_days ?? 30} 天。</p>
          {copyAuditError&&<p className={styles.error} role="status">{copyAuditError}；保留上次結果。</p>}
          {!copyAudit ? <p>等待使用者行為資料…</p> : <>
            <div className={styles.copyAuditSummary}>
              <span>複製 <strong>{copyAudit?.summary.copies ?? 0}</strong> 次</span>
              <span>來源 <strong>{copyAudit?.summary.sources ?? 0}</strong></span>
              <span>蘑菇 <strong>{copyAudit?.summary.mushrooms ?? 0}</strong></span>
              <span>今日活躍來源 <strong>{copyAudit?.analytics.daily_active_sources ?? 0}</strong></span>
            </div>
            {copyAudit?.analytics.anomalous_copy_sources.length ? <div className={styles.copyAuditAlert}>
              ⚠️ 異常大量複製：近 15 分鐘 {copyAudit.analytics.anomalous_copy_sources.map((source) =>
                `${source.source_hash}${source.country ? `・${source.country}` : ""} ${source.copies} 次／${source.mushrooms} 個`).join("；")}
            </div> : null}
            <div className={styles.copyAnalytics}>
              <article><h3>熱門蘑菇</h3>{copyAudit?.analytics.popular_mushrooms.length ? copyAudit.analytics.popular_mushrooms.slice(0, 5).map((mushroom) =>
                <p key={mushroom.mushroom_id}>Lv.{mushroom.mushroom_level}・Type {mushroom.mushroom_type}　{Number(mushroom.mushroom_lat).toFixed(4)}, {Number(mushroom.mushroom_lng).toFixed(4)}<br /><strong>{mushroom.copies}</strong> 次複製／{mushroom.sources} 來源</p>) : <p>尚無資料</p>}</article>
              <article><h3>篩選與搜尋</h3>{copyAudit?.analytics.filter_stats.length ? copyAudit.analytics.filter_stats.slice(0, 5).map((stat) =>
                <p key={stat.dimension}><code>{stat.dimension}</code><br /><strong>{stat.uses}</strong> 次／{stat.sources} 來源</p>) : <p>尚無資料</p>}</article>
              <article><h3>地圖定位</h3>{copyAudit?.analytics.map_focus_stats.length ? copyAudit.analytics.map_focus_stats.slice(0, 5).map((stat) =>
                <p key={stat.mushroom_id}><code>{stat.mushroom_id}</code><br /><strong>{stat.opens}</strong> 次／{stat.sources} 來源</p>) : <p>尚無資料</p>}</article>
              <article><h3>API 錯誤</h3>{copyAudit?.analytics.api_errors.length ? copyAudit.analytics.api_errors.slice(0, 5).map((stat) =>
                <p key={stat.dimension}><code>{stat.dimension}</code><br /><strong>{stat.errors}</strong> 次／{stat.sources} 來源</p>) : <p>尚無使用者端 API 錯誤</p>}</article>
            </div>
            <details><summary>展開複製明細</summary><div className={styles.copyAuditRows}>
              {copyAudit?.events.length ? copyAudit.events.map((event) => (
                <div key={event.id} className={styles.copyAuditRow}>
                  <time>{formatTime(event.at * 1000)}</time>
                  <span>{event.event_type === "copy_gps" ? "複製 GPS" : "複製資訊"}{event.event_count > 1 ? ` ×${event.event_count}` : ""}</span>
                  <code>Lv.{event.mushroom_level}・Type {event.mushroom_type}</code>
                  <span>{Number(event.mushroom_lat).toFixed(6)}, {Number(event.mushroom_lng).toFixed(6)}</span>
                  <span>來源 {event.source_hash}{event.country ? `・${event.country}` : ""}{event.asn ? `・AS${event.asn}` : ""}・{event.device_class}</span>
                </div>
              )) : <p className={styles.empty}>尚無 GPS 複製紀錄</p>}
            </div></details>
          </>}
        </section></details>}
      </div>
      {page==='reports'&&<ReportAudit />}
      </div>
    </main>
  );
}
