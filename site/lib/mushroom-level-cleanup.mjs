import { MUSHROOM_DATA_POLICY } from './mushroom-policy.mjs';

const TABLES = {mushrooms:'id',mushroom_observations:'key'};
const EXCLUDED = 'level NOT IN (3,4)';
const BACKUP_DAYS = 7;
const MAX_BYTES = 2 * 1024 * 1024;
const PREFIX = `${MUSHROOM_DATA_POLICY}:`;
const ident = value => `"${value.replaceAll('"','""')}"`;

export async function readMushroomLevelPolicy(db, now=Date.now()) {
  const counts = {};
  for (const table of Object.keys(TABLES)) {
    const result = await db.prepare(`SELECT level,COUNT(*) AS count FROM ${table} GROUP BY level`).all();
    const byLevel = Object.fromEntries(result.results.map(row=>[String(row.level),Number(row.count)]));
    counts[table] = {byLevel,excluded:result.results.reduce((n,row)=>n+([3,4].includes(Number(row.level))?0:Number(row.count)),0)};
  }
  const backups = await db.prepare(`SELECT table_name,COUNT(*) AS count FROM retention_backups
    WHERE batch_id LIKE ? AND expires_at>? GROUP BY table_name`).bind(`${PREFIX}%`,now).all();
  return {policy:MUSHROOM_DATA_POLICY,retainedLevels:[3,4],backupDays:BACKUP_DAYS,tables:counts,
    excludedTotal:Object.values(counts).reduce((n,table)=>n+table.excluded,0),
    backups:Object.fromEntries(backups.results.map(row=>[row.table_name,Number(row.count)]))};
}

// The allowlisted snapshot and observation rows are backed up and removed in
// one D1 transaction. Identities, receipts, leases and Agent state are untouched.
export async function archiveExcludedMushrooms(db, table, now=Date.now(), limit=5000) {
  if (!Object.hasOwn(TABLES,table)) throw Error('cleanup table not allowed');
  if (!Number.isInteger(limit)||limit<1||limit>5000) throw Error('invalid cleanup limit');
  const columns = (await db.prepare(`PRAGMA table_info(${table})`).all()).results;
  if (!columns.length) throw Error('cleanup schema missing');
  const key=ident(TABLES[table]);
  const json=`json_object(${columns.map(c=>`'${c.name.replaceAll("'","''")}',${ident(c.name)}`).join(',')})`;
  const selected=`SELECT row_key FROM (SELECT row_key,SUM(row_bytes) OVER(ORDER BY row_key) AS bytes
    FROM (SELECT ${key} AS row_key,length(CAST(${json} AS BLOB)) AS row_bytes FROM ${table}
      WHERE ${EXCLUDED} AND length(CAST(${json} AS BLOB))<=500000 ORDER BY ${key} LIMIT ?)) WHERE bytes<=${MAX_BYTES}`;
  const batch = PREFIX + crypto.randomUUID();
  const result = await db.batch([
    db.prepare(`INSERT INTO retention_backups(table_name,row_key,row_json,archived_at,expires_at,batch_id)
      SELECT ?,CAST(${key} AS TEXT),${json},?,?,? FROM ${table} WHERE ${key} IN (${selected})
      ON CONFLICT(table_name,row_key) DO UPDATE SET row_json=excluded.row_json,
        archived_at=excluded.archived_at,expires_at=excluded.expires_at,batch_id=excluded.batch_id`)
      .bind(table,now,now+BACKUP_DAYS*86400000,batch,limit),
    db.prepare(`DELETE FROM ${table} WHERE ${EXCLUDED} AND CAST(${key} AS TEXT) IN
      (SELECT row_key FROM retention_backups WHERE table_name=? AND batch_id=? AND expires_at>?)`)
      .bind(table,batch,now),
  ]);
  return {table,backedUp:Number(result[0].meta.changes||0),deleted:Number(result[1].meta.changes||0)};
}

// Operator-only recovery: first deploy a compatible policy rollback. This is
// deliberately not exposed as an HTTP write and never overwrites a newer row.
export async function restoreMushroomLevelBackup(db, table, rowKey, now=Date.now()) {
  if (!Object.hasOwn(TABLES,table)) throw Error('restore table not allowed');
  const backup=await db.prepare(`SELECT row_json FROM retention_backups WHERE table_name=?
    AND row_key=? AND batch_id LIKE ? AND expires_at>?`).bind(table,String(rowKey),`${PREFIX}%`,now).first();
  if (!backup) return false;
  const row=JSON.parse(backup.row_json);
  const columns=(await db.prepare(`PRAGMA table_info(${table})`).all()).results.map(c=>c.name).filter(c=>Object.hasOwn(row,c));
  const result=await db.prepare(`INSERT OR IGNORE INTO ${table} (${columns.map(ident).join(',')})
    VALUES (${columns.map(()=>'?').join(',')})`).bind(...columns.map(c=>row[c])).run();
  return Number(result.meta.changes)>0;
}
