import {controllerAuthorized,noStoreJson,readBoundedUtf8,runtime} from '../../../../lib/cloud';
import {cleanReportAudit} from '../../../../lib/report-audit.mjs';
export async function POST(request:Request){
 if(!controllerAuthorized(request))return noStoreJson({error:'unauthorized'},401);
 const input=await readBoundedUtf8(request,64*1024);
 if('error' in input)return noStoreJson({error:input.error},413);
 let event;try{event=cleanReportAudit(JSON.parse(input.text));}catch{return noStoreJson({error:'invalid audit'},400);}
 const db=runtime().DB;
 await db.batch([
  db.prepare(`INSERT INTO report_audit_events(key,batch,phase,kind,at,payload) VALUES(?,?,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET at=excluded.at,payload=excluded.payload WHERE excluded.at>report_audit_events.at`)
    .bind(event.key,event.batch,event.phase,event.kind,event.at,JSON.stringify(event)),
 ]);
 return noStoreJson({ok:true,key:event.key});
}
