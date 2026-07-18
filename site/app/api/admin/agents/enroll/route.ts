import {
  adminAuthorized, ensureSchema, noStoreJson, runtime, sameOrigin,
} from "../../../../../lib/cloud";
import { hashAgentToken, issueAgentCredential } from "../../../../../lib/fleet";

export async function POST(request: Request) {
  if (!adminAuthorized(request)) return noStoreJson({ error: "forbidden" }, 403);
  if (!sameOrigin(request)) return noStoreJson({ error: "invalid origin" }, 403);
  await ensureSchema();
  let body: { name?: unknown; regionTags?: unknown };
  try {
    body = await request.json();
  } catch {
    return noStoreJson({ error: "invalid json" }, 400);
  }
  const name = String(body.name ?? "").trim().slice(0, 60);
  if (name.length < 2) return noStoreJson({ error: "Agent 名稱至少 2 個字元" }, 400);
  const regionTags = Array.isArray(body.regionTags)
    ? body.regionTags.map(String).map((value) => value.trim()).filter(Boolean).slice(0, 40)
    : [];
  const credential = issueAgentCredential(name);
  const tokenHash = await hashAgentToken(credential.token);
  const now = Date.now();
  await runtime().DB.prepare(`INSERT INTO scan_agents (
      id, display_name, token_hash, region_tags_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(credential.id, name, tokenHash, JSON.stringify(regionTags), now, now).run();
  return noStoreJson({
    ok: true,
    agent: { id: credential.id, name, region_tags: regionTags },
    token: credential.token,
    warning: "Token 只顯示這一次，請立即寫入該 Agent 的 config。",
  });
}
