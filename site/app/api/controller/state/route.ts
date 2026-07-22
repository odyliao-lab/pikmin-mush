import { controllerAuthorized, ensureSchema, noStoreJson, runtime } from "../../../../lib/cloud";

export async function GET(request: Request) {
  if (!controllerAuthorized(request)) return noStoreJson({ error: "unauthorized" }, 401);
  await ensureSchema();
  const state = await runtime().DB.prepare(`SELECT seq, command_op,
    command_arg1, command_arg2, ack_seq, ack_ok, ack_message, last_seen,
    current_lat, current_lng, uploaded_rows, uploaded_bytes
    FROM agent_state WHERE id = 1`).first();
  const lastSeen = Number(state?.last_seen ?? 0);
  return noStoreJson({
    ...state,
    seq: Number(state?.seq ?? 0),
    ack_seq: Number(state?.ack_seq ?? 0),
    ack_ok: Boolean(state?.ack_ok),
    last_seen: lastSeen,
    online: Date.now() - lastSeen < 12_000,
    uploaded_rows: Number(state?.uploaded_rows ?? 0),
    uploaded_bytes: Number(state?.uploaded_bytes ?? 0),
  });
}
