import {adminAuthorized,runtime,readBoundedUtf8} from '../../../../lib/cloud';
import {browserWrite,privateJson,setPassword,settings} from '../../../../lib/gps-access.mjs';
export async function GET(request: Request) {
  if(!adminAuthorized(request))return privateJson({error:'forbidden'},403);
  try {const row=await settings(runtime());return privateJson({configured:Boolean(row),updated_at:row?.updated_at??0});}
  catch {return privateJson({error:'設定暫時不可用'},503);}
}
export async function POST(request: Request) {
  if(!adminAuthorized(request)||!browserWrite(request))return privateJson({error:'forbidden'},403);
  const body=await readBoundedUtf8(request,1024);if('error' in body)return privateJson({error:body.error},413);
  let password;try {password=JSON.parse(body.text).password;} catch {return privateJson({error:'invalid payload'},400);}
  try {return await setPassword(runtime(),password);} catch {return privateJson({error:'設定未儲存，請重試'},503);}
}
