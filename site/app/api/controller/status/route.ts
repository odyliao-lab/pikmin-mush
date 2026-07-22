import {
  controllerAuthorized, ensureSchema, noStoreJson, readBoundedUtf8, runtime,
} from "../../../../lib/cloud";

export async function POST(request: Request) {
  if (!controllerAuthorized(request)) return noStoreJson({ error: "unauthorized" }, 401);
  await ensureSchema();
  let status: unknown;
  try {
    const input = await readBoundedUtf8(request, 32_000);
    if (input.error === "payload too large") {
      return noStoreJson({ error: "status too large" }, 413);
    }
    if (input.error) return noStoreJson({ error: "invalid utf-8" }, 400);
    status = JSON.parse(input.text);
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
