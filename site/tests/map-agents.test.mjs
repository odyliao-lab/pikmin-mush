import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {mapAgents,MAP_RECENT_MS,RECENT_MAP_TARGETS_SQL,MAP_TARGETS_SQL} from '../lib/map-agents.mjs';
import {createApi} from './helpers/mushroom-api.mjs';

const now=1_800_000_000_000;
const agent=(id,patch={})=>({id,name:id,display_name:id,enabled:1,paused:0,online:false,last_seen:now-30_000,current_target_id:1,current_location:[1,2],token_hash:'never-public',...patch});
const target={id:1,lat:52.5,lng:13.4,country:'country',city:'city'};

test('nine arbitrary enabled agents survive 15-second heartbeat and ACK gaps without exposing device positions',()=>{
 const agents=Array.from({length:9},(_,i)=>agent('new-agent-'+i,{current_target_id:i?1:null}));
 const rows=mapAgents(agents,[target],[{...target,agent_id:'new-agent-0',position_at:now-20_000}],now);
 assert.equal(rows.length,9);assert.ok(rows.every(x=>x.current_location?.[0]===52.5));
 assert.equal(rows[0].state,'waiting');assert.equal(rows[0].location_source,'recent_target');
 assert.equal(rows[1].state,'assigned');assert.equal(rows[1].location_source,'assigned_target');
 assert.ok(rows.every(x=>!('token_hash' in x)));assert.doesNotMatch(JSON.stringify(rows),/never-public/);
});

test('paused, stale, missing and invalid coordinates remain explicit roster entries without a false map pin',()=>{
 const rows=mapAgents([agent('paused',{paused:1}),agent('old',{last_seen:now-MAP_RECENT_MS}),agent('disabled',{enabled:0}),agent('missing',{current_target_id:null}),agent('bad',{current_target_id:2}),agent('delayed',{last_seen:now-100_000})],[target,{id:2,lat:null,lng:0}],[{...target,agent_id:'missing',position_at:now-MAP_RECENT_MS-1}],now);
 assert.equal(rows.length,5);assert.deepEqual(rows.map(x=>x.state),['paused','offline','waiting','waiting','delayed']);
 assert.ok(rows.slice(0,4).every(x=>x.current_location===null));assert.deepEqual(rows[4].current_location,[52.5,13.4]);
});

test('recent formal target lookup uses indexed per-agent event history and survives queue archival without duplicate rows',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE scan_agents(id TEXT PRIMARY KEY,enabled INTEGER,paused INTEGER,current_target_id INTEGER);
 CREATE TABLE scan_agent_events(id INTEGER PRIMARY KEY,agent_id TEXT,event_type TEXT,at INTEGER,target_id INTEGER);
 CREATE INDEX scan_agent_events_agent_at_idx ON scan_agent_events(agent_id,at);
 CREATE TABLE scan_targets(id INTEGER PRIMARY KEY,lat REAL,lng REAL,country TEXT,city TEXT);
 CREATE TABLE scan_target_history(id INTEGER PRIMARY KEY,lat REAL,lng REAL,country TEXT,city TEXT);
 INSERT INTO scan_agents VALUES('a',1,0,10),('b',1,0,NULL),('old',1,0,NULL),('paused',1,1,NULL);
 INSERT INTO scan_targets VALUES(10,52,13,'current','city');
 INSERT INTO scan_target_history VALUES(10,1,2,'duplicate','wrong'),(20,48,2,'archived','city');
 INSERT INTO scan_agent_events VALUES(1,'a','target_completed',950,10),(2,'a','heartbeat',990,NULL),(3,'b','target_claimed',960,20),(4,'old','target_completed',100,10),(5,'paused','target_completed',980,10);`);
 try {
  const rows=db.prepare(RECENT_MAP_TARGETS_SQL).all(900);
  assert.equal(rows.length,2);assert.equal(rows.find(x=>x.agent_id==='a').country,'current');assert.equal(rows.find(x=>x.agent_id==='b').country,'archived');
  const combined=db.prepare(MAP_TARGETS_SQL).all(900);assert.equal(combined.length,3);assert.equal(combined.filter(x=>x.agent_id===null).length,1);
  const plan=db.prepare('EXPLAIN QUERY PLAN '+RECENT_MAP_TARGETS_SQL).all(900);
  assert.ok(plan.some(x=>x.detail.includes('scan_agent_events_agent_at_idx')));
 } finally {db.close();}
});

test('actual map render functions show every dynamic name and clear markers and roster when GPS locks',()=>{
 const html=readFileSync(new URL('../public/map.html',import.meta.url),'utf8');
 const nodes=Object.fromEntries(['fleet-items','fleet-summary','fleet-all'].map(id=>[id,{}]));
 const names=['Aries','Cancer','Leo','Libra','Taurus','Gemini','Virgo','Sagittarius','Capricorn'];
 const agents=names.map((name,i)=>({id:name,name,current_location:[40+i,10+i],state:'assigned'}));
 let removed=0;
 const marker=()=>({addTo(){return this},bindPopup(){return this},bindTooltip(){return this},setLatLng(){return this},setIcon(){return this},setPopupContent(){return this},setTooltipContent(){return this}});
 const ctx={liveAgents:agents,mapRoster:agents,agentMarkers:{},GpsGate:{state:{authorized:true}},document:{getElementById:id=>nodes[id]},L:{marker},map:{removeLayer(){removed++}},agentIcon:()=>({}),agentPopup:()=>'',esc:String,AGENT_STATE_LABELS:{assigned:'已派工'}};
 const source=['renderAgentRoster','renderLiveAgents'].map(name=>html.split('\n').find(line=>line.startsWith('function '+name+'('))).join('\n');
 runInNewContext(source+'\nrenderLiveAgents();',ctx);
 assert.equal(Object.keys(ctx.agentMarkers).length,9);assert.equal(nodes['fleet-summary'].textContent,'掃描機隊 9 台・地圖 9 台');
 assert.ok(names.every(name=>nodes['fleet-items'].innerHTML.includes(name)));assert.equal(nodes['fleet-all'].hidden,false);
 ctx.liveAgents=[];ctx.mapRoster=[];ctx.GpsGate.state.authorized=false;runInNewContext('renderLiveAgents()',ctx);
 assert.equal(removed,9);assert.equal(nodes['fleet-items'].innerHTML,'');assert.equal(nodes['fleet-all'].hidden,true);
});

test('real route includes dynamic roster only behind existing GPS authorization, including through cache reads',async()=>{
 const fleetFixture={agents:[agent('future-agent',{last_seen:Date.now(),current_target_id:null})],recent:[{...target,agent_id:'future-agent',position_at:Date.now()}]};
 const api=createApi({size:3,realAccess:true,fleetFixture});
 try {
  const owner=await (await api.get('limit=1&cache=brief',{'oai-authenticated-user-email':'ody.liao@gmail.com'})).json();
  assert.equal(owner.map_agents.length,1);assert.equal(owner.live_agents.length,1);assert.equal(owner.map_agents[0].location_source,'recent_target');
  const anonymous=await (await api.get('limit=1&cache=brief')).json();
  assert.deepEqual(anonymous.map_agents,[]);assert.deepEqual(anonymous.live_agents,[]);
  const cursor=await (await api.get('limit=1&include_meta=0',{'oai-authenticated-user-email':'ody.liao@gmail.com'})).json();assert.equal(cursor.map_agents,undefined);
 } finally {api.db.close();}
});
