import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,appendFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionStore} from '../src/store.mjs';
const id='77777777-7777-7777-7777-777777777777';
const date=n=>new Date(n).toISOString();
const row=(type,payload,ms=0)=>JSON.stringify({type,payload,timestamp:date(ms)})+String.fromCharCode(10);
const event=(type,payload={},ms=0)=>row('event_msg',{type,...payload},ms);
const count=(last,total,ms,extra={})=>event('token_count',{info:{last_token_usage:last,total_token_usage:total,model_context_window:1000,...extra}},ms);
const call=(response_id,u,turn_id='t',ms=0)=>row('token_usage_record',{response_id,turn_id,usage:u,thread_token_usage:u},ms);
async function fixture(run){
  const home=await mkdtemp(join(tmpdir(),'metrics-accuracy-'));
  try{await mkdir(join(home,'sessions'));const path=join(home,'sessions','rollout-'+id+'.jsonl');await writeFile(path,'');
    const store=new SessionStore(home);await run({append:s=>appendFile(path,s),snapshot:()=>store.snapshot(id)});
  }finally{await rm(home,{recursive:true,force:true});}
}
test('compaction snapshots never overwrite real usage; paired and duplicate signals count once',()=>fixture(async({append,snapshot})=>{
  const u={input_tokens:800,cached_input_tokens:700,output_tokens:100,total_tokens:900};
  await append(event('task_started',{turn_id:'t'},0)+call('r1',u,'t',1000)+count(u,u,1000));
  const compact=row('compacted',{window_id:'w1',window_number:1},2000);
  await append(compact+compact);let s=await snapshot();assert.equal(s.compactions,1);assert.equal(s.latestCompaction.afterTokens,null);
  await append(count({input_tokens:0,output_tokens:0,total_tokens:150},u,2001,{last_usage_includes_reasoning:true}));
  const item=event('item_completed',{turn_id:'t',started_at_ms:1200,completed_at_ms:2002,item:{id:'compact1',type:'ContextCompaction'}},2002);
  await append(item+item+event('context_compacted',{},2003));s=await snapshot();
  assert.equal(s.compactions,1);assert.equal(s.contextUsed,150);assert.equal(s.contextPercent,15);assert.equal(s.context.source,'compaction');
  assert.equal(s.last.input_tokens,800);assert.equal(s.last.output_tokens,100);assert.equal(s.requests,1);
  assert.equal(s.latestCompaction.beforeTokens,900);assert.equal(s.latestCompaction.afterTokens,150);assert.equal(s.latestCompaction.durationMs,802);
  assert.ok(Math.abs(s.latestCompaction.reductionPercent-83.333333)<0.001);
  await append(call('r2',{input_tokens:200,output_tokens:20,total_tokens:220},'t',3000)+row('compacted',{window_id:'w2'},4000)+count({input_tokens:0,output_tokens:0,total_tokens:80},u,4001,{last_usage_includes_reasoning:true}));
  s=await snapshot();assert.equal(s.compactions,2);assert.equal(s.latestCompaction.beforeTokens,220);assert.equal(s.latestCompaction.afterTokens,80);assert.equal(s.last.output_tokens,20);
}));
test('item-only legacy compaction preserves the last call and does not create a fake request',()=>fixture(async({append,snapshot})=>{
  const u={input_tokens:80,output_tokens:20,total_tokens:100};
  await append(count(u,u,1000)+event('item_completed',{item:{id:'c',type:'ContextCompaction'},started_at_ms:1000,completed_at_ms:2000},2000)+count({input_tokens:0,output_tokens:0,total_tokens:50},u,2001,{last_usage_includes_reasoning:true}));
  const s=await snapshot();assert.equal(s.compactions,1);assert.equal(s.requests,1);assert.equal(s.last.output_tokens,20);assert.equal(s.contextUsed,50);
}));
test('parallel tool time is a union, deduplicated and bounded; completed turns retain their model',()=>fixture(async({append,snapshot})=>{
  const item=(id,start,end)=>event('item_completed',{turn_id:'t',started_at_ms:start,completed_at_ms:end,item:{id,type:'CommandExecution'}},end??7000);
  await append(row('session_meta',{model_provider:'custom'})+event('task_started',{turn_id:'t',started_at:1},1000)+row('turn_context',{model:'model-a',effort:'high'},1001)+call('r1',{output_tokens:100},'t',2000)+item('a',0,4000)+item('b',3000,6000)+item('b',3000,6000)+item('missing',null,null)+event('task_complete',{turn_id:'t',duration_ms:10000,time_to_first_token_ms:500},11000));
  let s=await snapshot();assert.equal(s.latestCompletedTurn.toolDurationMs,5000);assert.equal(s.latestCompletedTurn.toolPercent,50);assert.equal(s.latestCompletedTurn.toolCount,3);assert.equal(s.latestCompletedTurn.timedToolCount,2);
  assert.equal(s.latestCompletedTurn.configurations[0].model,'model-a');assert.equal(s.latestCompletedTurn.configurations[0].effort,'high');
  await append(event('task_started',{turn_id:'t2'},12000)+event('thread_settings_applied',{thread_settings:{model:'model-b',reasoning_effort:'low',model_provider_id:'gateway-b'}},12001));
  s=await snapshot();assert.equal(s.model,'model-b');assert.equal(s.effort,'low');assert.equal(s.provider,'gateway-b');assert.equal(s.latestCompletedTurn.configurations[0].model,'model-a');
  await append(call('r2',{output_tokens:10},'t2',13000)+event('task_complete',{turn_id:'t2',duration_ms:2000},14000));
  s=await snapshot();assert.equal(s.latestCompletedTurn.toolDurationMs,null);assert.equal(s.latestCompletedTurn.configurations[0].model,'model-b');
}));
test('recent turn trends use last 10 completions, valid TTFT samples, and duration-weighted TPS',()=>fixture(async({append,snapshot})=>{
  for(let i=1;i<=12;i++){
    const t='turn'+i;await append(event('task_started',{turn_id:t},i*10000)+call('r'+i,{output_tokens:100},t,i*10000+100)+event('task_complete',{turn_id:t,duration_ms:i*1000,time_to_first_token_ms:i===12?null:i*100},i*10000+200));
  }
  await append(event('task_complete',{turn_id:'turn12',duration_ms:12000},120201)+event('task_started',{turn_id:'cancel'},130000)+event('turn_aborted',{turn_id:'cancel'},130100));
  const s=await snapshot();assert.equal(s.recentTurns.length,10);assert.equal(s.recentTurns[0].turnId,'turn3');assert.equal(s.latestCompletedTurn.turnId,'turn12');
  assert.equal(s.turnSummary.ttftSamples,9);assert.equal(s.turnSummary.ttftMeanMs,700);assert.equal(s.turnSummary.ttftMedianMs,700);assert.equal(s.turnSummary.tpsSamples,10);assert.ok(Math.abs(s.turnSummary.weightedTps-1000/75)<1e-9);
}));
test('cache aggregation is token-weighted and missing fields stay unknown',()=>fixture(async({append,snapshot})=>{
  await append(call('r1',{input_tokens:100,cached_input_tokens:100,output_tokens:10,cache_write_input_tokens:0})+call('r2',{input_tokens:900,cached_input_tokens:0,output_tokens:20,cache_write_input_tokens:20}));
  let s=await snapshot();assert.equal(s.recentCacheRatio,10);assert.equal(s.recent.cache_write_input_tokens,20);assert.equal(s.last.reasoning_output_tokens,null);
  await append(call('r3',{input_tokens:100,output_tokens:0}));s=await snapshot();assert.equal(s.last.output_tokens,0);assert.equal(s.last.cached_input_tokens,null);assert.equal(s.recentCacheRatio,null);assert.equal(s.recent.cache_write_input_tokens,null);
}));
