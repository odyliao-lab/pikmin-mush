// Browser GPS grants are separate from agent/controller authentication.
export const OWNER_EMAIL = 'ody.liao@gmail.com';
export const GRANT_SECONDS = 12 * 60 * 60;
const COOKIE = '__Host-pikmin-gps';
const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2,'0')).join('');
const unhex = s => Uint8Array.from(s.match(/../g) || [], x => parseInt(x,16));
export const ownerEmail = email => String(email || '').trim().toLowerCase() === OWNER_EMAIL;
export function privateJson(data, status=200) {
  return Response.json(data,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie, oai-authenticated-user-email'}});
}
export function browserWrite(request) {
  return request.headers.get('origin') === new URL(request.url).origin &&
    request.headers.get('content-type')?.split(';')[0].trim() === 'application/json';
}
async function sign(secret, text) {
  if (!secret || secret.length < 32) throw Error('GPS secret unavailable');
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,encoder.encode('pikmin-gps-v1:'+text)));
}
export async function passwordHash(password,salt) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(salt),iterations:100000,hash:'SHA-256'},key,256));
}
function equal(a,b) { if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0; }
export async function settings(env) {
  return env.DB.prepare('SELECT salt, password_hash, revision, updated_at FROM gps_access_settings WHERE id=1').first();
}
export async function access(request,env,now=Math.floor(Date.now()/1000)) {
  const owner=ownerEmail(request.headers.get('oai-authenticated-user-email'));
  if(owner)return {owner:true,authorized:true,expires_at:null};
  const raw=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  const denied={owner:false,authorized:false,expires_at:null};
  if(!raw || raw.length>256)return denied;
  const [revision,expires,nonce,signature,...extra]=raw.split('.');
  const expiry=Number(expires);
  if(extra.length || !/^[a-f0-9]{32}$/.test(nonce||'') || !/^[a-f0-9]{64}$/.test(signature||'') || !Number.isSafeInteger(expiry) || expiry<=now || expiry>now+GRANT_SECONDS)return denied;
  if(!equal(signature,await sign(env.COPY_AUDIT_HASH_KEY,`${revision}.${expires}.${nonce}`)))return denied;
  const row=await settings(env);
  return row && String(row.revision)===revision ? {owner:false,authorized:true,expires_at:expiry}:denied;
}
export async function setPassword(env,password,now=Math.floor(Date.now()/1000)) {
  if(typeof password!=='string'||password.length<4||password.length>128)return privateJson({error:'密碼需為 4–128 個字元'},400);
  // Ensure signing is configured before persisting a usable password.
  await sign(env.COPY_AUDIT_HASH_KEY,'configuration-check');
  const salt=hex(crypto.getRandomValues(new Uint8Array(16))),hash=await passwordHash(password,salt);
  await env.DB.prepare(`INSERT INTO gps_access_settings(id,salt,password_hash,revision,updated_at) VALUES(1,?,?,1,?)
    ON CONFLICT(id) DO UPDATE SET salt=excluded.salt,password_hash=excluded.password_hash,revision=gps_access_settings.revision+1,updated_at=excluded.updated_at`).bind(salt,hash,now).run();
  return privateJson({ok:true,revoked_previous_grants:true});
}
export async function unlock(request,env,password,now=Math.floor(Date.now()/1000)) {
  const source=await sign(env.COPY_AUDIT_HASH_KEY,'attempt:'+ (request.headers.get('cf-connecting-ip')||'unknown'));
  const window=Math.floor(now/900);
  const budget=await env.DB.prepare(`INSERT INTO gps_unlock_budgets(source,window,attempts) VALUES(?,?,1)
    ON CONFLICT(source) DO UPDATE SET window=excluded.window,attempts=CASE WHEN gps_unlock_budgets.window=excluded.window THEN gps_unlock_budgets.attempts+1 ELSE 1 END RETURNING attempts`).bind(source,window).first();
  if(!budget || budget.attempts>10)return privateJson({error:'嘗試過多，請 15 分鐘後重試'},429);
  // Bounded stale-budget compaction, never touches mushroom/report records.
  await env.DB.prepare('DELETE FROM gps_unlock_budgets WHERE source IN (SELECT source FROM gps_unlock_budgets WHERE window<? LIMIT 20)').bind(window-96).run();
  const row=await settings(env);
  if(!row)return privateJson({error:'管理員尚未設定 GPS 密碼'},403);
  if(typeof password!=='string'||password.length>128||!equal(await passwordHash(password,row.salt),row.password_hash))return privateJson({error:'密碼不正確'},403);
  const expires=now+GRANT_SECONDS,nonce=hex(crypto.getRandomValues(new Uint8Array(16)));
  const payload=`${row.revision}.${expires}.${nonce}`;
  const response=privateJson({ok:true,expires_at:expires});
  response.headers.set('Set-Cookie',`${COOKIE}=${payload}.${await sign(env.COPY_AUDIT_HASH_KEY,payload)}; Path=/; Max-Age=${GRANT_SECONDS}; HttpOnly; Secure; SameSite=Strict`);
  return response;
}
