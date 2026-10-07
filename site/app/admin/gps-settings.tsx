'use client';
import {useState} from 'react';
export default function GpsSettings() {
  const [password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();if(password!==confirm){setMessage('兩次輸入不一致');return;}
    setBusy(true);setMessage('');
    try {const response=await fetch('/api/admin/gps',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});const data=await response.json();if(!response.ok)throw Error(data.error||'儲存失敗');setPassword('');setConfirm('');setMessage('密碼已更新，舊授權已失效。');}
    catch(error){setMessage(error instanceof Error?error.message:'儲存失敗，請重試');}finally{setBusy(false);}
  }
  return <details style={{padding:'1rem',background:'white',borderRadius:12,margin:'1rem 0'}}><summary>GPS 複製密碼</summary><p>只有你的帳號能管理。其他訪客解鎖後有效 12 小時；更換密碼會撤銷所有舊授權。尚未設定時不開放 GPS。密碼至少 4 個字元。</p><form onSubmit={save}><label>新密碼 <input type="password" autoComplete="new-password" minLength={4} maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)} /></label><label> 再次輸入 <input type="password" autoComplete="new-password" required value={confirm} onChange={e=>setConfirm(e.target.value)} /></label><button disabled={busy} type="submit">{busy?'儲存中…':'更新密碼'}</button><p role="status">{message}</p></form></details>;
}
