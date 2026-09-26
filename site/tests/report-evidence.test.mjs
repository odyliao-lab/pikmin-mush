import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {REPORT_EVIDENCE_SQL,REPORT_CANDIDATES_SQL,reportEvidence} from '../lib/report-evidence.mjs';
import {archiveAndDeleteTargets} from '../lib/target-history.mjs';

function fixture() {
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE scan_targets(id INTEGER PRIMARY KEY,job_id INTEGER,cycle INTEGER,country TEXT,
 verification_kind TEXT,verification_batch TEXT,verification_mushroom_id TEXT,status TEXT,
 leased_at INTEGER,completed_at INTEGER,completed_agent_id TEXT,lat REAL,lng REAL);
 CREATE TABLE scan_target_history(id INTEGER PRIMARY KEY,job_id INTEGER,cycle INTEGER,country TEXT,verification_kind TEXT,archived_at INTEGER);
 CREATE TABLE mushrooms(id TEXT PRIMARY KEY,start_ms INTEGER,level INTEGER,type INTEGER,
 challenger_count INTEGER,challenger_capacity INTEGER,finish_ms INTEGER,invalidated_at INTEGER,
 giant_recheck_status TEXT,lat REAL,lng REAL,first_seen INTEGER);
 CREATE TABLE mushroom_challenges(key TEXT PRIMARY KEY,location_id TEXT,start_ms INTEGER,
 first_recorded_at INTEGER,identity_confidence TEXT);
 CREATE TABLE mushroom_observations(key TEXT PRIMARY KEY,challenge_key TEXT,target_id INTEGER,
 agent_id TEXT,received_at INTEGER,level INTEGER,type INTEGER,challenger_count INTEGER,challenger_capacity INTEGER,finish_ms INTEGER);
 INSERT INTO mushrooms VALUES('p',1000,3,2,2,35,0,0,'',1,2,999999);
 INSERT INTO mushroom_challenges VALUES('p/1000','p',1000,100,'challenge_start');
 INSERT INTO scan_targets VALUES(1,1,0,'X','candidate','batch001','p','completed',101000,110000,'leo',1,2);
 INSERT INTO mushroom_observations VALUES('o','p/1000',1,'leo',105,3,2,2,35,0);`);
 db.exec(readFileSync(new URL('../drizzle/0022_high_mojo.sql',import.meta.url),'utf8'));
 return db;
}

test('membership is immutable receipt history, not mutated public discovery or start time',()=>{
 const db=fixture();
 const rows=db.prepare(REPORT_CANDIDATES_SQL).all(90,101,'',3,120000);
 assert.equal(rows.length,1);assert.equal(rows[0].discovered_at,100);
 assert.equal(db.prepare(REPORT_CANDIDATES_SQL).all(90,100,'',3,120000).length,0);
 assert.equal(db.prepare(REPORT_CANDIDATES_SQL).all(101,200,'',3,120000).length,0);
 db.close();
});

test('exact target/agent evidence survives queue rotation, without current time re-filter',async()=>{
 const db=fixture();
 const read=()=>db.prepare(REPORT_EVIDENCE_SQL).all('batch001','batch001').map(r=>reportEvidence(r,120000));
 assert.equal(read()[0].eligible,true);assert.equal(read()[0].verified_at,105000);
 const adapter={prepare:s=>({bind:(...args)=>()=>db.prepare(s).run(...args)}),batch:async ss=>{
 db.exec('BEGIN');try{ss.forEach(f=>f());db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}};
 await archiveAndDeleteTargets(adapter,1,120000);
 assert.equal(read()[0].eligible,true);
 db.exec("UPDATE mushroom_observations SET agent_id='other'");
 assert.equal(read()[0].refreshed,false);
 db.exec("UPDATE mushroom_observations SET agent_id='leo',target_id=2");
 assert.equal(read()[0].refreshed,false);
 db.close();
});

test('new challenge, later full participants and expired records cannot reuse old approval',()=>{
 const db=fixture();
 const read=()=>reportEvidence(db.prepare(REPORT_EVIDENCE_SQL).get('batch001','batch001'),120000);
 db.exec('UPDATE mushrooms SET challenger_count=5');assert.equal(read().eligible,false);
 assert.equal(read().reason,'participants_full');
 db.exec('UPDATE mushrooms SET challenger_count=2,start_ms=2000');assert.equal(read().reason,'challenge_changed');
 db.exec('UPDATE mushrooms SET start_ms=1000,finish_ms=119000');assert.equal(read().reason,'expired');
 db.close();
});
