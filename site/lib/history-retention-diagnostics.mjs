import {DAY} from './history-retention.mjs';

// Fixed scan_jobs schema only: schema drift fails closed rather than measuring
// an incomplete recovery record. No row payload or caller SQL leaves D1.
const COLUMNS = ['id','status','config_json','plan_json','total_points','current_index','cycle','loop',
  'captured_rows','captured_bytes','current_country','current_city','current_lat','current_lng',
  'message','created_at','updated_at','started_at','finished_at'];
const TEXT_COLUMNS = ['status','config_json','plan_json','current_country','current_city','message'];
export const DIAGNOSTIC_ROWS = 5;
export const DIAGNOSTIC_JSON_BYTES = 2 * 1024 * 1024;
const JSON_OVERHEAD = 4096; // fixed keys and 13 numeric values, including numeric formatting
const ROW_BYTES = 500000;
const validTypes=COLUMNS.map(c=>`typeof("${c}") IN (${TEXT_COLUMNS.includes(c)?"'text','null'":"'integer','real','null'"})`).join(' AND ');
const rawBytes = TEXT_COLUMNS.map(c=>`COALESCE(length(CAST("${c}" AS BLOB)),0)`).join('+');
const json = `json_object(${COLUMNS.map(c=>`'${c}',"${c}"`).join(',')})`;
const category = `CASE
 WHEN NOT (${validTypes}) THEN 'unclassified_type'
 WHEN finished_at IS NULL OR finished_at<=0 OR finished_at>=? THEN 'retention_window'
 WHEN status IS NULL OR status NOT IN ('completed','cancelled','failed') THEN 'job_state'
 WHEN id=(SELECT MAX(id) FROM scan_jobs) THEN 'newest_job'
 WHEN EXISTS(SELECT 1 FROM scan_targets WHERE job_id=scan_jobs.id) THEN 'targets'
 WHEN EXISTS(SELECT 1 FROM scan_logs WHERE job_id=scan_jobs.id) THEN 'logs'
 WHEN EXISTS(SELECT 1 FROM scan_target_history WHERE job_id=scan_jobs.id) THEN 'history'
 WHEN EXISTS(SELECT 1 FROM scan_rotation_runs WHERE job_id=scan_jobs.id) THEN 'rotation'
 ELSE 'eligible' END`;

export async function diagnoseHistoryJobs(db, after=0, now=Date.now(), clock=Date.now) {
 if(!Number.isSafeInteger(after)||after<0)throw Error('invalid cursor');
 const started=clock();
 const result={scope:'job_id_page',snapshot:false,scanned:0,eligible:0,hasMore:false,nextCursor:null,
  truncated:false,stopReason:null,categories:{},rawTextBytes:{measuredRows:0,total:0,max:0},
  backupJsonBytes:{measuredRows:0,total:0,max:0},
  limits:{rows:DIAGNOSTIC_ROWS,jsonWorkBytes:DIAGNOSTIC_JSON_BYTES,rowBackupBytes:ROW_BYTES,maxMs:2000}};
 const timedOut=()=>clock()-started>=2000;
 const unfinished=()=>({...result,hasMore:true,nextCursor:after,truncated:true,stopReason:'time_budget'});
 if(timedOut())return unfinished();
 const schema=(await db.prepare('PRAGMA table_info("scan_jobs")').all()).results;
 if(schema.length!==COLUMNS.length||COLUMNS.some(c=>!schema.some(r=>r.name===c)))throw Error('diagnostic schema mismatch');
 if(timedOut())return unfinished();
 // Bound candidates BEFORE eligibility checks, even when every job is protected.
 const candidates=(await db.prepare('SELECT id FROM scan_jobs WHERE id>? ORDER BY id LIMIT 6').bind(after).all()).results;
 let cursor=after,remaining=DIAGNOSTIC_JSON_BYTES;
 const count=name=>{result.categories[name]=(result.categories[name]||0)+1;};
 for(const row of candidates.slice(0,DIAGNOSTIC_ROWS)) {
  if(timedOut()){result.stopReason='time_budget';break;}
  const state=await db.prepare(`SELECT ${category} AS category FROM scan_jobs WHERE id=?`).bind(now-30*DAY,row.id).first();
  cursor=row.id;result.scanned++;
  if(!state){count('changed_or_missing');continue;}
  if(state.category!=='eligible'){count(state.category);continue;}
  result.eligible++;
  if(timedOut()){count('size_unclassified_budget');result.stopReason='time_budget';break;}
  const size=await db.prepare(`SELECT CASE WHEN ${validTypes} THEN ${rawBytes} ELSE NULL END AS bytes FROM scan_jobs WHERE id=?`).bind(row.id).first();
  if(!size){count('changed_or_missing');continue;}
  if(size.bytes==null){count('unclassified_type');continue;}
  const bytes=Number(size.bytes);
  result.rawTextBytes.measuredRows++;result.rawTextBytes.total+=bytes;result.rawTextBytes.max=Math.max(result.rawTextBytes.max,bytes);
  // Raw text bytes are a lower bound, not a claimed exact JSON size.
  if(bytes>ROW_BYTES){count('oversize_raw_lower_bound');continue;}
  const available=Math.floor((remaining-JSON_OVERHEAD)/6);
  if(bytes>available||timedOut()){count('size_unclassified_budget');continue;}
  const allowance=bytes;
  const measured=await db.prepare(`SELECT (${validTypes}) AS types_valid,CASE WHEN (${validTypes}) AND (${rawBytes})<=? AND (${rawBytes})<=500000
    THEN length(CAST(${json} AS BLOB)) ELSE NULL END AS bytes FROM scan_jobs WHERE id=?`).bind(allowance,row.id).first();
  // SQL guards against concurrent growth using this same allowance. Reserve
  // its full worst case (six-byte escapes plus fixed fields), not stale size.
  remaining-=allowance*6+JSON_OVERHEAD;
  if(measured&& !measured.types_valid){count('unclassified_type');continue;}
  if(measured?.bytes==null){count('changed_or_size_unclassified');continue;}
  const exact=Number(measured.bytes);
  result.backupJsonBytes.measuredRows++;result.backupJsonBytes.total+=exact;result.backupJsonBytes.max=Math.max(result.backupJsonBytes.max,exact);
  count(exact>ROW_BYTES?'oversize_backup_json':'within_backup_row_limit');
 }
 result.hasMore=candidates.some(r=>r.id>cursor);
 result.nextCursor=result.hasMore?cursor:null;
 result.truncated=result.hasMore;
 if(result.hasMore&&!result.stopReason)result.stopReason='page_limit';
 return result;
}
