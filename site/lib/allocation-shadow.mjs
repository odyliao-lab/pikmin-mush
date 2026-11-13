// Conservative opportunity scoring: learning must not silently alter live routes.
export function scoreRegions(regions, observedHours, policyWindowVerified = false) {
  const ready = observedHours >= 48 && policyWindowVerified === true;
  const scores = regions.map(row => {
    const hours = Math.max(0, Number(row.scan_ms || 0) / 3600000);
    const samples = Math.max(0, Number(row.targets || 0));
    const eligible = Math.max(0, Number(row.eligible_unique || 0));
    return {...row, scan_hours:hours, eligible_per_hour:hours ? eligible / hours : null,
      score:(eligible+2)/(hours+2), enough_evidence:ready && hours>=1 && samples>=30};
  });
  const sum = scores.reduce((s,r)=>s+r.score,0);
  return scores.map(row=>({...row, suggested_share:scores.length
    ? 0.2/scores.length + 0.8*row.score/sum : 0})).sort((a,b)=>b.score-a.score);
}
