import {runtime} from '../../../../lib/cloud';
import {access, privateJson} from '../../../../lib/gps-access.mjs';
export async function GET(request: Request) {
  try { return privateJson(await access(request,runtime())); }
  catch { return privateJson({error:'GPS 授權暫時無法確認'},503); }
}
