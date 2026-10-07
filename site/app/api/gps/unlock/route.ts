import {runtime,readBoundedUtf8} from '../../../../lib/cloud';
import {browserWrite,privateJson,unlock} from '../../../../lib/gps-access.mjs';
export async function POST(request: Request) {
  if(!browserWrite(request))return privateJson({error:'forbidden'},403);
  const body=await readBoundedUtf8(request,1024);
  if('error' in body)return privateJson({error:body.error},413);
  let password;try { password=JSON.parse(body.text).password; } catch {return privateJson({error:'invalid payload'},400);}
  try {return await unlock(request,runtime(),password);} catch {return privateJson({error:'GPS 解鎖暫時不可用'},503);}
}
