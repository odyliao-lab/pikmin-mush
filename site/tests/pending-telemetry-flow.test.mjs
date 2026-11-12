import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';
import {pendingUploadState} from '../lib/upload-pending.mjs';

test('authenticated Agent pending telemetry flows into sampled heartbeat without inventing zero for legacy agents',async()=>{
 const source=readFileSync(new URL('../lib/fleet.ts',import.meta.url),'utf8');
 const section=source.slice(source.indexOf('export function agentRequestVersions'),source.indexOf('function parseTags'));
 const events=[],exports={};
 const db={prepare(){return {bind(){return this},async run(){return {meta:{changes:1}}}}}};
 const code=ts.transpileModule(section,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 new Script(code).runInNewContext({exports,runtime:()=>({DB:db}),HEARTBEAT_SAMPLE_MS:300000,
  recordAgentEvent:async event=>events.push(event)});
 const request=value=>new Request('https://example.test',{headers:value===null?{}:{'x-agent-pending-bytes':value}});
 await exports.touchAgent('fixture',exports.agentRequestVersions(request('137')));
 await exports.touchAgent('fixture',exports.agentRequestVersions(request(null)));
 assert.equal(JSON.parse(events[0].detail).pendingBytes,137);
 assert.equal(events[1].detail,'');
 assert.equal(pendingUploadState([{at:events[0].at,pendingBytes:137}],events[0].at,0),'pending');
 assert.equal(pendingUploadState([{at:events[1].at,pendingBytes:null}],events[1].at,0),'unknown');
});
