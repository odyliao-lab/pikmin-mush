import {controllerAuthorized, ensureSchema, noStoreJson, runtime} from '../../../../lib/cloud';
import {REPORT_CANDIDATES_SQL} from '../../../../lib/report-evidence.mjs';

export async function GET(request: Request) {
  if (!controllerAuthorized(request)) return noStoreJson({error:'unauthorized'},401);
  const p = new URL(request.url).searchParams;
  const from = Number(p.get('from')), to = Number(p.get('to')), level = Number(p.get('level'));
  const cursor = p.get('cursor') || '';
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to <= from ||
      to-from>48*3600 || to>Math.floor(Date.now()/1000)+1 || ![3,4].includes(level) || cursor.length>600)
    return noStoreJson({error:'invalid window, level or cursor'},400);
  await ensureSchema();
  const result = await runtime().DB.prepare(REPORT_CANDIDATES_SQL)
    .bind(from,to,cursor,level,Date.now()).all<Record<string,unknown>>();
  const rows = result.results.slice(0,500);
  return noStoreJson({contract:2,rows,next_cursor:result.results.length>500 ? rows.at(-1)?.challenge_key : null});
}
