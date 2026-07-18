import {
  ensureSchema, parseTsv, plain, runtime, upsertMushrooms,
} from "../../../../lib/cloud";
import { authorizeFleetAgent, touchAgent } from "../../../../lib/fleet";

export async function POST(request: Request) {
  const agent = await authorizeFleetAgent(request);
  if (!agent) return plain("unauthorized\n", 401);
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length < 0 || length > 2_000_000) return plain("payload too large\n", 413);
  await ensureSchema();
  const db = runtime().DB;
  const state = await db.prepare(
    "SELECT partial_text FROM scan_agents WHERE id = ?",
  ).bind(agent.id).first();
  const incoming = await request.text();
  const combined = String(state?.partial_text ?? "") + incoming;
  const cut = combined.lastIndexOf("\n");
  const complete = cut >= 0 ? combined.slice(0, cut + 1) : "";
  const partial = cut >= 0 ? combined.slice(cut + 1) : combined;
  const rows = parseTsv(complete);
  await upsertMushrooms(rows);
  await db.prepare(`UPDATE scan_agents SET
      partial_text = ?,
      uploaded_rows = uploaded_rows + ?,
      uploaded_bytes = uploaded_bytes + ?,
      last_seen = ?, updated_at = ?
    WHERE id = ?`)
    .bind(partial, rows.length, new TextEncoder().encode(incoming).byteLength,
      Date.now(), Date.now(), agent.id)
    .run();
  if (agent.id === "primary") {
    await db.prepare(`UPDATE agent_state SET
        uploaded_rows=uploaded_rows+?, uploaded_bytes=uploaded_bytes+?,
        last_seen=? WHERE id=1`)
      .bind(rows.length, new TextEncoder().encode(incoming).byteLength, Date.now()).run();
  }
  await touchAgent(agent.id);
  return plain(`accepted=${rows.length}\n`);
}
