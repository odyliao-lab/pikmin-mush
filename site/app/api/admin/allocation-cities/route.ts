import {adminAuthorized,controllerAuthorized,ensureSchema,noStoreJson,runtime} from '../../../../lib/cloud';
import {comparisonWindow,buildCityComparison} from '../../../../lib/allocation-comparison.mjs';

export async function GET(request:Request) {
  if(!adminAuthorized(request)&&!controllerAuthorized(request))return noStoreJson({error:'forbidden'},403);
  await ensureSchema();
  const db=runtime().DB,now=Date.now();
  const epoch=await db.prepare("SELECT last_run_at FROM maintenance_state WHERE name='allocation-history-v2'").first<{last_run_at:number}>();
  if(!epoch?.last_run_at)return noStoreJson({error:'corrected history not initialized'},503);
  let window;
  try{window=comparisonWindow(new URL(request.url).searchParams,now,Number(epoch.last_run_at));}
  catch{return noStoreJson({error:'Provide a 1h–7d from/to millisecond window within corrected history'},400);}
  return noStoreJson(await buildCityComparison(db,window));
}
