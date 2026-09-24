// Local SQLite approximation of one bounded retention pass, not a D1 latency guarantee.
import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';

const db=new DatabaseSync(':memory:');
const now=Math.floor(Date.now()/1000), cutoff=now-7*86400;
db.exec(`CREATE TABLE mushrooms(id TEXT PRIMARY KEY,level INTEGER,first_seen INTEGER,last_seen INTEGER,mushroom_status TEXT,invalidated_at INTEGER);
 CREATE INDEX mushrooms_last_seen_id_idx ON mushrooms(last_seen,id);
 CREATE INDEX mushrooms_status_level_first_seen_idx ON mushrooms(mushroom_status,level,first_seen);
 CREATE TABLE mushroom_observations(key TEXT PRIMARY KEY,received_at INTEGER);
 CREATE INDEX mushroom_observations_received_idx ON mushroom_observations(received_at);
 CREATE TABLE scan_target_history(id INTEGER PRIMARY KEY,archived_at INTEGER);
 CREATE INDEX scan_target_history_archived_idx ON scan_target_history(archived_at);`);
const mushroom=db.prepare('INSERT INTO mushrooms VALUES(?,?,?,?,?,0)');
const observation=db.prepare('INSERT INTO mushroom_observations VALUES(?,?)');
const target=db.prepare('INSERT INTO scan_target_history VALUES(?,?)');
db.exec('BEGIN');
for(let i=0;i<60000;i++)mushroom.run(String(i),i%4+1,cutoff+(i%3?100:-100),cutoff+(i%2?100:-100),'active');
for(let i=0;i<120000;i++)observation.run(String(i),cutoff+(i%2?100:-100));
for(let i=0;i<60000;i++)target.run(i,(cutoff-86400+(i%2?100:-100))*1000);
db.exec('COMMIT');
const steps=[
 ['invalidate',`UPDATE mushrooms SET mushroom_status='invalid',invalidated_at=${now} WHERE id IN
  (SELECT id FROM mushrooms WHERE mushroom_status='active' AND level IN (2,3)
   AND first_seen<${now-2*86400} LIMIT 250)`],
 ['count',`SELECT COUNT(*) AS count FROM mushrooms WHERE last_seen<${cutoff}`],
 ['delete_mushrooms',`DELETE FROM mushrooms WHERE id IN
  (SELECT id FROM mushrooms WHERE last_seen<${cutoff} ORDER BY last_seen,id LIMIT 1000)`],
 ['delete_observations',`DELETE FROM mushroom_observations WHERE key IN
  (SELECT key FROM mushroom_observations WHERE received_at<${cutoff} ORDER BY received_at LIMIT 500)`],
 ['delete_targets',`DELETE FROM scan_target_history WHERE id IN
  (SELECT id FROM scan_target_history WHERE archived_at<${(cutoff-86400)*1000} ORDER BY archived_at LIMIT 500)`],
];
const results=[];
for(const [name,sql] of steps){
 const plan=db.prepare('EXPLAIN QUERY PLAN '+sql).all().map(row=>row.detail);
 const started=performance.now();
 const result=db.prepare(sql)[name==='count'?'get':'run']();
 results.push({name,ms:Math.round((performance.now()-started)*100)/100,
  affected:result?.changes??result?.count??0,plan});
}
console.log(JSON.stringify({dataset:{mushrooms:60000,observations:120000,targets:60000},results},null,2));
db.close();
