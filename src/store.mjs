import {readdir,readFile,stat,open} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {StringDecoder} from 'node:string_decoder';
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const keys=['input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens','reasoning_output_tokens','total_tokens'];
const usage=u=>Object.fromEntries(keys.map(k=>[k,Number.isFinite(u?.[k])?u[k]:0]));
export class SessionStore {
  constructor(home=process.env.CODEX_HOME||join(homedir(),'.codex')){this.home=home;this.files=new Map();this.cache=new Map();this.scanned=0;}
  async discover(){
    if(Date.now()-this.scanned<10000)return;this.scanned=Date.now();
    const walk=async dir=>{for(const e of await readdir(dir,{withFileTypes:true}).catch(()=>[])){const p=join(dir,e.name);if(e.isDirectory())await walk(p);else {const m=e.name.match(/([a-f0-9-]{36})\.jsonl$/i);if(m&&UUID.test(m[1]))this.files.set(m[1],p);}}};
    await walk(join(this.home,'sessions'));
  }
  async titles(){
    const path=join(this.home,'session_index.jsonl');
    try{const info=await stat(path);if(this.titleStamp===info.mtimeMs)return this.titleMap;
      const names=new Map();for(const line of (await readFile(path,'utf8')).split('\n')){try{const r=JSON.parse(line);if(UUID.test(r.id||'')&&typeof r.thread_name==='string'&&r.thread_name.trim())names.set(r.id,r.thread_name.trim());}catch{}}
      this.titleMap=names;this.titleStamp=info.mtimeMs;return names;
    }catch{return new Map();}
  }
  async list(selectedId){await this.discover();const titles=await this.titles();const rows=(await Promise.all([...this.files].map(async([id,p])=>{try{return {id,title:titles.get(id)||'未命名会话',mtime:(await stat(p)).mtimeMs};}catch{return null;}}))).filter(Boolean).sort((a,b)=>b.mtime-a.mtime);const recent=rows.slice(0,30);const selected=rows.find(r=>r.id===selectedId);if(selected&&!recent.some(r=>r.id===selectedId))recent.push(selected);return recent;}
  async snapshot(id){
    if(!UUID.test(id||''))throw new Error('请从列表中选择有效会话');
    await this.discover();const file=this.files.get(id);if(!file)throw new Error('本机未找到该会话记录；远程会话需要在对应主机运行插件。');
    const s=await stat(file);let c=this.cache.get(id);
    if(!c||s.size<c.offset){c={offset:0,pending:'',decoder:new StringDecoder('utf8'),state:{id,model:null,provider:null,window:null,last:null,total:null,turn:null,turnId:null,active:false,startedAt:null,ttftMs:null,ttftTurnId:null,requests:0,compactions:0,updatedAt:null,recentCalls:[]},seen:new Set(),hasUsageRecords:false,lastLegacyTotal:null};this.cache.set(id,c);}
    if(s.size>c.offset){const h=await open(file,'r');try{while(c.offset<s.size){const b=Buffer.alloc(Math.min(s.size-c.offset,1024*1024));const {bytesRead}=await h.read(b,0,b.length,c.offset);if(!bytesRead)break;c.offset+=bytesRead;const lines=(c.pending+c.decoder.write(b.subarray(0,bytesRead))).split('\n');c.pending=lines.pop();for(const l of lines){try{this.apply(c,JSON.parse(l));}catch{}}}}finally{await h.close();}}
    const st=c.state;const used=st.last?.total_tokens??null;
    return {...st,title:(await this.titles()).get(id)||'未命名会话',contextUsed:used,contextPercent:used!==null&&st.window?used/st.window*100:null,contextBasis:'最近一次模型请求的输入 + 输出 Token（快照；下次请求前可能增长）',sampledAt:new Date().toISOString(),timing:{source:'codex',recordedCalls:st.recentCalls.length,ttftUnavailableReason:'Codex 调用记录未保存逐次 TTFT',tpsUnavailableReason:'Codex 调用记录未保存输出时长',average:{window:10,calls:st.recentCalls.length,ttftMs:null,ttftSamples:0,tps:null,tpsSamples:0}}};
  }
  apply(c,r){const p=r.payload||{},s=c.state;s.updatedAt=r.timestamp||s.updatedAt;
    if(r.type==='session_meta'){s.provider=p.model_provider||null;return;}
    if(r.type==='turn_context'){s.model=p.model||s.model;return;}
    if(r.type==='token_usage_record'){
      if(!c.hasUsageRecords){c.hasUsageRecords=true;s.recentCalls=[];s.requests=0;c.seen.clear();}
      const rid=p.response_id||'ordinal:'+r.ordinal;if(!c.seen.has(rid)){s.requests++;c.seen.add(rid);s.recentCalls=[...s.recentCalls,{responseId:p.response_id||null,turnId:p.turn_id||s.turnId,recordedAt:r.timestamp||null,model:s.model,usage:usage(p.usage),source:'token_usage_record'}].slice(-10);}
      s.last=usage(p.usage);s.total=usage(p.thread_token_usage);s.turn=usage(p.turn_token_usage);return;
    }
    if(r.type!=='event_msg')return;
    if(p.type==='task_started'){s.turnId=p.turn_id;s.active=true;s.startedAt=p.started_at?new Date(p.started_at*1000).toISOString():r.timestamp;s.window=p.model_context_window||s.window;s.turn=null;}
    if(p.type==='task_complete'){s.active=false;s.ttftMs=p.time_to_first_token_ms??null;s.ttftTurnId=p.turn_id;}
    if(p.type==='turn_aborted')s.active=false;
    if(p.type==='context_compacted')s.compactions++;
    if(p.type==='token_count'&&p.info){s.total=usage(p.info.total_token_usage);s.last=usage(p.info.last_token_usage);s.window=p.info.model_context_window||s.window;
      // Older Codex versions only write token_count. Cumulative usage must
      // advance before treating a repeated snapshot as a new completed call.
      const total=p.info.total_token_usage?.total_tokens;
      if(!c.hasUsageRecords&&Number.isFinite(total)&&total>0&&total!==c.lastLegacyTotal){c.lastLegacyTotal=total;s.requests++;s.recentCalls=[...s.recentCalls,{responseId:null,turnId:s.turnId,recordedAt:r.timestamp||null,model:s.model,usage:s.last,source:'token_count'}].slice(-10);}
    }
  }
}
