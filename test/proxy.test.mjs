import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('proxy preserves stream bytes, auth and thread isolation, stores no prompt',async()=>{
 const home=await mkdtemp(join(tmpdir(),'metrics-proxy-'));const id='22222222-2222-2222-2222-222222222222';let received;
 const events=[{type:'response.created',response:{id:'r-test'}},{type:'response.output_text.delta',delta:'你'},{type:'response.output_text.delta',delta:'好'},{type:'response.completed',response:{id:'r-test',usage:{output_tokens:40,output_tokens_details:{reasoning_tokens:10}}}}];
 const expected=events.map(e=>'data: '+JSON.stringify(e)+'\n\n');
 const upstream=http.createServer(async(req,res)=>{received={url:req.url,auth:req.headers.authorization,body:''};for await(const b of req)received.body+=b.toString();res.writeHead(200,{'Content-Type':'text/event-stream'});for(const e of expected){res.write(e);await wait(80);}res.end();});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));const up=upstream.address().port;
 const p=spawn(process.execPath,['dist/proxy.mjs'],{env:{...process.env,CODEX_HOME:home,METRICS_UPSTREAM:'http://127.0.0.1:'+up+'/v1',METRICS_PROXY_PORT:'43189'},stdio:['ignore','ignore','pipe']});
 try{await new Promise((resolve,reject)=>{p.stderr.on('data',b=>{if(b.toString().includes('Metrics proxy on'))resolve();});p.on('exit',c=>reject(new Error('proxy exit '+c)));setTimeout(()=>reject(new Error('startup timeout')),5000).unref();});
 const response=await fetch('http://127.0.0.1:43189/v1/responses',{method:'POST',headers:{authorization:'Bearer test-secret',session_id:id,'content-type':'application/json'},body:JSON.stringify({input:'PRIVATE_PROMPT'})});assert.equal(await response.text(),expected.join(''));assert.equal(received.url,'/v1/responses');assert.equal(received.auth,'Bearer test-secret');assert.match(received.body,/PRIVATE_PROMPT/);
 await wait(100);const saved=await readFile(join(home,'session-metrics',id+'.json'),'utf8');assert.doesNotMatch(saved,/PRIVATE_PROMPT|test-secret|你好/);const m=JSON.parse(saved);assert.equal(m.current.outputTokens,30);assert.ok(m.average.tps>0);assert.equal(m.current.active,false);assert.ok(m.average.ttftMs>=0);assert.equal(m.history.length,1);
 const blocked=await fetch('http://127.0.0.1:43189/v1/responses',{headers:{origin:'https://example.com'}});assert.equal(blocked.status,403);
 }finally{p.kill();await new Promise(r=>upstream.close(r));await rm(home,{recursive:true,force:true});}
});
