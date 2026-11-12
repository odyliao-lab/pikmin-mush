"use client";

import {useEffect,useRef,useState} from 'react';

import Link from 'next/link';
import LevelCleanup from './level-cleanup';

type Table={table:string;managed:string;eligible_count?:number;deleted_last_run?:number;last_error?:string;checked_at?:number};

type History={pendingTotal:number;targetPending:number;deletedLastRun:number;mode:string;tables:Table[];lastSucceededAt:number;run?:{profile:string;deleted:number;expiredBackupsDeleted:number}};

export default function RetentionClient(){

 const [history,setHistory]=useState<History|null>(null),[running,setRunning]=useState(false),[message,setMessage]=useState('正在讀取盤點…');

 const [removed,setRemoved]=useState(0);const stop=useRef(false);

 useEffect(()=>{fetch('/api/admin/retention',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();return r.json()}).then(h=>{setHistory(h);setMessage('盤點已更新。')}).catch(()=>setMessage('無法讀取盤點，請確認管理員登入。'));return()=>{stop.current=true}},[]);

 async function clean(){

  stop.current=false;setRunning(true);setRemoved(0);let total=0,finished=false;

  try{

   for(let pass=0;pass<250&&!stop.current;pass++){

    setMessage('正在備份並清理一批；保留近期資料、執行中工作及去重憑證。');

    const response=await fetch('/api/admin/retention/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'run'})});

    const data=await response.json();

    if(response.status===409&&data.busy){setMessage('另一個清理批次執行中，等待後續處理。');await new Promise(r=>setTimeout(r,5000));continue;}

    if(!response.ok||!data.ok)throw Error('清理未成功，已停止；請查看保留狀態。');

    const h:History=data.history;setHistory(h);total+=(h.run?.deleted||0)+(h.run?.expiredBackupsDeleted||0);setRemoved(total);

    if(h.pendingTotal<=h.targetPending){setMessage('已達積壓目標；日常排程持續維護。');finished=true;break;}

    if(!((h.run?.deleted||0)+(h.run?.expiredBackupsDeleted||0))){setMessage('本批沒有可安全移除的資料，已停止，請檢查相依資料或過大紀錄。');finished=true;break;}

    setMessage('本批完成，短暫讓出資料庫後繼續下一批。');await new Promise(r=>setTimeout(r,3000));

   }

   if(stop.current)setMessage('已停止後續批次；已受理的一批會安全完成。');
   else if(!finished)setMessage('已達本次批次上限，請檢查最新盤點後再繼續。');

  }catch(error){setMessage(error instanceof Error?error.message:'清理未完成，已停止。');}

  finally{setRunning(false);}

 }

 const format=(n:number)=>n.toLocaleString('zh-TW');

 return <main style={{maxWidth:920,margin:'40px auto',padding:24,fontFamily:'system-ui',lineHeight:1.7}}>

  <Link href="/admin">← 回到探險隊後台</Link><h1>歷史資料清理</h1>
  <LevelCleanup/>

  <p>只清理已超過保留期限且通過相依檢查的紀錄。刪除前原子備份，保留 7 天供維運復原；不清除挑戰身分、地點目錄、上傳收據或執行中工作。</p>

  <p>目標：待清理紀錄不超過 {format(history?.targetPending||10000)} 筆。</p>

  <p><strong>待清理：{history?format(history.pendingTotal):'—'} 筆</strong>　 本次已移除：{format(removed)} 筆</p>

  <p role="status" aria-live="polite">{message}</p>

  <button disabled={running||!history||history.mode!=='active'} onClick={clean} style={{padding:'12px 20px'}}>開始分批清理至目標</button>{' '}

  <button disabled={!running} onClick={()=>{stop.current=true}} style={{padding:'12px 20px'}}>停止後續批次</button>

  <p>保持此頁開啟以連續處理。關閉頁面會停止後續批次；每批仍受列數、備份大小與時間上限保護。</p>

  <table style={{width:'100%',textAlign:'left',borderCollapse:'collapse'}}><thead><tr><th>資料表</th><th>待清理</th><th>最近一輪移除</th><th>狀態</th></tr></thead>

   <tbody>{history?.tables.filter(t=>t.managed==='extended'||t.managed==='backup').map(t=><tr key={t.table}><td>{t.table}</td><td>{format(t.eligible_count||0)}</td><td>{format(t.deleted_last_run||0)}</td><td>{t.last_error||'無錯誤'}</td></tr>)}</tbody></table>

 </main>;

}

