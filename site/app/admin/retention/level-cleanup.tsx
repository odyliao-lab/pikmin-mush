"use client";
import {useEffect,useRef,useState} from 'react';

type Policy={excludedTotal:number;backupDays:number;tables:Record<string,{excluded:number}>;backups:Record<string,number>};
export default function LevelCleanup(){
 const [policy,setPolicy]=useState<Policy|null>(null),[running,setRunning]=useState(false);
 const [message,setMessage]=useState('正在讀取等級政策…'),[removed,setRemoved]=useState(0);
 const stop=useRef(false);
 useEffect(()=>{fetch('/api/admin/mushroom-policy',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();return r.json()})
  .then(p=>{setPolicy(p);setMessage('等級政策盤點已更新。')}).catch(()=>setMessage('無法讀取等級政策，請確認管理員登入。'));return()=>{stop.current=true}},[]);
 async function clean(){
  if(!policy)return;
  stop.current=false;setRunning(true);setRemoved(0);let total=0,current=policy;
  async function inventory(){
   const r=await fetch('/api/admin/mushroom-policy',{cache:'no-store'});
   if(!r.ok)throw Error('盤點讀取失敗；未宣稱清理完成。');
   return await r.json() as Policy;
  }
  try{
   for(let pass=0;pass<100&&!stop.current;pass++){
    setMessage('正在備份並移除小菇／一般菇，保留大菇與巨菇…');
    const r=await fetch('/api/admin/mushroom-policy',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'archive-excluded'})});
    const d=await r.json();if(!r.ok||!d.ok)throw Error(`等級清理未完成，已停止（${d.stage||'request'}/${d.reason||r.status}）；已完成批次保留備份。`);
    const n=d.batches.reduce((sum:number,b:{deleted:number})=>sum+b.deleted,0);total+=n;setRemoved(total);
    const tables={...current.tables};
    for(const b of d.batches)tables[b.table]={...tables[b.table],excluded:Math.max(0,tables[b.table].excluded-b.deleted)};
    current={...current,tables,excludedTotal:Object.values(tables).reduce((sum,t)=>sum+t.excluded,0)};setPolicy(current);
    if(pass%10===9||n===0||current.excludedTotal===0){
     current=await inventory();setPolicy(current);
     if(current.excludedTotal===0){setMessage('等級清理完成：小菇與一般菇剩餘0筆。');return;}
     if(n===0)throw Error('沒有可安全清理的紀錄，已停止；請檢查過大資料或相依問題。');
    }
    await new Promise(resolve=>setTimeout(resolve,1500));
   }
   setPolicy(await inventory());setMessage(stop.current?'已停止後續等級清理批次。':'已達本次批次上限，可依剩餘筆數再繼續。');
  }catch(e){setMessage(e instanceof Error?e.message:'清理停止。')}finally{setRunning(false)}
 }
 return <section aria-label="蘑菇等級資料政策" style={{border:'1px solid #9ab79d',borderRadius:12,padding:20,margin:'24px 0'}}>
  <h2>只保留大菇與巨菇</h2>
  <p>新上傳只保留大菇（3級）與巨菇（4級）。既有小菇／一般菇的清單資料與觀測紀錄，可先備份後分批移除；備份保留7天供維運復原。</p>
  <p>不更動Agent認證、游標、待送ACK、上傳收據、派工及共用挑戰／地點身分。</p>
  <p>待移除：<strong>{policy?.excludedTotal.toLocaleString('zh-TW')??'—'}</strong> 筆；本次已移除：{removed.toLocaleString('zh-TW')} 筆。</p>
  {policy&&<p>清單：{policy.tables.mushrooms.excluded.toLocaleString('zh-TW')}；觀測紀錄：{policy.tables.mushroom_observations.excluded.toLocaleString('zh-TW')}。</p>}
  <p role="status">{message}</p>
  <button disabled={running||!policy||policy.excludedTotal===0} onClick={clean}>備份並移除小菇與一般菇</button>{' '}
  <button disabled={!running} onClick={()=>{stop.current=true}}>停止等級清理</button>
 </section>;
}
