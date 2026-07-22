import {
  controllerAuthorized, ensureSchema, noStoreJson, readBoundedUtf8, runtime,
} from "../../../../lib/cloud";

export async function POST(request: Request) {
  if (!controllerAuthorized(request)) return noStoreJson({ error: "unauthorized" }, 401);
  await ensureSchema();
  let body: { op?: string; args?: unknown[] };
  try {
    const input = await readBoundedUtf8(request, 8_192);
    if (input.error === "payload too large") {
      return noStoreJson({ error: "payload too large" }, 413);
    }
    if (input.error) return noStoreJson({ error: "invalid utf-8" }, 400);
    body = JSON.parse(input.text);
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
