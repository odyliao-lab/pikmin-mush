import { adminAuthorized, ensureSchema, noStoreJson } from "../../../../lib/cloud";
import { buildSoakReport } from "../../../../lib/metrics";

export async function GET(request: Request) {
  if (!adminAuthorized(request)) return noStoreJson({ error: "forbidden" }, 403);
  await ensureSchema();
  const hours = Number(new URL(request.url).searchParams.get("hours") ?? 24);
  return noStoreJson(await buildSoakReport(hours));
}
