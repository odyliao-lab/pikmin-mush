import {controllerAuthorized,ensureSchema,noStoreJson,readBoundedUtf8,runtime} from '../../../../lib/cloud';
import {dispatchInventory,closeDispatch} from '../../../../lib/dispatch-coordination.mjs';

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
 if(!value||typeof value!=='object'||!owner||value.owner!==owner||value.action!=='complete'||
  typeof value.batch!=='string'||!/^[a-zA-Z0-9._:-]{6,100}$/.test(value.batch))
  return noStoreJson({error:'coordinated owner required'},409);
 await ensureSchema();
 const result=await closeDispatch(runtime().DB,value.batch,owner,Date.now());
 return noStoreJson(result,result.http);
}
