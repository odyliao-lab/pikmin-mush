import { DISCOVERY_SQL, UNDER_FIVE_SQL } from './query-contract.mjs';

const SORTS = {
  updated: ['COALESCE(last_seen,0)', 'DESC'],
  'discovered-desc': [DISCOVERY_SQL, 'DESC'],
  discovered: [DISCOVERY_SQL, 'ASC'],
  level: ['level', 'DESC'],
  remain: ['CASE WHEN finish_ms > 0 THEN finish_ms ELSE 9007199254740991 END', 'ASC'],
  'remain-desc': ['CASE WHEN finish_ms > 0 THEN finish_ms ELSE 9007199254740991 END', 'DESC'],
};

export function listOrder(params) {
  const sort = params.get('sort') || 'updated';
  if (!Object.hasOwn(SORTS, sort)) throw new Error('invalid sort');
  const priority = params.get('prioritize_low') || '0';
  if (!['0','1'].includes(priority)) throw new Error('invalid prioritize_low');
  const [value, direction] = SORTS[sort];
  const low = priority === '1' ? `CASE WHEN ${UNDER_FIVE_SQL} THEN 0 ELSE 1 END` : '0';
  return { sort, priority, value, low, direction,
    select: `${low} AS query_low, ${value} AS query_value`,
    order: `query_low ASC, query_value ${direction}, id DESC` };
}

export function cursorPredicate(order, cursor) {
  if (!cursor) return { sql: '', bindings: [] };
  const {low, value, id} = cursor;
  if (![0,1].includes(low) || !Number.isSafeInteger(value) || value < 0 ||
      typeof id !== 'string' || !id || id.length > 200) throw new Error('invalid cursor');
  const cmp = order.direction === 'ASC' ? '>' : '<';
  return { sql: `(${order.low} > ? OR (${order.low} = ? AND (${order.value} ${cmp} ? OR (${order.value} = ? AND id < ?))))`,
    bindings: [low, low, value, value, id] };
}

// Bound parameters, not string-built user SQL. Country/city searches match the
// same catalog neighbourhood (120km) used by the public location label.
export function searchPredicate(raw, catalog, {locationOnly=false} = {}) {
  const q = String(raw || '').trim().toLowerCase();
  if (q.length > 120) throw new Error('search too long');
  if (!q) return {q, sql:'', bindings:[]};
  const compact = q.replace(/\s+/g, '');
  const pair = /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(compact) ? compact.split(',').map(Number) : [999,999];
  const cities = catalog.filter(c => `${c.country}-${c.city}`.toLowerCase().includes(q))
    .map(c => [c.lat, c.lng, Math.max(.01, Math.cos(c.lat*Math.PI/180)) ** 2]);
  if(locationOnly)return {q,sql:`EXISTS (SELECT 1 FROM json_each(?) c WHERE
    (lat-json_extract(c.value,'$[0]'))*(lat-json_extract(c.value,'$[0]')) +
    (lng-json_extract(c.value,'$[1]'))*(lng-json_extract(c.value,'$[1]'))*json_extract(c.value,'$[2]') <= ?)`,
    bindings:[JSON.stringify(cities),(120/111)**2]};
  return {q, sql:`(instr(lower(id), ?) > 0 OR instr(CAST(lat AS TEXT)||','||CAST(lng AS TEXT), ?) > 0 OR (abs(lat-?) < 0.000001 AND abs(lng-?) < 0.000001) OR EXISTS (
    SELECT 1 FROM json_each(?) c WHERE
    (lat-json_extract(c.value,'$[0]'))*(lat-json_extract(c.value,'$[0]')) +
    (lng-json_extract(c.value,'$[1]'))*(lng-json_extract(c.value,'$[1]'))*json_extract(c.value,'$[2]') <= ?))`,
    bindings:[q,compact,...pair,JSON.stringify(cities),(120/111)**2]};
}
