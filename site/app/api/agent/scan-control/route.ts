import { authorized, ensureSchema, plain, runtime } from "../../../../lib/cloud";

export async function GET(request: Request) {
  if (!authorized(request)) return plain("unauthorized\n", 401);
  await ensureSchema();
  const jobId = Number(new URL(request.url).searchParams.get("job_id"));
  if (!Number.isInteger(jobId)) return plain("stop\n");
  const job = await runtime().DB.prepare("SELECT status FROM scan_jobs WHERE id=?")
    .bind(jobId).first();
  const status = String(job?.status ?? "");
  if (status === "paused") return plain("pause\n");
  if (status === "queued" || status === "running") return plain("run\n");
  return plain("stop\n");
}
