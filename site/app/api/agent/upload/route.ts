import {
  ensureSchema, parseTsv, plain, readBoundedUtf8, runtime, upsertMushrooms,
} from "../../../../lib/cloud";
import {
  agentRequestVersions, authorizeFleetAgent, touchAgent,
} from "../../../../lib/fleet";
import { recordAgentEvent } from "../../../../lib/metrics";

const MAX_UPLOAD_BYTES = 512_000;
const MAX_PARTIAL_BYTES = 64_000;
const MAX_ROWS_PER_UPLOAD = 2_500;

export async function POST(request: Request) {
  const agent = await authorizeFleetAgent(request);
  if (!agent) return plain("unauthorized\n", 401);
  await ensureSchema();
  const db = runtime().DB;
  const state = await db.prepare(
    "SELECT partial_text FROM scan_agents WHERE id = ?",
  ).bind(agent.id).first();
  const prior = String(state?.partial_text ?? "");
  if (new TextEncoder().encode(prior).byteLength > MAX_PARTIAL_BYTES) {
    await db.prepare("UPDATE scan_agents SET partial_text='' WHERE id=?")
      .bind(agent.id).run();
    return plain("invalid partial state\n", 422);
  }
  const body = await readBoundedUtf8(request, MAX_UPLOAD_BYTES);
  if (body.error === "payload too large") return plain("payload too large\n", 413);
  if (body.error) return plain("invalid utf-8\n", 400);
  const incoming = body.text;
  const combined = prior + incoming;
  const cut = combined.lastIndexOf("\n");
  const complete = cut >= 0 ? combined.slice(0, cut + 1) : "";
  const partial = cut >= 0 ? combined.slice(cut + 1) : combined;
  if (new TextEncoder().encode(partial).byteLength > MAX_PARTIAL_BYTES) {
    await db.prepare("UPDATE scan_agents SET partial_text='' WHERE id=?")
      .bind(agent.id).run();
    return plain("partial row too large\n", 422);
  }
  const rows = parseTsv(complete);
  if (rows.length > MAX_ROWS_PER_UPLOAD) return plain("too many rows\n", 413);
  await upsertMushrooms(rows);
  await db.prepare(`UPDATE scan_agents SET
      partial_text = ?,
      uploaded_rows = uploaded_rows + ?,
      uploaded_bytes = uploaded_bytes + ?,
      last_data_at = CASE WHEN ?>0 THEN ? ELSE last_data_at END,
      last_seen = ?, updated_at = ?
    WHERE id = ?`)
    .bind(partial, rows.length, body.bytes, rows.length, Date.now(),
      Date.now(), Date.now(), agent.id)
    .run();
  if (agent.id === "primary") {
    await db.prepare(`UPDATE agent_state SET
        uploaded_rows=uploaded_rows+?, uploaded_bytes=uploaded_bytes+?,
        last_seen=? WHERE id=1`)
      .bind(rows.length, body.bytes, Date.now()).run();
  }
  await recordAgentEvent({
    agentId: agent.id, type: "upload", rows: rows.length, bytes: body.bytes,
  });
  await touchAgent(agent.id, agentRequestVersions(request));
  return plain(`accepted=${rows.length}\n`);
}
