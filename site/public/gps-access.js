(function(){
 'use strict';
 let state={owner:false,authorized:false,expires_at:null},timer=null,onLock=()=>{};
 const dialog=document.createElement('dialog');
 dialog.innerHTML='<form><h2>解鎖 GPS</h2><p>輸入管理員提供的密碼，授權在此瀏覽器有效 12 小時。</p><label>密碼 <input name="password" type="password" autocomplete="current-password" required maxlength="128"></label><p role="status"></p><button type="submit">解鎖</button> <button type="button" data-cancel>取消</button></form>';
 document.body.append(dialog);
 function set(next){
  const previous=state;state=next;clearTimeout(timer);
  if(previous.authorized&&!state.authorized)onLock();
  if(state.expires_at)timer=setTimeout(()=>set({owner:false,authorized:false,expires_at:null}),Math.max(0,state.expires_at*1000-Date.now()));
  const label=document.getElementById('gps-access-label');if(label)label.textContent=state.owner?'管理員 GPS 已顯示':state.authorized?'GPS 已解鎖（清單仍隱藏座標）':'GPS 與精確地圖已鎖定';
 }
 async function check(){try{const r=await fetch('/api/gps/access',{cache:'no-store'});if(!r.ok)throw Error();set(await r.json());return state.authorized;}catch{set({owner:false,authorized:false,expires_at:null});return false;}}
 async function unlock(){if(await check())return true;return new Promise(resolve=>{
  const form=dialog.querySelector('form'),input=form.elements.password,status=form.querySelector('[role=status]');input.value='';status.textContent='';
  function close(ok){dialog.close();input.value='';form.onsubmit=null;dialog.oncancel=null;resolve(ok);}
  dialog.querySelector('[data-cancel]').onclick=()=>close(false);dialog.oncancel=e=>{e.preventDefault();close(false);};
  form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;
   try{const r=await fetch('/api/gps/unlock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:input.value})});const d=await r.json();input.value='';if(!r.ok)throw Error(d.error||'解鎖失敗');if(!await check())throw Error('無法確認授權，請重試');close(true);}
   catch(error){status.textContent=error.message;}finally{button.disabled=false;}
  };dialog.showModal();input.focus();
 });}
 async function coordinates(id){if(!await unlock())return null;const r=await fetch('/api/mushrooms?include_meta=0&limit=10&q='+encodeURIComponent(id),{cache:'no-store'});if(!r.ok)throw Error('無法取得 GPS，請重試');const d=await r.json();set(d.gps_access||{owner:false,authorized:false});const m=d.mushrooms?.find(x=>x.id===id);if(!state.authorized||!m||m.lat===null||m.lng===null)throw Error('蘑菇已失效或授權已到期');return m;}
 window.GpsGate={get state(){return state;},set,check,unlock,coordinates,onLock(fn){onLock=fn;}};
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
})();
