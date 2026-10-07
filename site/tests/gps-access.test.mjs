import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {access,unlock,setPassword,ownerEmail,browserWrite,GRANT_SECONDS} from '../lib/gps-access.mjs';
import {createApi} from './helpers/mushroom-api.mjs';
import {Script} from 'node:vm';
function fixture(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../drizzle/0025_wakeful_major_mapleleaf.sql',import.meta.url),'utf8'));return {db,env:{COPY_AUDIT_HASH_KEY:'test-only-secret'.repeat(4),DB:{prepare(sql){let args=[];return {bind(...a){args=a;return this},async first(){return db.prepare(sql).get(...args)},async run(){return db.prepare(sql).run(...args)}}}}}};}
const request=(cookie='',headers={})=>new Request('https://example.test/api/gps/access',{headers:{cookie,...headers}});

test('GPS password accepts four characters and rejects shorter or oversized input',async()=>{
 const {db,env}=fixture();const now=1000000;
 for(const password of ['', 'abc', 'x'.repeat(129)])assert.equal((await setPassword(env,password,now)).status,400);
 assert.equal(db.prepare('SELECT count(*) AS n FROM gps_access_settings').get().n,0);
 assert.equal((await setPassword(env,'aB7!',now)).status,200);
 assert.equal((await unlock(request(),env,'aB7!',now)).status,200);
 assert.equal((await setPassword(env,'x'.repeat(128),now+1)).status,200);
 const form=readFileSync(new URL('../app/admin/gps-settings.tsx',import.meta.url),'utf8');assert.match(form,/minLength=\{4\}/);assert.doesNotMatch(form,/minLength=\{12\}/);db.close();
});
test('owner is exact allowlist; CSRF rejects missing and foreign origin',()=>{
 assert.equal(ownerEmail(' ODY.LIAO@gmail.com '),true);assert.equal(ownerEmail('other@gmail.com'),false);
 for(const origin of ['','https://evil.test'])assert.equal(browserWrite(new Request('https://example.test/api/gps/unlock',{headers:{origin,'Content-Type':'application/json'}})),false);
 assert.equal(browserWrite(new Request('https://example.test/api/gps/unlock',{headers:{origin:'https://example.test','Content-Type':'application/json'}})),true);
});
test('real SQL password grant is HttpOnly, 12h, tamper-safe and revoked on rotation',async()=>{
 const {db,env}=fixture();const now=1000000;
 assert.equal((await unlock(request(),env,'anything',now)).status,403);
 assert.equal((await setPassword(env,'correct-password',now)).status,200);
 const r=await unlock(request(),env,'correct-password',now);assert.equal(r.status,200);
 const cookie=r.headers.get('set-cookie').split(';')[0];assert.match(r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
 assert.equal((await access(request(cookie),env,now+1)).authorized,true);
 assert.equal((await access(request(cookie),env,now+GRANT_SECONDS)).authorized,false);
 assert.equal((await access(request(cookie.slice(0,-1)+'x'),env,now+1)).authorized,false);
 await setPassword(env,'new-password-123',now+1);assert.equal((await access(request(cookie),env,now+2)).authorized,false);
 assert.equal((await access(request('',{'oai-authenticated-user-email':'ody.liao@gmail.com'}),env,now)).owner,true);
 assert.equal((await access(request('',{'oai-authenticated-user-email':'other@gmail.com'}),env,now)).authorized,false);
 assert.ok(!JSON.stringify(db.prepare('SELECT * FROM gps_access_settings').get()).includes('new-password-123'));db.close();
});
test('persistent unlock budget survives callers and bounds password attempts',async()=>{
 const {db,env}=fixture();await setPassword(env,'correct-password');const now=1000000;
 for(let i=0;i<10;i++)assert.equal((await unlock(request(),env,'wrong-password',now)).status,403);
 assert.equal((await unlock(request(),env,'correct-password',now)).status,429);
 assert.equal((await unlock(request(),env,'correct-password',now+900)).status,200);db.close();
});
test('anonymous real SQL cannot spatially probe or get GPS; controller-style pagination remains exact',async()=>{
 const api=createApi({size:25,gpsAuthorized:false});const r=await api.get('limit=3&bbox=120,24,122,26');assert.equal(r.status,200);
 const d=await r.json();assert.equal(d.count,25);assert.equal(d.live_agents.length,0);assert.equal(d.gps_access.authorized,false);
 assert.ok(d.mushrooms.every(m=>m.lat===null&&m.lng===null&&!Object.hasOwn(m,'cluster')));
 assert.equal((await api.get('q=25,121')).status,403);
 const city=await api.get('q=east');assert.equal(city.status,200);assert.equal((await city.json()).count,12);
 const full=createApi({size:25});const fullResponse=await full.get('bbox=120,24,122,26&limit=3&cache=brief');const exact=await fullResponse.json();
 assert.equal(exact.count,12);assert.equal(exact.mushrooms[0].lat,25);assert.equal(fullResponse.headers.get('X-Map-Cache'),'BYPASS');assert.match(fullResponse.headers.get('Cache-Control'),/no-store/);
 api.db.close();full.db.close();
});
test('real access policy keeps owner/controller coordinates out of anonymous cache',async()=>{
 const api=createApi({size:25,realAccess:true});
 const anon=await api.get('limit=3&cache=brief');assert.equal(anon.status,200);assert.equal((await anon.json()).mushrooms[0].lat,null);
 const owner=await api.get('limit=3&cache=brief',{'oai-authenticated-user-email':'ody.liao@gmail.com'});assert.equal(owner.status,200);const full=await owner.json();assert.equal(full.gps_access.owner,true);assert.notEqual(full.mushrooms[0].lat,null);assert.match(owner.headers.get('Cache-Control'),/no-store/);
 const controller=await api.get('levels=3&under_five=1&limit=3',{'Authorization':'Bearer fixture-controller'});assert.equal(controller.status,200);assert.ok((await controller.json()).mushrooms.every(m=>m.lat!==null&&m.challenger_count<5));
 const again=await api.get('limit=3&cache=brief',{'oai-authenticated-user-email':'other@gmail.com','Authorization':'Bearer fake'});assert.equal(again.status,200);assert.ok((await again.json()).mushrooms.every(m=>m.lat===null));api.db.close();
});
test('browser expiry clears authorization without storing passwords or exposing inline GPS to visitors',()=>{
 let expired,cleared=0;const document={body:{append(){}},createElement:()=>({}),getElementById:()=>null,addEventListener(){}};
 const context={document,window:{},Date,setTimeout:fn=>{expired=fn;return 1},clearTimeout(){}};
 new Script(readFileSync(new URL('../public/gps-access.js',import.meta.url),'utf8')).runInNewContext(context);
 const gate=context.window.GpsGate;gate.onLock(()=>cleared++);gate.set({owner:false,authorized:true,expires_at:Math.floor(Date.now()/1000)+43200});expired();assert.equal(gate.state.authorized,false);assert.equal(cleared,1);
 const html=readFileSync(new URL('../public/map.html',import.meta.url),'utf8');assert.match(html,/GpsGate.state.owner\?'・'/);assert.doesNotMatch(html,/data-lat=|data-lng=/);
 const js=readFileSync(new URL('../public/gps-access.js',import.meta.url),'utf8');assert.doesNotMatch(js,/localStorage|sessionStorage/);
});
