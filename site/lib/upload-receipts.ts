import { mushroomUpsertStatements, parseTsv, plain, runtime } from "./cloud";

// A rejected monotonic range deliberately violates NOT NULL, aborting the whole
// D1 batch. Keep the guard inside the INSERT, not in a racy preflight SELECT.
// Avoid triggers: the Sites migration publisher rejected BEGIN/END SQL parsing.
export const RECEIPT_INSERT = `INSERT INTO agent_upload_receipts
  SELECT CASE WHEN ? < COALESCE((SELECT end_offset FROM agent_upload_receipts
    WHERE agent_id=? AND stream_id=? ORDER BY start_offset DESC LIMIT 1),0)
    THEN NULL ELSE ? END,?,?,?,?,?,?`;

// Opt-in protocol: one bounded atomic D1 batch, not a transaction per TSV row.
// Receipts are NOT expired until a safe acknowledged-stream compaction exists.
// Canary first; do not enable fleet-wide without measuring receipt growth.

type UploadAgent = { id: string; current_target_id: number | null };
type Versions = { version?: string; gameVersion?: string; moduleVersion?: string };
export async function receiveUpload(request: Request, agent: UploadAgent,
  incoming: string, bytes: number, versions: Versions) {
  const stream = request.headers.get("x-upload-stream") ?? "";
  const startText = request.headers.get("x-upload-start") ?? "";
  const endText = request.headers.get("x-upload-end") ?? "";
  const start = Number(startText), end = Number(endText);
  if (!/^[a-f0-9-]{36}$/.test(stream) || !/^\d{1,16}$/.test(startText)
    || !/^\d{1,16}$/.test(endText) || !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end) || start < 0 || end <= start || end-start !== bytes
    || !incoming.endsWith("\n") || incoming.split("\n").length-1 > 100) {
    return plain("invalid upload receipt envelope\n", 422);
  }
  const db = runtime().DB;
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(incoming))), b => b.toString(16).padStart(2,"0")).join("");
  const existing = async () => db.prepare(`SELECT body_hash,accepted_rows FROM agent_upload_receipts
    WHERE agent_id=? AND stream_id=? AND start_offset=? AND end_offset=?`)
    .bind(agent.id,stream,start,end).first<{body_hash: string; accepted_rows: number}>();
  const reply = (receipt: {body_hash: string; accepted_rows: number}) =>
    receipt.body_hash === hash ? plain(`accepted=${receipt.accepted_rows}\n`)
      : plain("upload receipt content mismatch\n",409);
  const receipt = await existing();
  if (receipt) return reply(receipt);
  // Legacy partial state must be drained by the legacy client before opt-in.
  const state = await db.prepare("SELECT partial_text FROM scan_agents WHERE id=?").bind(agent.id).first();
  if (state?.partial_text) return plain("legacy partial state pending\n",409);
  const rows = parseTsv(incoming);
  const at = Date.now();
  const statements = [db.prepare(RECEIPT_INSERT)
    .bind(start,agent.id,stream,agent.id,stream,start,end,hash,rows.length,at),
    ...mushroomUpsertStatements(db,rows,agent.id,agent.current_target_id,Math.floor(at/1000),JSON.stringify([stream,start,end])),
    db.prepare(`UPDATE scan_agents SET uploaded_rows=uploaded_rows+?,
      uploaded_bytes=uploaded_bytes+?,last_data_at=CASE WHEN ?>0 THEN ? ELSE last_data_at END,
      last_seen=?,updated_at=?,
      agent_version=CASE WHEN ?<>'' THEN ? ELSE agent_version END,
      game_version=CASE WHEN ?<>'' THEN ? ELSE game_version END,
      module_version=CASE WHEN ?<>'' THEN ? ELSE module_version END WHERE id=?`)
      .bind(rows.length,bytes,rows.length,at,at,at,
        versions.version??"",versions.version??"",versions.gameVersion??"",versions.gameVersion??"",
        versions.moduleVersion??"",versions.moduleVersion??"",agent.id),
    db.prepare(`INSERT INTO scan_agent_events
      (agent_id,event_type,at,rows,bytes,detail) VALUES (?,'upload',?,?,?,'receipt-v1')`)
      .bind(agent.id,at,rows.length,bytes)];
  if (agent.id === "primary") statements.push(db.prepare(`UPDATE agent_state SET
    uploaded_rows=uploaded_rows+?,uploaded_bytes=uploaded_bytes+?,last_seen=? WHERE id=1`)
    .bind(rows.length,bytes,at));
  try {
    // D1 batch rolls back ALL statements on failure, including the receipt.
    await db.batch(statements);
  } catch (error) {
    // Another request may have committed the same receipt while we waited.
    const committed = await existing();
    if (committed) return reply(committed);
    const latest = await db.prepare(`SELECT end_offset FROM agent_upload_receipts
      WHERE agent_id=? AND stream_id=? ORDER BY start_offset DESC LIMIT 1`)
      .bind(agent.id,stream).first<{end_offset: number}>();
    if (latest && start < latest.end_offset) return plain("upload receipt range overlap\n",409);
    throw error;
  }
  return plain(`accepted=${rows.length}\n`);
}
