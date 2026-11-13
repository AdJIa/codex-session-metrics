import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('built MCP server advertises native thread panel and returns live bound metrics',async()=>{
 const home=await mkdtemp(join(tmpdir(),'metrics-mcp-'));const fixtureId='33333333-3333-3333-3333-333333333333';
 await mkdir(join(home,'sessions'));await writeFile(join(home,'sessions','rollout-'+fixtureId+'.jsonl'),JSON.stringify({type:'session_meta',payload:{model_provider:'test'}})+'\n');
 await writeFile(join(home,'session_index.jsonl'),JSON.stringify({id:fixtureId,thread_name:'测试会话名称'})+'\n');
 const c=new Client({name:'test',version:'1'});const t=new StdioClientTransport({command:process.execPath,args:['dist/server.mjs'],env:{...process.env,CODEX_HOME:home},stderr:'pipe'});
 try{await c.connect(t);const tools=await c.listTools();const open=tools.tools.find(t=>t.name==='open_metrics');assert.equal(open._meta['openai/ui'].entrypoints[0].type,'thread');
 assert.deepEqual(open._meta.ui.visibility,['app']);
 const r=await c.callTool({name:'open_metrics',arguments:{}});assert.equal(r.structuredContent.needsBinding,true);
 const list=await c.callTool({name:'list_sessions',arguments:{}});const id=list.structuredContent.sessions[0].id;
 const bound=await c.callTool({name:'open_metrics',arguments:{thread_id:id}});assert.equal(bound.structuredContent.threadId,id);assert.equal(bound.structuredContent.snapshot.id,id);assert.equal(bound.structuredContent.needsBinding,false);
 assert.equal(bound.structuredContent.snapshot.title,'测试会话名称');assert.equal(bound.structuredContent.sessions[0].title,'测试会话名称');
 // Native desktop entrypoints send {} and carry the active thread in _meta.
 const native=await c.callTool({name:'open_metrics',arguments:{},_meta:{thread_id:id,threadId:id}});assert.equal(native.structuredContent.threadId,id);assert.equal(native.structuredContent.snapshot.title,'测试会话名称');assert.equal(native.structuredContent.needsBinding,false);
 const second='66666666-6666-6666-6666-666666666666';
 const isolated=await c.callTool({name:'open_metrics',arguments:{thread_id:second},_meta:{thread_id:id}});assert.equal(isolated.structuredContent.threadId,id);
 const snap=await c.callTool({name:'read_metrics',arguments:{thread_id:id}});assert.equal(snap.structuredContent.id,id);
 const ui=await c.readResource({uri:open._meta.ui.resourceUri});assert.match(ui.contents[0].text,/会话指标/);assert.equal(ui.contents[0]._meta['openai/ui'].preferredDisplayMode,'fullscreen');
 assert.doesNotMatch(ui.contents[0].text,/<input[^>]*id="thread-id"/);
 }finally{await c.close();await rm(home,{recursive:true,force:true});}
});
