import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,appendFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionStore} from '../src/store.mjs';
const id='11111111-1111-1111-1111-111111111111';
test('native usage history keeps last 10 calls, deduplicates snapshots and supports fewer calls',async()=>{
 const home=await mkdtemp(join(tmpdir(),'metrics-calls-'));
 try{await mkdir(join(home,'sessions'));const path=join(home,'sessions','rollout-'+id+'.jsonl');
 const row=(type,payload,ordinal)=>JSON.stringify({type,payload,ordinal,timestamp:'2026-11-13T02:00:00Z'})+'\n';
 const record=i=>row('token_usage_record',{response_id:'r'+i,turn_id:'turn',usage:{input_tokens:i*100,cached_input_tokens:i*50,output_tokens:i},thread_token_usage:{total_tokens:i*1000}},i);
 await writeFile(path,record(1)+record(2));const store=new SessionStore(home);let s=await store.snapshot(id);assert.equal(s.recentCalls.length,2);assert.equal(s.timing.recordedCalls,2);assert.equal(s.timing.average.ttftMs,null);assert.equal(s.timing.average.tps,null);
 await appendFile(path,record(2)+Array.from({length:10},(_,i)=>record(i+3)).join('')+row('event_msg',{type:'token_count',info:{total_token_usage:{total_tokens:12000},last_token_usage:{input_tokens:1200,output_tokens:12}}},99));
 s=await store.snapshot(id);assert.equal(s.requests,12);assert.deepEqual(s.recentCalls.map(c=>c.responseId),Array.from({length:10},(_,i)=>'r'+(i+3)));assert.equal(s.recentCalls[9].usage.cached_input_tokens,600);
 await mkdir(join(home,'session-metrics'));await writeFile(join(home,'session-metrics',id+'.json'),JSON.stringify({average:{ttftMs:999,tps:999}}));s=await store.snapshot(id);assert.equal(s.timing.average.tps,null);assert.equal(s.timing.source,'codex');
 }finally{await rm(home,{recursive:true,force:true});}
});
test('legacy token_count snapshots advance history once per changed cumulative usage',async()=>{
 const home=await mkdtemp(join(tmpdir(),'metrics-legacy-'));
 try{await mkdir(join(home,'sessions'));const path=join(home,'sessions','rollout-'+id+'.jsonl');
 const row=n=>JSON.stringify({type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{total_tokens:n},last_token_usage:{input_tokens:100,output_tokens:10}}}})+'\n';
 await writeFile(path,row(110)+row(110)+row(220));const s=await new SessionStore(home).snapshot(id);assert.equal(s.recentCalls.length,2);assert.equal(s.requests,2);assert.equal(s.recentCalls[0].source,'token_count');
 }finally{await rm(home,{recursive:true,force:true});}
});
test('session names use latest valid index entry and tolerate missing titles and partial rows',async()=>{
 const home=await mkdtemp(join(tmpdir(),'metrics-names-'));const other='44444444-4444-4444-4444-444444444444';
 try{await mkdir(join(home,'sessions'));for(const uuid of [id,other])await writeFile(join(home,'sessions','rollout-'+uuid+'.jsonl'),'');
 const row=title=>JSON.stringify({id,thread_name:title})+'\n';
 await writeFile(join(home,'session_index.jsonl'),row('旧名称')+row('新名称')+'{partial');
 const store=new SessionStore(home);const list=await store.list(id);assert.equal(list.find(s=>s.id===id).title,'新名称');assert.equal(list.find(s=>s.id===other).title,'未命名会话');assert.equal((await store.snapshot(id)).title,'新名称');
 }finally{await rm(home,{recursive:true,force:true});}
});
test('incremental log parsing preserves partial rows and never double-counts usage',async()=>{
  const home=await mkdtemp(join(tmpdir(),'metrics-test-'));
  try{await mkdir(join(home,'sessions'));const path=join(home,'sessions','rollout-'+id+'.jsonl');const row=(type,payload)=>JSON.stringify({timestamp:'2026-11-13T02:00:00Z',type,payload})+'\n';
    await writeFile(path,row('session_meta',{model_provider:'custom'})+row('event_msg',{type:'task_started',turn_id:'t1',model_context_window:1000})+row('turn_context',{model:'test-model'}));
    const store=new SessionStore(home);let s=await store.snapshot(id);assert.equal(s.active,true);assert.equal(s.total,null);
    const u=row('token_usage_record',{response_id:'r1',usage:{input_tokens:100,output_tokens:10,total_tokens:110},thread_token_usage:{total_tokens:110},turn_token_usage:{output_tokens:10}});
    await appendFile(path,u.slice(0,30));s=await store.snapshot(id);assert.equal(s.requests,0);
    await appendFile(path,u.slice(30)+u);s=await store.snapshot(id);assert.equal(s.requests,1);assert.equal(s.contextPercent,11);assert.equal(s.turn.output_tokens,10);
    s=await store.snapshot(id);assert.equal(s.requests,1);
    await appendFile(path,row('event_msg',{type:'task_complete',turn_id:'t1',time_to_first_token_ms:450}));s=await store.snapshot(id);assert.equal(s.active,false);assert.equal(s.ttftMs,450);
    await appendFile(path,row('event_msg',{type:'task_started',turn_id:'t2'}));s=await store.snapshot(id);assert.equal(s.turn,null);assert.equal(s.ttftTurnId,'t1');
    await assert.rejects(()=>store.snapshot('../../config.toml'));
  }finally{await rm(home,{recursive:true,force:true});}
});
