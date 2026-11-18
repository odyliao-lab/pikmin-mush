import {controllerAuthorized,ensureSchema,noStoreJson,readBoundedUtf8,runtime,safeEqual} from '../../../../lib/cloud';
import {dispatchInventory,dispatchProof,closeDispatch,recoverCancelledReturn} from '../../../../lib/dispatch-coordination.mjs';
import {cancelStoppedDispatch} from '../../../../lib/dispatch-cancellation.mjs';
import {activeJob} from '../../../../lib/scans';

export async function GET(request: Request) {
 if(!controllerAuthorized(request))return noStoreJson({error:'unauthorized'},401);
 const params=new URL(request.url).searchParams;
 const batch=params.get('batch');
 if(batch!==null){
  if(!/^[a-zA-Z0-9._:-]{6,100}$/.test(batch))return noStoreJson({error:'invalid batch'},400);
  const proof=await dispatchProof(runtime().DB,batch);
  return proof?noStoreJson({coordination:proof}):noStoreJson({error:'batch not found'},404);
 }
 const cursor=params.get('cursor')??'';
 if(cursor.length>100)return noStoreJson({error:'invalid cursor'},400);
 await ensureSchema();
 return noStoreJson({...await dispatchInventory(runtime().DB,cursor),parallel_contract:1,max_parallel:3,
  operator_cancellation_contract:1,
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
 if(!value||typeof value!=='object'||!owner||value.owner!==owner||!['complete','recover-return','cancel'].includes(value.action)||
  typeof value.batch!=='string'||!/^[a-zA-Z0-9._:-]{6,100}$/.test(value.batch))
  return noStoreJson({error:'coordinated owner required'},409);
 if(value.action==='cancel') {
  const env=runtime();
  const secret=env.VERIFICATION_DISPATCH_CANCEL_TOKEN??'';
  if(secret.length<32||safeEqual(secret,env.CONTROLLER_TOKEN??'')||
   !safeEqual(request.headers.get('x-dispatch-cancel-token')??'',secret))
   return noStoreJson({error:'dispatcher cancellation credential required'},403);
  if(typeof value.agent_id!=='string'||!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value.agent_id)||
   !Number.isSafeInteger(value.job_id)||value.job_id<=0)
   return noStoreJson({error:'exact agent and job required'},400);
  const result=await cancelStoppedDispatch(env.DB,{batch:value.batch,owner,agentId:value.agent_id,jobId:value.job_id},Date.now());
  return noStoreJson(result,result.http);
 }
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
