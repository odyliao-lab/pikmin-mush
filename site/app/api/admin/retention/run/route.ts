import {adminAuthorized,ensureSchema,runtime,readBoundedUtf8} from '../../../../../lib/cloud';
import {browserWrite,privateJson} from '../../../../../lib/gps-access.mjs';
import {runHistoryRetention} from '../../../../../lib/history-retention.mjs';

// Existing administrator session only. Controller/Agent credentials remain read-only here.
export async function POST(request:Request) {
  if(!adminAuthorized(request)||!browserWrite(request))return privateJson({error:'forbidden'},403);
  const body=await readBoundedUtf8(request,256);
  if('error' in body)return privateJson({error:'payload too large'},413);
  try {
    const input=JSON.parse(body.text);
    if(!input||input.action!=='run'||Object.keys(input).length!==1)return privateJson({error:'invalid action'},400);
  }catch{return privateJson({error:'invalid payload'},400);}
  await ensureSchema();
  try {
    const result=await runHistoryRetention(runtime().DB,Date.now(),{catchUp:true});
    if(result.busy)return privateJson({busy:true,history:result},409);
    const failed=result.consecutiveFailures>0||result.tables.some((t:{last_error?:string})=>t.last_error);
    return privateJson({ok:!failed,history:result},failed?503:200);
  }catch{return privateJson({error:'retention pass failed; inspect retained status'},503);}
}
