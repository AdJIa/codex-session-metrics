import http from 'node:http';
import https from 'node:https';
import {mkdir,writeFile,rename,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {StreamTiming} from './stream.mjs';
import {getEncoding} from 'js-tiktoken';
import {updateTimingHistory} from './averages.mjs';
const encoder=getEncoding('o200k_base');
if(!process.env.METRICS_UPSTREAM)throw new Error('Set METRICS_UPSTREAM to your custom gateway URL');
const upstream=new URL(process.env.METRICS_UPSTREAM);
const port=Number(process.env.METRICS_PROXY_PORT||43188);
if(!['http:','https:'].includes(upstream.protocol)||upstream.username||upstream.password)throw new Error('Invalid upstream URL');
const root=join(process.env.CODEX_HOME||join(homedir(),'.codex'),'session-metrics');
const valid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
function threadOf(headers){
  for(const k of ['thread_id','x-codex-thread-id','session_id','x-codex-session-id'])if(valid(headers[k]))return headers[k];
  return null;
}
const pending=new Map();
function persist(id,data){if(!id)return;const prior=pending.get(id)||Promise.resolve();const next=prior.catch(()=>{}).then(async()=>{await mkdir(root,{recursive:true,mode:0o700});const path=join(root,id+'.json');let previous=null;try{previous=JSON.parse(await readFile(path,'utf8'));}catch{}const out=updateTimingHistory(previous,data);const tmp=join(root,id+'.'+randomUUID()+'.tmp');await writeFile(tmp,JSON.stringify(out),{mode:0o600});await rename(tmp,path);});pending.set(id,next);next.catch(e=>console.error('Timing write failed:',e.code||'unknown'));}
const server=http.createServer((req,res)=>{
  const host=req.headers.host;if(host!=='127.0.0.1:'+port&&host!=='localhost:'+port){res.writeHead(403).end();return;}
  if(req.headers.origin){res.writeHead(403).end();return;}
  let target;try{target=new URL(req.url,upstream.origin);if(target.origin!==upstream.origin)throw new Error();}catch{res.writeHead(400).end();return;}
  const timing=new StreamTiming(()=>performance.now(),text=>encoder.encode(text).length),id=threadOf(req.headers),decoder=new StringDecoder('utf8'),callId=randomUUID();let lastWrite=0;
  const summary=active=>({...timing.summary(active),callId});
  const headers={...req.headers,host:upstream.host,'accept-encoding':'identity'};delete headers.connection;
  const forward=(target.protocol==='https:'?https:http).request(target,{method:req.method,headers},r=>{
    res.writeHead(r.statusCode||502,r.headers);const stream=(r.headers['content-type']||'').includes('text/event-stream');
    r.on('data',b=>{if(stream){timing.feed(decoder.write(b));if(Date.now()-lastWrite>500){persist(id,summary(true));lastWrite=Date.now();}}if(!res.write(b))r.pause();});
    res.on('drain',()=>r.resume());
    r.on('end',()=>{if(stream){timing.feed(decoder.end());persist(id,{...summary(false),httpStatus:r.statusCode,completed:timing.completed&&!timing.failed&&r.statusCode>=200&&r.statusCode<300});}res.end();});
    r.on('error',()=>{persist(id,{...summary(false),interrupted:true});res.destroy();});
  });
  forward.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Metrics proxy could not reach the configured upstream'}));});
  req.on('aborted',()=>forward.destroy());res.on('close',()=>{if(!res.writableEnded)forward.destroy();});req.pipe(forward);
});
server.listen(port,'127.0.0.1',()=>console.error('Metrics proxy on 127.0.0.1:'+port+'; upstream '+upstream.origin+'; no credentials or request bodies logged.'));
