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
  try {
    const batches=[];
    for (const table of ['mushrooms','mushroom_observations']) batches.push(await archiveExcludedMushrooms(db,table));
    return privateJson({ok:true,batches,policy:await readMushroomLevelPolicy(db)});
  } catch {return privateJson({error:'cleanup stopped; committed batches remain recoverable'},503);}
}
