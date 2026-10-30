import {controllerAuthorized,ensureSchema,noStoreJson,readBoundedUtf8,runtime} from '../../../../lib/cloud';
import {dispatchInventory,closeDispatch,recoverCancelledReturn} from '../../../../lib/dispatch-coordination.mjs';
import {activeJob} from '../../../../lib/scans';

export async function GET(request: Request) {
 if(!controllerAuthorized(request))return noStoreJson({error:'unauthorized'},401);
 const cursor=new URL(request.url).searchParams.get('cursor')??'';
 if(cursor.length>100)return noStoreJson({error:'invalid cursor'},400);
 await ensureSchema();
 return noStoreJson({...await dispatchInventory(runtime().DB,cursor),
  coordinated_admission_required:!!runtime().VERIFICATION_DISPATCHER_ID,checked_at:Date.now()});
}
// Completion is a separate durable transition, not an expiry-based unlock.
export async function POST(request: Request) {
 if(!controllerAuthorized(request))return noStoreJson({error:'unauthorized'},401);
 const body=await readBoundedUtf8(request,2048);
 if('error' in body)return noStoreJson({error:'invalid body'},400);
 let value;
 try{value=JSON.parse(body.text);}catch{return noStoreJson({error:'invalid json'},400);}
 const owner=runtime().VERIFICATION_DISPATCHER_ID;
 if(!value||typeof value!=='object'||!owner||value.owner!==owner||!['complete','recover-return'].includes(value.action)||
  typeof value.batch!=='string'||!/^[a-zA-Z0-9._:-]{6,100}$/.test(value.batch))
  return noStoreJson({error:'coordinated owner required'},409);
 await ensureSchema();
 if(value.action==='recover-return') {
  const db=runtime().DB;
  const claim=await db.prepare('SELECT agent_id FROM controller_dispatches WHERE batch=?').bind(value.batch).first<{agent_id:string}>();
  const agent=claim?await db.prepare('SELECT id,enabled,paused,last_seen,current_lat,current_lng,region_tags_json FROM scan_agents WHERE id=?')
   .bind(claim.agent_id).first<{id:string;enabled:number;paused:number;last_seen:number;current_lat:number;current_lng:number;region_tags_json:string}>():null;
  let tags=[];try{tags=JSON.parse(agent?.region_tags_json??'[]');}catch{}
  if(!Array.isArray(tags)||!tags[0])return noStoreJson({error:'agent region unavailable'},409);
  const result=await recoverCancelledReturn(db,value.batch,owner,String(value.recovery_id??''),
   agent?{...agent,country:String(tags[0])}:null,await activeJob(),Date.now());
  return noStoreJson(result,result.http);
 }
 const result=await closeDispatch(runtime().DB,value.batch,owner,Date.now());
 return noStoreJson(result,result.http);
}
