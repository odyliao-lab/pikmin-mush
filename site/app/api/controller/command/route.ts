import { authorized, ensureSchema, noStoreJson, runtime } from "../../../../lib/cloud";

export async function POST(request: Request) {
  if (!authorized(request)) return noStoreJson({ error: "unauthorized" }, 401);
  await ensureSchema();
  let body: { op?: string; args?: unknown[] };
  try {
    body = await request.json();
  } catch {
    return noStoreJson({ error: "invalid json" }, 400);
  }
  const allowed = new Set(["teleport", "confirm", "restart", "sync", "status"]);
  const op = String(body.op ?? "");
  if (!allowed.has(op)) return noStoreJson({ error: "invalid command" }, 400);
  const args = Array.isArray(body.args) ? body.args.map(String) : [];
  const result = await runtime().DB.prepare(`UPDATE agent_state SET
      seq = seq + 1,
      command_op = ?,
      command_arg1 = ?,
      command_arg2 = ?,
      ack_ok = 0,
      ack_message = ''
    WHERE id = 1 RETURNING seq`)
    .bind(op, args[0] ?? "", args[1] ?? "")
    .first();
  return noStoreJson({ seq: Number(result?.seq ?? 0) });
}
