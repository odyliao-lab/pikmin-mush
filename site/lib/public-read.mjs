// Public map reads only. Never wrap uploads, authenticated controls, or rechecks.
export const PUBLIC_CACHE_SECONDS = 15;
const PARAMS = new Set(['bbox', 'levels', 'types', 'under_five', 'sort', 'prioritize_low',
  'q', 'discovered_within_hours', 'discovered_from', 'discovered_to', 'limit', 'cursor', 'include_meta']);

export function publicCacheKey(request) {
  const url = new URL(request.url), params = new URLSearchParams();
  for (const name of [...PARAMS].sort()) {
    let value = url.searchParams.get(name);
    if (value === null) continue;
    if (name === 'levels' || name === 'types') value = [...new Set(value.split(','))].sort().join(',');
    params.set(name, value);
  }
  // Versioned namespace; ignore cache-busters, but never merge distinct filters/cursors.
  return new Request(`${url.origin}/__map_read_cache/v2-redacted?${params}`);
}

export function createMemo({ now = Date.now, ttlMs = 15_000, maxEntries = 128 } = {}) {
  const entries = new Map();
  return async function memo(key, load) {
    const cached = entries.get(key);
    if (cached && cached.expires > now()) return cached.promise;
    entries.delete(key);
    if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
    const entry = { expires: now() + ttlMs, promise: null };
    entry.promise = Promise.resolve().then(load).catch(error => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    });
    entries.set(key, entry);
    return entry.promise;
  };
}

// Best-effort burst protection per isolate, not a distributed WAF quota. No D1
// writes, persistent IP storage, or trust in caller-supplied X-Forwarded-For.
export function createReadLimiter({ now = Date.now, burst = 120, perSecond = 2, maxEntries = 2048 } = {}) {
  const buckets = new Map();
  return request => {
    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip || ip.length > 64) return 0; // local preview / no trusted platform identity
    const time = now(), old = buckets.get(ip);
    const tokens = old ? Math.min(burst, old.tokens + Math.max(0, time - old.time) * perSecond / 1000) : burst;
    buckets.delete(ip);
    if (buckets.size >= maxEntries) buckets.delete(buckets.keys().next().value);
    buckets.set(ip, { tokens: Math.max(0, tokens - 1), time });
    return tokens >= 1 ? 0 : Math.max(1, Math.ceil((1 - tokens) / perSecond));
  };
}

// Store plain strings, not request-owned Response streams, across invocations.
// This is a small availability fallback, not durable or cross-isolate storage.
export function createResponseMemo({ now = Date.now, maxEntries = 16, maxBytes = 8 * 1024 * 1024 } = {}) {
  const entries = new Map(); let bytes = 0;
  const remove = key => { const old = entries.get(key); if (old) bytes -= old.size; entries.delete(key); };
  return {
    async match(key) {
      const item = entries.get(key.url);
      if (!item) return null;
      if (item.expires <= now()) { remove(key.url); return null; }
      entries.delete(key.url); entries.set(key.url, item);
      return new Response(item.body, { headers: item.headers });
    },
    async put(key, response) {
      const body = await response.text(), headers = [...response.headers];
      const size = 2 * (body.length + key.url.length + JSON.stringify(headers).length);
      if (size > maxBytes || maxEntries < 1) return;
      remove(key.url);
      for (const [id, item] of entries) if (item.expires <= now()) remove(id);
      while (entries.size >= maxEntries || bytes + size > maxBytes) remove(entries.keys().next().value);
      entries.set(key.url, { body, headers, size, expires: Number(response.headers.get('X-Map-Cache-Until')) });
      bytes += size;
    },
  };
}

export function createQueryTrace({ now = Date.now, sample = Math.random, log = value => console.info(JSON.stringify(value)) } = {}) {
  const start = now(), queries = [];
  return {
    async query(label, action) {
      const began = now();
      const result = await action();
      queries.push({ label, duration_ms: now() - began,
        rows_read: result.meta?.rows_read ?? null, rows_written: result.meta?.rows_written ?? null });
      return result;
    },
    finish({ cache = 'BYPASS', status = 200, returned = null } = {}) {
      // Sample ordinary traffic; always retain slow/error diagnostics. Labels are
      // fixed in source: never log SQL, bindings, URLs, searches, IPs or coordinates.
      const duration = now() - start;
      if (sample() < 0.05 || duration >= 1000 || status >= 500) {
        log({ event: 'public_map_read', cache, status, duration_ms: duration, returned, queries });
      }
    },
  };
}

export function createPublicReader({ now = Date.now, cache = () => globalThis.caches?.open('pikmin-public-map-v2-redacted'),
  trusted = () => false, admit = async () => ({ allowed: true, release: async () => {} }),
  memory = createResponseMemo({ now }), limit = createReadLimiter({ now }), trace = () => createQueryTrace({ now }) } = {}) {
  return async (request, load, { bypassCache = false } = {}) => {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/api/mushrooms') return load(trace());
    const metric = trace(), isTrusted = trusted(request), retry = isTrusted ? 0 : limit(request);
    if (retry) {
      metric.finish({ cache: 'BYPASS', status: 429 });
      return Response.json({ error: 'rate_limited', retry_after: retry }, {
        status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(retry), 'Access-Control-Allow-Origin': '*' },
      });
    }
    for (const name of PARAMS) {
      if (url.searchParams.getAll(name).length > 1) return Response.json({ error: 'duplicate query parameter' }, {
        status: 400, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
      });
    }
    // Explicit opt-in: existing notifier / verification reads remain uncached.
    // Server-only policy: keep the original framework Request (which may be a
    // Proxy in Workers), but never read or populate shared caches for GPS grants.
    const eligible = !bypassCache && url.searchParams.get('cache') === 'brief' && !request.headers.has('Authorization') &&
      !/no-cache|no-store/.test(request.headers.get('Cache-Control') || '');
    const key = eligible ? publicCacheKey(request) : null;
    // Sites runs in an isolated Workers-for-Platforms namespace: caches.default
    // is disabled there. A named cache preserves the platform's tenant isolation.
    let edge = null;
    if (eligible) { try { edge = await cache(); } catch { /* use bounded fallback */ } }
    if (eligible) {
      let hit = null, backend = 'named';
      if (edge) { try { hit = await edge.match(key); } catch { /* use bounded fallback */ } }
      if (!hit) { hit = await memory.match(key); backend = 'isolate'; }
      try {
        if (hit && Number(hit.headers.get('X-Map-Cache-Until')) > now()) {
          const response = new Response(hit.body, hit);
          response.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
          response.headers.set('X-Map-Cache', 'HIT');
          response.headers.set('X-Map-Cache-Backend', backend);
          response.headers.delete('X-Map-Cache-Until');
          metric.finish({ cache: backend === 'named' ? 'HIT' : 'HIT_MEMORY' });
          return response;
        }
      } catch { /* cache failure must not become a data outage */ }
    }
    let admission;
    try {
      admission = isTrusted ? { allowed: true } : await admit(request);
      if (!admission.allowed) {
        metric.finish({cache:'BYPASS',status:429});
        return Response.json({error:'rate_limited',retry_after:admission.retryAfter}, {
          status:429,headers:{'Cache-Control':'no-store','Retry-After':String(admission.retryAfter),'Access-Control-Allow-Origin':'*'},
        });
      }
      const response = await load(metric);
      const state = eligible ? 'MISS' : 'BYPASS';
      response.headers.set('X-Map-Cache', state);
      if (eligible && response.status === 200 && !response.headers.has('Set-Cookie')) {
        const stored = response.clone();
        stored.headers.set('Cache-Control', `public, max-age=${PUBLIC_CACHE_SECONDS}`);
        stored.headers.set('X-Map-Cache-Until', String(now() + PUBLIC_CACHE_SECONDS * 1000));
        await memory.put(key, stored.clone());
        let backend = 'isolate';
        if (edge) { try { await edge.put(key, stored); backend = 'named'; } catch { /* local fallback remains usable */ } }
        response.headers.set('X-Map-Cache-Backend', backend);
        response.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
      }
      metric.finish({ cache: state, status: response.status,
        returned: response.headers.has('X-Map-Returned') ? Number(response.headers.get('X-Map-Returned')) : null });
      return response;
    } catch {
      metric.finish({ cache: eligible ? 'MISS' : 'BYPASS', status: 503 });
      // Do not expose D1 SQL or bindings in a public error response.
      return Response.json({ error: 'temporarily_unavailable' }, {
        status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '10', 'Access-Control-Allow-Origin': '*' },
      });
    } finally {
      if (admission?.release) {
        try { await admission.release(); } catch { /* bounded lease expires; never replay the read */ }
      }
    }
  };
}
