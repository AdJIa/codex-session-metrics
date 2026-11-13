import {test} from 'node:test';
import assert from 'node:assert/strict';
import {updateTimingHistory} from '../src/averages.mjs';
test('rolling mean uses exactly last 10 completed calls, per-call TPS arithmetic mean',()=>{
 let state=null;for(let i=1;i<=12;i++)state=updateTimingHistory(state,{callId:String(i),active:false,completed:true,ttftMs:i*100,tps:i*10});
 assert.equal(state.history.length,10);assert.equal(state.history[0].callId,'3');assert.equal(state.average.ttftMs,750);assert.equal(state.average.tps,75);
 state=updateTimingHistory(state,{callId:'pending',active:true,ttftMs:99999,tps:99999});assert.equal(state.average.ttftMs,750);
 state=updateTimingHistory(state,{callId:'failed',active:false,completed:false,ttftMs:99999,tps:99999});assert.equal(state.average.tps,75);
 state=updateTimingHistory(state,{callId:'12',active:false,completed:true,ttftMs:1200,tps:120});assert.equal(state.history.length,10);assert.equal(state.average.tps,75);
});
test('missing metrics do not become zero and sample counts are independent',()=>{
 let s=updateTimingHistory(null,{callId:'a',completed:true,ttftMs:100,tps:null});s=updateTimingHistory(s,{callId:'b',completed:true,ttftMs:null,tps:20});
 assert.equal(s.average.ttftSamples,1);assert.equal(s.average.tpsSamples,1);assert.equal(s.average.ttftMs,100);assert.equal(s.average.tps,20);
});
