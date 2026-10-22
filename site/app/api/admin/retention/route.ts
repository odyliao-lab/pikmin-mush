import {adminAuthorized,controllerAuthorized,ensureSchema,noStoreJson,runtime} from '../../../../lib/cloud';
import {readHistoryRetention} from '../../../../lib/history-retention.mjs';

// Cached inventory only. No query-string SQL, refresh switch or write action.
export async function GET(request:Request) {
  if(!adminAuthorized(request)&&!controllerAuthorized(request)) return noStoreJson({error:'forbidden'},403);
  await ensureSchema();
  return noStoreJson(await readHistoryRetention(runtime().DB));
}
