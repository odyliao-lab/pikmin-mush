// Additional retention is isolated from game/auth/upload state. All identifiers
// originate in this allowlist, never in a request. Epochs exposed by this module
// are milliseconds; legacy mushroom timestamps are converted explicitly.
export const DAY = 86_400_000;
export const DRY_RUN_MS = 2 * DAY;
export const BACKUP_MS = 7 * DAY;
const POLICY = 'history-retention-v1-policy';
const LEASE = 'history-retention-v1-run';
export const CATCH_UP_TARGET = 10000;
export const CATCH_UP_ROWS = 100000;
export const ARCHIVE_BATCH_ROWS = 5000;
export const ARCHIVE_BATCH_BYTES = 2 * 1024 * 1024;
const LOCK_MS = 300000;
const pendingOf = tables => tables.filter(t=>t.managed==='extended'||t.managed==='backup').reduce((n,t)=>n+Number(t.eligible_count||0),0);

const closedJob = `job_id IN (SELECT id FROM scan_jobs WHERE
  status IN ('completed','cancelled','failed') AND finished_at>0 AND finished_at<?
  AND NOT EXISTS (SELECT 1 FROM scan_targets t WHERE t.job_id=scan_jobs.id
    AND t.status IN ('queued','leased')))`;
export const RULES = [
  {table:'scan_agent_events',key:'id',time:'at',days:14,batch:500},
  {table:'agent_power_pauses',key:'key',time:'resumed_at',days:30,batch:250,
    where:'resumed_at IS NOT NULL AND resumed_at<? AND received_at<?',bindings:2},
  {table:'copy_audit_events',key:'id',time:'at',days:30,scale:1000,batch:250},
  {table:'public_usage_events',key:'id',time:'at',days:30,scale:1000,batch:250},
  {table:'report_audit_events',key:'key',time:'at',days:30,batch:250,
    where:`at<? AND NOT EXISTS (SELECT 1 FROM scan_targets t
      WHERE t.verification_batch=report_audit_events.batch AND t.status IN ('queued','leased'))`},
  {table:'scan_logs',key:'id',time:'at',days:30,batch:250,
    where:`${closedJob} AND at<?`,bindings:2},
  {table:'scan_targets',key:'id',time:'updated_at',days:30,batch:250,
    where:`${closedJob} AND status IN ('completed','failed','cancelled') AND updated_at<?`,bindings:2},
  {table:'scan_rotation_runs',key:'schedule_date',time:'updated_at',days:90,batch:100,
    where:`updated_at<? AND status IN ('completed','failed')
      AND NOT EXISTS (SELECT 1 FROM scan_jobs j WHERE j.id=job_id
        AND j.status IN ('queued','running','paused'))`},
  {table:'scan_jobs',key:'id',time:'finished_at',days:30,batch:5,
    where:`finished_at>0 AND finished_at<? AND status IN ('completed','cancelled','failed')
      AND id<>(SELECT MAX(id) FROM scan_jobs)
      AND NOT EXISTS (SELECT 1 FROM scan_targets t WHERE t.job_id=scan_jobs.id)
      AND NOT EXISTS (SELECT 1 FROM scan_logs l WHERE l.job_id=scan_jobs.id)
      AND NOT EXISTS (SELECT 1 FROM scan_target_history h WHERE h.job_id=scan_jobs.id)
      AND NOT EXISTS (SELECT 1 FROM scan_rotation_runs r WHERE r.job_id=scan_jobs.id)`},
].map(rule=>({...rule,managed:'extended'}));
export const INVENTORY = [
  {table:'mushrooms',time:'last_seen',days:7,scale:1000,managed:'existing'},
  {table:'mushroom_observations',time:'received_at',days:7,scale:1000,managed:'existing'},
  {table:'scan_target_history',time:'archived_at',days:8,managed:'existing'},
  ...RULES.map(r=>({...r,managed:'extended'})),
  ...['mushroom_challenges','mushroom_locations','agent_upload_receipts']
    .map(table=>({table,days:null,managed:'protected'})),
  {table:'retention_backups',time:'archived_at',days:7,managed:'backup'},
];
const identifier = name => `"${name.replaceAll('"','""')}"`;
function predicate(rule, now) {
  const cutoff = Math.floor((now-rule.days*DAY)/(rule.scale||1));
  return {sql:rule.where||`${rule.time}<?`,args:Array(rule.bindings||1).fill(cutoff)};
}

export async function readHistoryRetention(db, now=Date.now()) {
  const policy=await db.prepare('SELECT last_run_at FROM maintenance_state WHERE name=?').bind(POLICY).first();
  const rows=await db.prepare('SELECT * FROM retention_table_stats ORDER BY table_name').all();
  const run=await db.prepare('SELECT * FROM maintenance_state WHERE name=?').bind(LEASE).first();
  const started=Number(policy?.last_run_at||0), activatesAt=started ? started+DRY_RUN_MS : 0;
  return {mode:!started?'not_started':now<activatesAt?'dry_run':'active',startedAt:started,
    activatesAt,backupDays:7,statisticsMaxAgeHours:24,
    lastRunAt:Number(run?.last_run_at||0),lastSucceededAt:Number(run?.last_succeeded_at||0),
    consecutiveFailures:Number(run?.consecutive_failures||0),lastDurationMs:Number(run?.last_duration_ms||0),
    pendingTotal:pendingOf(rows.results.map(r=>({...r,managed:RULES.some(t=>t.table===r.table_name)?'extended':r.table_name==='retention_backups'?'backup':''}))),
    targetPending:CATCH_UP_TARGET,deletedLastRun:Number(run?.last_deleted||0),
    databaseBytes:rows.results.reduce((n,r)=>Math.max(n,Number(r.database_bytes||0)),0)||null,
    tables:INVENTORY.map(rule=>({table:rule.table,policyDays:rule.days,managed:rule.managed,
      ...(rows.results.find(r=>r.table_name===rule.table)||{})})),
    protectedTables:['mushroom_challenges','mushroom_locations','agent_upload_receipts'],
    note:'Counts are cached snapshots, not upload totals. Protected identities and receipt anchors are not expired.'};
}

// D1 batches are atomic: backup failure rolls back the deletion. JSON is built
// from the actual table schema so additive columns survive restore. Payloads are
// never returned by an HTTP endpoint or written to logs. Oversize rows stay live.
export async function archiveAndPrune(db, rule, now, limit, context={}) {
  if(!RULES.includes(rule)) throw Error('retention table not allowed');
  if(!Number.isSafeInteger(limit)||limit<1||limit>ARCHIVE_BATCH_ROWS)throw Error('invalid retention batch');
  const columns=context.columns||(await db.prepare(`PRAGMA table_info(${identifier(rule.table)})`).all()).results;
  if(!columns.length) throw Error('retention table schema unavailable');
  const json=`json_object(${columns.map(c=>`'${c.name.replaceAll("'","''")}',${identifier(c.name)}`).join(',')})`;
  const p=predicate(rule,now), key=identifier(rule.key), table=identifier(rule.table);
  const guard=context.owner?` AND EXISTS(SELECT 1 FROM history_retention_lock WHERE id=1 AND owner=? AND expires_at>?)`:'';
  const guardArgs=context.owner?[context.owner,context.clock?context.clock():Date.now()]:[];
  // Bound BOTH row count and aggregate recovery JSON. A large row can never
  // turn a nominal 5k batch into a multi-gigabyte write transaction.
  const select=`SELECT row_key FROM (SELECT row_key,
    SUM(row_bytes) OVER(ORDER BY row_time,row_key) AS total_bytes FROM (
      SELECT ${key} AS row_key,${identifier(rule.time)} AS row_time,
        length(CAST(${json} AS BLOB)) AS row_bytes FROM ${table} WHERE ${p.sql}
        AND length(CAST(${json} AS BLOB))<=500000${guard}
        ORDER BY ${identifier(rule.time)},${key} LIMIT ?)) WHERE total_bytes<=${ARCHIVE_BATCH_BYTES}`;
  const token=crypto.randomUUID();
  const result=await db.batch([
    db.prepare(`INSERT INTO retention_backups(table_name,row_key,row_json,archived_at,expires_at,batch_id)
      SELECT ?,CAST(${key} AS TEXT),${json},?,?,? FROM ${table} WHERE ${key} IN (${select})
      ON CONFLICT(table_name,row_key) DO UPDATE SET row_json=excluded.row_json,
        archived_at=excluded.archived_at,expires_at=excluded.expires_at,batch_id=excluded.batch_id`)
      .bind(rule.table,now,now+BACKUP_MS,token,...p.args,...guardArgs,limit),
    db.prepare(`DELETE FROM ${table} WHERE ${p.sql}${guard} AND CAST(${key} AS TEXT) IN
      (SELECT row_key FROM retention_backups WHERE table_name=? AND batch_id=? AND expires_at>?)`)
      .bind(...p.args,...guardArgs,rule.table,token,now),
  ]);
  return Number(result[1].meta.changes||0);
}

// Operator/library operation only, deliberately not exposed as an HTTP write.
// Restoring an already-present key must never overwrite a newer live record.
export async function restoreRetentionBackup(db, table, rowKey, now=Date.now()) {
  if(!RULES.some(rule=>rule.table===table)) throw Error('retention table not allowed');
  const backup=await db.prepare(`SELECT row_json FROM retention_backups
    WHERE table_name=? AND row_key=? AND expires_at>?`).bind(table,String(rowKey),now).first();
  if(!backup) return false;
  const row=JSON.parse(backup.row_json);
  const columns=(await db.prepare(`PRAGMA table_info(${identifier(table)})`).all()).results.map(c=>c.name);
  const present=columns.filter(name=>Object.hasOwn(row,name));
  const result=await db.prepare(`INSERT OR IGNORE INTO ${identifier(table)}
    (${present.map(identifier).join(',')}) VALUES (${present.map(()=>'?').join(',')})`)
    .bind(...present.map(name=>row[name])).run();
  return Number(result.meta.changes)>0;
}

export async function runHistoryRetention(db, now=Date.now(), options={}) {
  const clock=options.clock||Date.now, began=clock();
  await db.prepare('INSERT OR IGNORE INTO maintenance_state(name,last_run_at) VALUES (?,?)').bind(POLICY,now).run();
  await db.prepare('INSERT OR IGNORE INTO maintenance_state(name) VALUES (?)').bind(LEASE).run();
  await db.prepare(`INSERT OR IGNORE INTO history_retention_lock(id,owner,expires_at,last_started_at) VALUES(1,'',0,0)`).run();
  const owner=crypto.randomUUID();
  // Respect a recent legacy invocation during a rolling deploy. New invocations
  // release the owner lock on completion, so operators need not wait five minutes.
  const claim=await db.prepare(`UPDATE history_retention_lock SET owner=?,expires_at=?,last_started_at=?
    WHERE id=1 AND expires_at<=? AND NOT EXISTS(SELECT 1 FROM maintenance_state
      WHERE name=? AND last_run_at>? AND last_run_at<>history_retention_lock.last_started_at)`)
    .bind(owner,now+LOCK_MS,now,now,LEASE,now-LOCK_MS).run();
  if(!claim.meta.changes)return {...await readHistoryRetention(db,now),busy:true};
  await db.prepare('UPDATE maintenance_state SET last_run_at=? WHERE name=?').bind(now,LEASE).run();
  let runStage='policy',failed=false,totalDeleted=0,backupDeleted=0;
  const owned=async()=>!!await db.prepare('SELECT id FROM history_retention_lock WHERE id=1 AND owner=? AND expires_at>?')
    .bind(owner,clock()).first();
  try {
    const initial=await readHistoryRetention(db,now);
    const dryRun=initial.mode==='dry_run';
    const catchUp=!dryRun&&(options.catchUp===true||initial.pendingTotal>CATCH_UP_TARGET||
      initial.tables.some(t=>t.managed==='backup'&&Number(t.eligible_count)>CATCH_UP_TARGET));
    const maxRows=catchUp?CATCH_UP_ROWS:2000;
    const maxMs=Math.min(options.maxMs??15000,15000);
    const inBudget=()=>clock()-began<maxMs;
    const depleted=new Set(),columns=new Map(),deleted=new Map(),tableErrors=new Map();
    runStage='backup_expiry';
    const expiry=await db.prepare(`DELETE FROM retention_backups WHERE (table_name,row_key) IN
      (SELECT table_name,row_key FROM retention_backups WHERE expires_at<? ORDER BY expires_at LIMIT ?)
      AND EXISTS(SELECT 1 FROM history_retention_lock WHERE id=1 AND owner=? AND expires_at>?)`)
      .bind(now,catchUp?10000:2000,owner,clock()).run();
    backupDeleted=Number(expiry.meta.changes||0);
    const offset=Math.floor(now/900000)%RULES.length;
    const ordered=[...RULES.slice(offset),...RULES.slice(0,offset)];
    // Every table gets a turn before another round: large events cannot starve
    // terminal targets or guarded parent jobs. Count inventory once after work.
    if(!dryRun)do {
      let progress=0;
      for(const rule of ordered) {
        if(!inBudget()||totalDeleted>=maxRows)break;
        if(depleted.has(rule.table))continue;
        if(!await owned())throw Error('retention lease lost');
        try {
          if(!columns.has(rule.table))columns.set(rule.table,(await db.prepare(`PRAGMA table_info(${identifier(rule.table)})`).all()).results);
          const n=await archiveAndPrune(db,rule,now,Math.min(catchUp?ARCHIVE_BATCH_ROWS:rule.batch,maxRows-totalDeleted),
            {owner,clock,columns:columns.get(rule.table)});
          totalDeleted+=n;progress+=n;deleted.set(rule.table,(deleted.get(rule.table)||0)+n);
          if(n===0&&rule.table!=='scan_jobs')depleted.add(rule.table); // byte-limited partial batches may still have work
        }catch {
          failed=true;depleted.add(rule.table);tableErrors.set(rule.table,'archive_and_delete');
          await db.prepare(`INSERT INTO retention_table_stats(table_name,checked_at,last_error) VALUES (?,?,'archive_and_delete')
            ON CONFLICT(table_name) DO UPDATE SET checked_at=excluded.checked_at,last_error='archive_and_delete'`).bind(rule.table,now).run();
        }
      }
      if(!progress)break;
    }while(inBudget()&&totalDeleted<maxRows);
    runStage='inventory';
    // Accurate backlog for all modified tables even if the deletion budget was
    // reached. Untouched inventory rotates on ordinary scheduled maintenance.
    const inventory=[...ordered,...INVENTORY.filter(r=>r.managed!=='extended')];
    for(const rule of inventory) {
      if(!deleted.has(rule.table)&&!inBudget())continue;
      if(!await owned())throw Error('retention lease lost');
      let stage='inventory';
      try {
        const old=await db.prepare('SELECT * FROM retention_table_stats WHERE table_name=?').bind(rule.table).first();
        let count=old?.row_count??null,countedAt=Number(old?.counted_at||0),bytes=old?.database_bytes??null;
        let previousCount=old?.previous_row_count??null,previousAt=old?.previous_counted_at??null;
        if(!countedAt||now-countedAt>=DAY) {
          const census=await db.prepare(`SELECT COUNT(*) AS total FROM ${identifier(rule.table)}`).all();
          previousCount=count;previousAt=countedAt||null;count=Number(census.results[0].total);countedAt=now;
          if(Number(census.meta?.size_after)>0)bytes=Number(census.meta.size_after);
        }
        stage='backlog';let eligible=0,oldest=null;
        if(rule.days!==null) {
          const p=predicate(rule,now);
          const row=await db.prepare(`SELECT COUNT(*) AS count,MIN(${identifier(rule.time)}) AS oldest FROM ${identifier(rule.table)} WHERE ${p.sql}`).bind(...p.args).first();
          eligible=Number(row.count);oldest=row.oldest===null?null:Number(row.oldest)*(rule.scale||1);
        }
        await db.prepare(`INSERT INTO retention_table_stats
          (table_name,row_count,counted_at,previous_row_count,previous_counted_at,eligible_count,oldest_eligible_at,deleted_last_run,checked_at,last_error,database_bytes)
          VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(table_name) DO UPDATE SET row_count=excluded.row_count,counted_at=excluded.counted_at,
          previous_row_count=excluded.previous_row_count,previous_counted_at=excluded.previous_counted_at,
          eligible_count=excluded.eligible_count,oldest_eligible_at=excluded.oldest_eligible_at,
          deleted_last_run=excluded.deleted_last_run,checked_at=excluded.checked_at,last_error=excluded.last_error,database_bytes=excluded.database_bytes`)
          .bind(rule.table,count,countedAt,previousCount,previousAt,eligible,oldest,(rule.managed==='backup'?backupDeleted:deleted.get(rule.table)||0),now,tableErrors.get(rule.table)||'',bytes).run();
      }catch {
        failed=true;
        await db.prepare(`INSERT INTO retention_table_stats(table_name,checked_at,last_error) VALUES(?,?,?)
          ON CONFLICT(table_name) DO UPDATE SET checked_at=excluded.checked_at,last_error=excluded.last_error`).bind(rule.table,now,stage).run();
      }
    }
    runStage='backlog';const snapshot=await readHistoryRetention(db,now),pending=dryRun?0:snapshot.pendingTotal;
    await db.prepare(`INSERT OR IGNORE INTO maintenance_state(name) VALUES('history-retention-v1-backlog')`).run();
    await db.prepare(`UPDATE maintenance_state SET last_run_at=CASE WHEN ?=0 THEN 0 WHEN last_run_at=0 THEN ? ELSE last_run_at END
      WHERE name='history-retention-v1-backlog'`).bind(pending,now).run();
    runStage='recovery_count';
    const recoveryRows=totalDeleted?Number((await db.prepare('SELECT COUNT(*) AS n FROM retention_backups WHERE archived_at=?').bind(now).first()).n):0;
    if(recoveryRows<totalDeleted)throw Error('retention recovery count mismatch');
    runStage='state';
    await db.prepare(`UPDATE maintenance_state SET pending=?,last_deleted=?,
      last_succeeded_at=CASE WHEN ? THEN last_succeeded_at ELSE ? END,last_failed_at=CASE WHEN ? THEN ? ELSE last_failed_at END,
      consecutive_failures=CASE WHEN ? THEN consecutive_failures+1 ELSE 0 END,last_duration_ms=?,last_failure_stage=?
      WHERE name=? AND last_run_at=? AND EXISTS(SELECT 1 FROM history_retention_lock WHERE id=1 AND owner=? AND expires_at>?)`)
      .bind(pending,totalDeleted,failed?1:0,now,failed?1:0,now,failed?1:0,clock()-began,failed?'tables':'',LEASE,now,owner,clock()).run();
    return {...await readHistoryRetention(db,now),busy:false,run:{profile:catchUp?'catch_up':'routine',deleted:totalDeleted,expiredBackupsDeleted:backupDeleted,recoveryRows,maxRows}};
  }catch(error) {
    failed=true;
    try {await db.prepare(`UPDATE maintenance_state SET last_failed_at=?,consecutive_failures=consecutive_failures+1,
      last_failure_stage=?,last_duration_ms=? WHERE name=? AND last_run_at=?
      AND EXISTS(SELECT 1 FROM history_retention_lock WHERE id=1 AND owner=?)`)
      .bind(now,runStage,clock()-began,LEASE,now,owner).run();}catch { /* retain prior success */ }
    throw error;
  }finally {
    // Failed passes retain the five-minute backoff; only successful owners release early.
    if(!failed)await db.prepare(`UPDATE history_retention_lock SET owner='',expires_at=0 WHERE id=1 AND owner=?`).bind(owner).run();
  }
}
