import { authorized, ensureSchema, noStoreJson, runtime } from "../../../../lib/cloud";

export async function POST(request: Request) {
  if (!authorized(request)) return noStoreJson({ error: "unauthorized" }, 401);
  await ensureSchema();
  let status: unknown;
  try {
    status = await request.json();
  } catch {
    return noStoreJson({ error: "invalid json" }, 400);
  }
  const encoded = JSON.stringify(status);
  if (encoded.length > 32_000) return noStoreJson({ error: "status too large" }, 413);
  await runtime().DB.prepare(`UPDATE scanner_status
    SET status_json = ?, updated_at = ? WHERE id = 1`)
    .bind(encoded, Math.floor(Date.now() / 1000))
    .run();
  return noStoreJson({ ok: true });
}
