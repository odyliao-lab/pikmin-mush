import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';
import {DAY, DRY_RUN_MS, runHistoryRetention, readHistoryRetention, restoreRetentionBackup} from '../../lib/history-retention.mjs';

const NOW = 1_800_000_000_000;
const LEASE = 'history-retention-v1-run';
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
function fixture(t) {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../drizzle', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) {
    sql.exec(readFileSync(new URL('../../drizzle/' + file, import.meta.url), 'utf8'));
  }
  t.after(() => sql.close());
  const hooks = {beforeRun: async () => {}, batches: 0};
  const db = {prepare(query) { return {query, args: [], bind(...args) { this.args = args; return this; },
    async first() { return sql.prepare(query).get(...this.args); },
    async all() { return {results: sql.prepare(query).all(...this.args)}; },
    async run() { await hooks.beforeRun(query, this.args); return {meta: sql.prepare(query).run(...this.args)}; }
  }; }, async batch(statements) {
    hooks.batches++;
    sql.exec('BEGIN');
    try {
      const results = statements.map(s => ({meta: sql.prepare(s.query).run(...s.args)}));
      sql.exec('COMMIT'); return results;
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
  }};
  sql.prepare('INSERT INTO maintenance_state(name,last_run_at) VALUES (?,?)')
    .run('history-retention-v1-policy', NOW - DRY_RUN_MS);
  return {sql, db, hooks};
}
function holdBackupExpiry(f) {
  const entered = deferred(), released = deferred();
  let once = false;
  f.hooks.beforeRun = async query => {
    if (!once && query.startsWith('DELETE FROM retention_backups')) {
      once = true; entered.resolve(); await released.promise;
    }
  };
  return {entered: entered.promise, release: released.resolve};
}
function oldEvent(f) {
  f.sql.prepare("INSERT INTO scan_agent_events(agent_id,event_type,at) VALUES ('primary','upload',?)")
    .run(NOW - 20 * DAY);
}

function maintenanceRoute(f, historyOverride) {
  const exports = {};
  const healthy = {lastSucceededAt: NOW / 1000, pending: 0, consecutiveFailures: 0, lastBatchSaturated: false};
  class Clock extends Date { static now() { return NOW; } }
  const source = readFileSync(new URL('../../app/api/controller/maintenance/route.ts', import.meta.url), 'utf8');
  new Script(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports, Date: Clock,
    fetch() { throw Error('External network forbidden in local maintenance tests'); },
    require(path) {
    if (path.endsWith('/history-retention.mjs')) return {
      runHistoryRetention: db => historyOverride ?? runHistoryRetention(db, NOW), readHistoryRetention: db => readHistoryRetention(db, NOW),
    };
    if (path.endsWith('/cloud')) return {
      maintenanceAuthorized: () => true, controllerAuthorized: () => false, ensureSchema: async () => {},
      runtime: () => ({DB: f.db}), runMushroomRetention: async () => healthy,
      readMushroomRetentionStatus: async () => healthy,
      checkMaintenanceHealth: async () => ({severity: 'healthy'}),
      noStoreJson: (body, status = 200) => Response.json(body, {status, headers: {'cache-control': 'no-store'}}),
    };
    throw Error('unexpected import: ' + path);
  }});
  return exports;
}

export {fixture, NOW, LEASE, holdBackupExpiry, oldEvent, maintenanceRoute};
