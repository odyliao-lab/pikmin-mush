// Unknown is explicit when older Agents or interrupted observations lack evidence.
export function pendingUploadState(samples, now, lastUploadAt) {
  const ordered=samples.filter(x=>Number.isSafeInteger(x.at)&&x.at<=now)
    .sort((a,b)=>a.at-b.at);
  const last=ordered.at(-1);
  if(!last||now-last.at>600000||!Number.isSafeInteger(last.pendingBytes)||last.pendingBytes<0)return 'unknown';
  if(last.pendingBytes===0)return 'clear';
  const cutoff=now-7200000;
  const start=ordered.findLastIndex(x=>x.at<=cutoff);
  if(start<0||lastUploadAt>cutoff)return 'pending';
  const interval=ordered.slice(start);
  if(interval.some(x=>!Number.isSafeInteger(x.pendingBytes)||x.pendingBytes<=0))return 'pending';
  if(interval.some((x,i)=>i>0&&x.at-interval[i-1].at>600000))return 'unknown';
  return 'stalled';
}
