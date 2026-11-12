import {adminAuthorized,controllerAuthorized,ensureSchema,runtime,readBoundedUtf8} from '../../../../lib/cloud';
import {browserWrite,privateJson} from '../../../../lib/gps-access.mjs';
import {readMushroomLevelPolicy,archiveExcludedMushrooms} from '../../../../lib/mushroom-level-cleanup.mjs';

export async function GET(request:Request) {
  if (!adminAuthorized(request)&&!controllerAuthorized(request)) return privateJson({error:'forbidden'},403);
  await ensureSchema();
  return privateJson(await readMushroomLevelPolicy(runtime().DB));
}

export async function POST(request:Request) {
  if (!adminAuthorized(request)||!browserWrite(request)) return privateJson({error:'forbidden'},403);
  const body=await readBoundedUtf8(request,256);
  if ('error' in body) return privateJson({error:'payload too large'},413);
  try {
    const input=JSON.parse(body.text);
    if (!input||input.action!=='archive-excluded'||Object.keys(input).length!==1) throw Error();
  } catch {return privateJson({error:'invalid action'},400);}
  await ensureSchema();
  const db=runtime().DB;
  let stage='archive_mushrooms';
  try {
    const batches=[];
    for (const table of ['mushrooms','mushroom_observations']) {
      stage=`archive_${table}`;batches.push(await archiveExcludedMushrooms(db,table));
    }
    // Successful committed work must not be reported as failed because a later
    // full inventory read hit a separate database/request limit. GET owns that
    // inventory; the client verifies it before declaring cleanup complete.
    return privateJson({ok:true,batches});
  } catch (error) {
    const message=String((error as {message?:unknown})?.message??error??'');
    const reason=/too many sql variables/i.test(message)?'sql_variables'
      :/busy|locked/i.test(message)?'database_busy'
      :/subrequest|quota|rate.limit|too many requests/i.test(message)?'request_limit'
      :/time|duration|CPU/i.test(message)?'database_timeout'
      :/too big|too large|size|memory/i.test(message)?'database_limit'
      :/constraint/i.test(message)?'database_constraint'
      :/no such|schema|column/i.test(message)?'database_schema':'database_error';
    console.warn(JSON.stringify({event:'mushroom_level_cleanup_failed',stage,reason}));
    return privateJson({error:'cleanup stopped; committed batches remain recoverable',stage,reason},503);
  }
}
