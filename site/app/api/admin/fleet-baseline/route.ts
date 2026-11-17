import {adminAuthorized,controllerAuthorized,noStoreJson,runtime} from '../../../../lib/cloud';
import {readFleetBaseline} from '../../../../lib/fleet-baseline-read.mjs';
import {readFleetLevelInventory} from '../../../../lib/fleet-policy-read.mjs';
let readInFlight=false;

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
  const params=new URL(request.url).searchParams,view=params.get('view')??'baseline';
  if(params.getAll('view').length>1||!['baseline','policy'].includes(view)||
    [...params.keys()].some(k=>!['view',...(view==='baseline'?['from','to']:[])].includes(k)))
    return respond({error:'invalid_parameters',activation_ready:false},400);
  // Bound this report's transient memory in one isolate; do not queue/retry.
  if(readInFlight)return respond({error:'baseline read busy',activation_ready:false},503);
  readInFlight=true;
  try {
    const {status,body}=view==='policy'
      ?await readFleetLevelInventory(env.DB,Date.now())
      :await readFleetBaseline(env.DB,params,Date.now());
    return respond(body,status);
  } finally {readInFlight=false;}
}
