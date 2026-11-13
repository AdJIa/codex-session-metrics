import {readFile,open} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createConnection} from 'node:net';
import {spawn} from 'node:child_process';
export async function ensureProxy(){
 const home=process.env.CODEX_HOME||join(homedir(),'.codex');
 let state;try{state=JSON.parse(await readFile(join(home,'session-metrics','timing-install.json'),'utf8'));}catch{return;}
 if(!state.enabled)return;
 const alive=await new Promise(resolve=>{const s=createConnection({host:'127.0.0.1',port:43188});s.on('connect',()=>{s.destroy();resolve(true);});s.on('error',()=>resolve(false));s.setTimeout(500,()=>{s.destroy();resolve(false);});});
 if(alive)return;
 const log=await open(join(home,'session-metrics','proxy.log'),'a',0o600);
 const child=spawn(process.execPath,[new URL('./proxy.mjs',import.meta.url).pathname],{env:{...process.env,METRICS_UPSTREAM:state.upstream,METRICS_PROXY_PORT:'43188'},detached:true,stdio:['ignore',log.fd,log.fd]});child.unref();await log.close();
}
