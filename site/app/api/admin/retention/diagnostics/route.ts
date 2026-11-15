import {adminAuthorized,runtime} from '../../../../../lib/cloud';
import {privateJson} from '../../../../../lib/gps-access.mjs';
import {diagnoseHistoryJobs} from '../../../../../lib/history-retention-diagnostics.mjs';

// Explicit owner-only read. No ensureSchema, controller fallback, or SQL input.
export async function GET(request:Request) {
 if(!adminAuthorized(request))return privateJson({error:'forbidden'},403);
 const params=new URL(request.url).searchParams;
 if([...params.keys()].some(key=>key!=='after')||params.getAll('after').length>1)
  return privateJson({error:'invalid_parameters'},400);
 const raw=params.get('after')??'0',after=Number(raw);
 if(!/^(0|[1-9][0-9]{0,15})$/.test(raw)||!Number.isSafeInteger(after))
  return privateJson({error:'invalid_cursor'},400);
 try {return privateJson(await diagnoseHistoryJobs(runtime().DB,after));}
 catch {return privateJson({error:'diagnostics_unavailable'},503);}
}
