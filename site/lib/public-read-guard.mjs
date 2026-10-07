// Atomic per-source admission shared by all Worker instances. No raw IP/GPS storage.
export const GUARD_LIMITS = Object.freeze({ requests: 60, spatial: 12, concurrent: 4, leaseSeconds: 60 });
export const ADMIT_SQL = `INSERT INTO public_read_budgets
 (source, window, requests, spatial, last_bbox, leases, updated_at)
 VALUES (?1, ?2, 1, ?3, ?4, json_object(?5, ?6), ?7)
 ON CONFLICT(source) DO UPDATE SET
 window=excluded.window,
 requests=CASE WHEN window=excluded.window THEN requests+1 ELSE 1 END,
 spatial=CASE WHEN window=excluded.window THEN spatial+
   CASE WHEN excluded.last_bbox<>'' AND excluded.last_bbox<>last_bbox THEN 1 ELSE 0 END
   ELSE excluded.spatial END,
 last_bbox=CASE WHEN excluded.last_bbox='' THEN last_bbox ELSE excluded.last_bbox END,
 leases=json_set(COALESCE((SELECT json_group_object(key,value) FROM json_each(leases)
   WHERE CAST(value AS INTEGER)>?7),'{}'), '$.'||?5, ?6),
 updated_at=excluded.updated_at
 WHERE (window<>excluded.window OR requests<?8)
 AND (window<>excluded.window OR excluded.last_bbox='' OR excluded.last_bbox=last_bbox OR spatial<?9)
 AND (SELECT COUNT(*) FROM json_each(leases) WHERE CAST(value AS INTEGER)>?7)<?10
 RETURNING source`;

export async function acquirePublicRead(db, request, secret, now = Date.now()) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (secret.length < 32 || !/^[0-9a-f:.]{3,64}$/i.test(ip)) throw Error('public guard identity unavailable');
  const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(text)))].map(x => x.toString(16).padStart(2,'0')).join('');
  const source = await digest(`${secret}\0public-read\0${ip}`);
  const rawBbox = new URL(request.url).searchParams.get('bbox');
  const bbox = rawBbox ? await digest(rawBbox.split(',').map(x=>String(Number(x))).join(',')) : '';
  const nonce = crypto.randomUUID().replaceAll('-','');
  const seconds = Math.floor(now/1000), window = Math.floor(seconds/60);
  const accepted = await db.prepare(ADMIT_SQL).bind(source, window, bbox ? 1 : 0,
    bbox, nonce, seconds+GUARD_LIMITS.leaseSeconds, seconds,
    GUARD_LIMITS.requests, GUARD_LIMITS.spatial, GUARD_LIMITS.concurrent).first();
  if (!accepted) return { allowed: false, retryAfter: Math.max(1, 60-seconds%60) };
  return { allowed: true, async release() {
    await db.prepare(`UPDATE public_read_budgets SET leases=json_remove(leases,?)
      WHERE source=? AND json_extract(leases,?)=?`).bind('$.'+nonce,source,
      '$.'+nonce,seconds+GUARD_LIMITS.leaseSeconds).run();
  } };
}
