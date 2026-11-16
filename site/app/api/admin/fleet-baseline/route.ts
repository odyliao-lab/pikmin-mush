import {adminAuthorized,controllerAuthorized,noStoreJson,runtime} from '../../../../lib/cloud';
import {readFleetBaseline} from '../../../../lib/fleet-baseline-read.mjs';

function respond(body:unknown,status:number) {
  const response=noStoreJson(body,status);
  response.headers.set('Cache-Control','private, no-store');
  return response;
}

export async function GET(request:Request) {
  if(!adminAuthorized(request)&&!controllerAuthorized(request))
    return respond({error:'forbidden'},403);
  const env=runtime();
  // Explicit opt-in after query/memory profiling and release authorization.
  if(env.FLEET_BASELINE_READ_ENABLED!=='1')
    return respond({error:'baseline read candidate disabled',activation_ready:false},503);
  const {status,body}=await readFleetBaseline(env.DB,new URL(request.url).searchParams,Date.now());
  return respond(body,status);
}
