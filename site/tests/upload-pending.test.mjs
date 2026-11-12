import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingUploadState} from '../lib/upload-pending.mjs';

test('only continuous fresh pending evidence establishes an upload stall',()=>{
 const now=100000000, samples=Array.from({length:26},(_,i)=>({at:now-7500000+i*300000,pendingBytes:10}));
 assert.equal(pendingUploadState([],now,0),'unknown');
 assert.equal(pendingUploadState([{at:now,pendingBytes:0}],now,0),'clear');
 assert.equal(pendingUploadState([{at:now,pendingBytes:10}],now,0),'pending');
 assert.equal(pendingUploadState(samples,now,0),'stalled');
 assert.equal(pendingUploadState(samples,now,now-1000),'pending');
 assert.equal(pendingUploadState([...samples.slice(0,10),...samples.slice(13)],now,0),'unknown');
 assert.equal(pendingUploadState([...samples,{at:now,pendingBytes:null}],now,0),'unknown');
 assert.equal(pendingUploadState([...samples,{at:now,pendingBytes:0}],now,0),'clear');
});
