import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,appendFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionStore} from '../src/store.mjs';
import {StreamTiming} from '../src/stream.mjs';
const id='11111111-1111-1111-1111-111111111111';
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
test('SSE timing ignores metadata, handles chunks, and subtracts reasoning once',()=>{
  let t=0;const s=new StreamTiming(()=>t);const event=e=>'data: '+JSON.stringify(e)+'\n\n';
  s.feed(event({type:'response.created',response:{id:'r1'}}));assert.equal(s.summary().ttftMs,null);
  t=200;s.feed(event({type:'response.output_text.delta',delta:'你好'}));
  t=1200;const line=event({type:'response.output_text.delta',delta:' world'});s.feed(line.slice(0,9));s.feed(line.slice(9));
  t=1500;s.feed(event({type:'response.completed',response:{usage:{output_tokens:80,output_tokens_details:{reasoning_tokens:20}}}}));
  const m=s.summary();assert.equal(m.ttftMs,200);assert.equal(m.streamMs,1000);assert.equal(m.outputTokens,60);assert.equal(m.tps,60);
});
test('no usage or a single buffered content event never fabricates TPS',()=>{
  let t=0;const s=new StreamTiming(()=>t);t=100;s.event({type:'response.output_text.delta',delta:'all at once'});s.event({response:{usage:{output_tokens:80}}});assert.equal(s.summary().tps,null);
});
