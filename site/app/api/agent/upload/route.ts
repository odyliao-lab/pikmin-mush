import {
  authorized, ensureSchema, parseTsv, plain, runtime, upsertMushrooms,
} from "../../../../lib/cloud";

export async function POST(request: Request) {
  if (!authorized(request)) return plain("unauthorized\n", 401);
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length < 0 || length > 2_000_000) return plain("payload too large\n", 413);
  await ensureSchema();
  const db = runtime().DB;
  const state = await db.prepare(
    "SELECT partial_text FROM agent_state WHERE id = 1",
  ).first();
  const incoming = await request.text();
  const combined = String(state?.partial_text ?? "") + incoming;
  const cut = combined.lastIndexOf("\n");
  const complete = cut >= 0 ? combined.slice(0, cut + 1) : "";
  const partial = cut >= 0 ? combined.slice(cut + 1) : combined;
  const rows = parseTsv(complete);
  await upsertMushrooms(rows);
  await db.prepare(`UPDATE agent_state SET
      partial_text = ?,
      uploaded_rows = uploaded_rows + ?,
      uploaded_bytes = uploaded_bytes + ?,
      last_seen = ?
    WHERE id = 1`)
    .bind(partial, rows.length, new TextEncoder().encode(incoming).byteLength, Date.now())
    .run();
  return plain(`accepted=${rows.length}\n`);
}
