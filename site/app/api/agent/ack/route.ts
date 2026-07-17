import { authorized, ensureSchema, plain, runtime } from "../../../../lib/cloud";

export async function POST(request: Request) {
  if (!authorized(request)) return plain("unauthorized\n", 401);
  await ensureSchema();
  const url = new URL(request.url);
  const seq = Number.parseInt(url.searchParams.get("seq") ?? "0", 10) || 0;
  const ok = url.searchParams.get("ok") === "1" ? 1 : 0;
  const latText = url.searchParams.get("lat");
  const lngText = url.searchParams.get("lng");
  const lat = latText == null ? null : Number(latText);
  const lng = lngText == null ? null : Number(lngText);
  const locationValid = Number.isFinite(lat) && Number.isFinite(lng);
  const message = locationValid ? `${latText},${lngText}` :
    (url.searchParams.get("message") ?? "");
  const db = runtime().DB;
  await db.prepare(`UPDATE agent_state SET
      ack_seq = CASE WHEN ? >= ack_seq THEN ? ELSE ack_seq END,
      ack_ok = CASE WHEN ? >= ack_seq THEN ? ELSE ack_ok END,
      ack_message = CASE WHEN ? >= ack_seq THEN ? ELSE ack_message END,
      last_seen = ?,
      current_lat = CASE WHEN ? THEN ? ELSE current_lat END,
      current_lng = CASE WHEN ? THEN ? ELSE current_lng END
    WHERE id = 1`)
    .bind(seq, seq, seq, ok, seq, message, Date.now(),
      locationValid ? 1 : 0, locationValid ? lat : null,
      locationValid ? 1 : 0, locationValid ? lng : null)
    .run();
  return plain("ok\n");
}
