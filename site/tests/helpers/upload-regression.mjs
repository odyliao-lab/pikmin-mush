import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
import { observationStatements } from '../../lib/observations.mjs';
import { isUsefulMushroomLevel } from '../../lib/mushroom-policy.mjs';

// Local source only. Every runtime service is injected; accidental network use fails.
function load(file, dependencies, globals = {}) {
  const exports = {};
  new Script(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { filename: file }).runInNewContext({
    exports, TextEncoder, TextDecoder, Response, crypto: webcrypto, console,
    fetch() { throw new Error('Network forbidden in local upload regressions'); },
    ...globals,
    require(name) {
      if (!Object.hasOwn(dependencies, name)) throw new Error(`Unmocked import: ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}

const STREAM = '12345678-1234-1234-1234-123456789abc';
const INITIAL_NOW = Date.UTC(2026, 9, 24, 15, 59, 59, 800); // Taipei 23:59:59.800.
const NEW_START = Date.UTC(2026, 9, 24, 15);
const OLD_START = Date.UTC(2026, 9, 23, 15);
function row(values = {}) {
  const v = { id: 'regression-poi', lat: 25, lng: 121, cluster: 'fixture', level: 3,
    type: 2, finish: 0, count: 2, capacity: 35, power: 10, start: NEW_START, ...values };
  return [0, v.id, v.lat, v.lng, v.cluster, 0, v.level, v.type, v.finish,
    v.count, v.capacity, v.power, v.start].join('\t') + '\n';
}

function fixture(t) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  let clock = INITIAL_NOW, batchCount = 0, scheduled = 0;
  for (const migration of ['0015_slimy_klaw.sql', '0016_superb_random.sql', '0023_puzzling_cyclops.sql']) {
    sql.exec(readFileSync(new URL('../../drizzle/' + migration, import.meta.url), 'utf8'));
  }
  sql.exec(`CREATE TABLE mushrooms(id TEXT PRIMARY KEY,lat REAL,lng REAL,level INTEGER,type INTEGER,
    cluster TEXT,cooldown INTEGER,finish_ms INTEGER,first_seen INTEGER,discovered_by_agent_id TEXT,
    last_seen INTEGER,challenger_count INTEGER,challenger_capacity INTEGER,total_power REAL,start_ms INTEGER,
    participants_verified_at INTEGER DEFAULT 0,giant_recheck_status TEXT DEFAULT '',giant_rechecked_at INTEGER DEFAULT 0,
    mushroom_status TEXT DEFAULT 'active',invalidated_at INTEGER DEFAULT 0);
    CREATE TABLE scan_agents(id TEXT PRIMARY KEY,partial_text TEXT DEFAULT '',uploaded_rows INTEGER DEFAULT 0,
    uploaded_bytes INTEGER DEFAULT 0,last_data_at INTEGER DEFAULT 0,last_seen INTEGER,updated_at INTEGER,
    agent_version TEXT,game_version TEXT,module_version TEXT);
    INSERT INTO scan_agents(id) VALUES('fixture'),('other');
    CREATE TABLE scan_agent_events(agent_id TEXT,event_type TEXT,at INTEGER,rows INTEGER,bytes INTEGER,detail TEXT);`);
  const db = {
    prepare(query) {
      return { query, values: [], bind(...values) { this.values = values; return this; },
        async first() { return sql.prepare(this.query).get(...this.values); },
        async run() { return { meta: sql.prepare(this.query).run(...this.values) }; },
      };
    },
    async batch(statements) {
      batchCount++;
      sql.exec('BEGIN');
      try {
        for (const statement of statements) {
          assert.ok(statement.values.length <= 100, 'D1 parameter ceiling');
          sql.prepare(statement.query).run(...statement.values);
        }
        sql.exec('COMMIT');
        return [];
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
  class Clock extends Date { static now() { return clock; } }
  const cloud = load('../../lib/cloud.ts', {
    'cloudflare:workers': { env: { DB: db }, waitUntil() { throw new Error('Unexpected background service'); } },
    './mushroom-policy.mjs': { isUsefulMushroomLevel },
    './observations.mjs': { observationStatements },
    './event-spots': {}, './catalogue-seed.mjs': {}, './maintenance-health.mjs': {},
  }, { Date: Clock });
  const receipts = load('../../lib/upload-receipts.ts', { './cloud': cloud }, { Date: Clock });
  const agent = { id: 'fixture', current_target_id: 12 };
  const route = load('../../app/api/agent/upload/route.ts', {
    '../../../../lib/cloud': { ...cloud, ensureSchema: async () => {},
      scheduleRetentionEmergencyFallback() { scheduled++; } },
    '../../../../lib/upload-receipts': receipts,
    '../../../../lib/fleet': { authorizeFleetAgent: async () => agent,
      agentRequestVersions: () => ({ version: 'fixture', gameVersion: 'fixture', moduleVersion: 'fixture' }),
      touchAgent() { throw new Error('Unexpected legacy path'); } },
    '../../../../lib/metrics': { recordAgentEvent() { throw new Error('Unexpected non-atomic event'); } },
  }, { Date: Clock });
  return { sql, cloud, agent,
    advance(ms) { clock += ms; },
    stats() { return { batchCount, scheduled }; },
    count(table) { return sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; },
    send(body = row(), options = {}) {
      const { start = 0, byteLength = Buffer.byteLength(body), headers = {} } = options;
      return route.POST(new Request('https://example.invalid/api/agent/upload', {
        method: 'POST', body, duplex: 'half', headers: {
          'x-upload-protocol': 'receipt-v1', 'x-upload-stream': STREAM,
          'x-upload-start': String(start), 'x-upload-end': String(start + byteLength), ...headers,
        },
      }));
    },
  };
}

export {fixture, row, NEW_START, OLD_START};
