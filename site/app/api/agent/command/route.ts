import { authorized, ensureSchema, plain, runtime } from "../../../../lib/cloud";
import { touchAgent } from "../../../../lib/fleet";

export async function GET(request: Request) {
  if (!authorized(request)) return plain("unauthorized\n", 401);
  await ensureSchema();
  const url = new URL(request.url);
  const since = Number.parseInt(url.searchParams.get("since") ?? "0", 10) || 0;
  const now = Date.now();
  const db = runtime().DB;
  await db.prepare("UPDATE agent_state SET last_seen = ? WHERE id = 1 AND last_seen < ?")
    .bind(now, now - 5_000).run();
  await touchAgent("primary");
  const state = await db.prepare(`SELECT seq, command_op, command_arg1,
    command_arg2, ack_seq FROM agent_state WHERE id = 1`).first();
  const seq = Number(state?.seq ?? 0);
  const ackSeq = Number(state?.ack_seq ?? 0);
  if (since > seq) return plain("0\treset\n");
  if (seq > since) {
    return plain([
      seq,
      String(state?.command_op ?? "wait"),
      String(state?.command_arg1 ?? ""),
      String(state?.command_arg2 ?? ""),
    ].join("\t").replace(/\t+\n?$/, "") + "\n");
  }
  return plain(`${Math.max(since, ackSeq)}\twait\n`);
}
