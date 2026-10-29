import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { Script } from 'node:vm';
import ts from 'typescript';
const exports={};
new Script(ts.transpileModule(readFileSync(new URL('../lib/upload-receipts.ts',import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText).runInNewContext({exports,require(){return {};}});

test('real local D1 applies migration and constraint range guard, rolling back late failures',async()=>{
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("fixture");}}',
    compatibilityDate:'2026-06-01',d1Databases:{DB:'fixture-upload-receipts'}}));
  try {
    const db=await mf.getD1Database('DB');
    const migration=readFileSync(new URL('../drizzle/0023_puzzling_cyclops.sql',import.meta.url),'utf8');
    await db.batch(migration.split('--> statement-breakpoint').map(s=>db.prepare(s.trim())));
    await db.prepare('CREATE TABLE fixture_counter (n INTEGER)').run();
    await db.prepare('INSERT INTO fixture_counter VALUES(0)').run();
    const receipt=(start,end)=>db.prepare(exports.RECEIPT_INSERT)
      .bind(start,'fixture','stream','fixture','stream',start,end,'hash',1,1234);
    await assert.rejects(db.batch([receipt(0,10),db.prepare('UPDATE fixture_counter SET n=n+1'),
      db.prepare('UPDATE nonexistent_fixture SET n=1')]));
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM agent_upload_receipts').first()).n,0);
    assert.equal((await db.prepare('SELECT n FROM fixture_counter').first()).n,0);
    await db.batch([receipt(0,10),db.prepare('UPDATE fixture_counter SET n=n+1')]);
    await assert.rejects(db.batch([receipt(0,20),db.prepare('UPDATE fixture_counter SET n=n+1')]),/NOT NULL/);
    assert.equal((await db.prepare('SELECT n FROM fixture_counter').first()).n,1);
    await db.batch([receipt(10,20),db.prepare('UPDATE fixture_counter SET n=n+1')]);
    assert.equal((await db.prepare('SELECT n FROM fixture_counter').first()).n,2);
  } finally {await mf.dispose();}
});
