// Current live tables only; retention backups, identities and receipts are not
// read or changed. No cleanup/schema/rotation helper is called from this view.
export async function readFleetLevelInventory(db,requestStartedAt) {
  const unknown=reason=>({status:503,body:{measurement_version:1,
    scope:'current_full_tables',request_started_at:requestStartedAt,
    reason,tables:null,excluded_rows:null,exclusion_consistent:null,
    qualification_complete:false,activation_ready:false}});
  try {
    const names=['mushrooms','mushroom_observations'];
    const result=await db.batch(names.map(name=>db.prepare(`SELECT
      COUNT(CASE WHEN level=1 THEN 1 END) AS small_rows,
      COUNT(CASE WHEN level=2 THEN 1 END) AS normal_rows FROM ${name}`)));
    if(!Array.isArray(result)||result.length!==2)return unknown('incomplete_inventory');
    const tables={};let excluded=0;
    for(let i=0;i<names.length;i++) {
      const r=result[i],v=r?.results?.[0];
      if(r?.success!==true||r.results?.length!==1||r.meta?.rows_written>0||r.meta?.changed_db===true||
        ![v?.small_rows,v?.normal_rows].every(n=>Number.isSafeInteger(n)&&n>=0))
        return unknown('incomplete_inventory');
      tables[names[i]]={small_rows:v.small_rows,normal_rows:v.normal_rows};
      excluded+=v.small_rows+v.normal_rows;
    }
    if(!Number.isSafeInteger(excluded))return unknown('invalid_inventory');
    return {status:200,body:{measurement_version:1,scope:'current_full_tables',
      request_started_at:requestStartedAt,tables,excluded_rows:excluded,
      exclusion_consistent:excluded===0,qualification_complete:false,activation_ready:false}};
  } catch {return unknown('inventory_unavailable');}
}
