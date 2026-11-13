import {readdir,readFile,stat,open} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {StringDecoder} from 'node:string_decoder';
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
import {usage,nonnegative,timestamp,iso,zeroUsage,addUsage,sumUsage,usageDifference,cacheRatio,completedTurn,turnSummary} from './metrics.mjs';
const toolKinds=new Set(['commandexecution','mcptoolcall','filechange','dynamictoolcall','collabtoolcall']);
const configuration=s=>({model:s.model,effort:s.effort,provider:s.provider,serviceTier:s.serviceTier});
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
    const info=await stat(file);let c=this.cache.get(id);
    if(!c||info.size<c.offset||c.inode!==info.ino){
      c={offset:0,inode:info.ino,pending:'',decoder:new StringDecoder('utf8'),
        state:{id,model:null,effort:null,provider:null,serviceTier:null,window:null,last:null,total:null,turn:null,turnId:null,active:false,startedAt:null,ttftMs:null,ttftTurnId:null,latestCompletedTurn:null,requests:0,compactions:0,latestCompaction:null,context:null,updatedAt:null,recentCalls:[],recentTurns:[]},
        seen:new Set(),sequence:0,hasUsageRecords:false,lastLegacyTotal:null,currentTurn:null,completed:new Set(),compactionSignals:new Map(),compactionRecords:[],pendingCompaction:null};
      this.cache.set(id,c);
    }
    if(info.size>c.offset){
      const h=await open(file,'r');
      try{while(c.offset<info.size){
        const b=Buffer.alloc(Math.min(info.size-c.offset,1024*1024));const {bytesRead}=await h.read(b,0,b.length,c.offset);if(!bytesRead)break;
        c.offset+=bytesRead;const lines=(c.pending+c.decoder.write(b.subarray(0,bytesRead))).split('\n');c.pending=lines.pop();
        for(const line of lines){let record;try{record=JSON.parse(line);}catch{continue;}this.apply(c,record);}
      }}finally{await h.close();}
    }
    const st=c.state;const used=st.context?.tokens??null;
    const recentUsage=sumUsage(st.recentCalls.map(call=>call.usage));
    return {...st,title:(await this.titles()).get(id)||'未命名会话',
      contextUsed:used,contextPercent:used!=null&&st.window>0?Math.min(100,used/st.window*100):null,
      contextBasis:'Codex 最近上下文快照 / 有效模型窗口；压缩快照与请求用量分别保存',
      recent:recentUsage,recentCacheRatio:cacheRatio(recentUsage),turnSummary:turnSummary(st.recentTurns),
      sampledAt:new Date().toISOString(),timing:{source:'codex',recordedCalls:st.recentCalls.length,latestCompletedTurn:st.latestCompletedTurn}};
  }
  setContext(c,tokens,at,source){
    if(nonnegative(tokens)==null)return;
    c.state.context={tokens,recordedAt:at||null,source};
  }
  settings(c,p){
    const s=c.state;
    if(p.model)s.model=p.model;
    if('effort' in p)s.effort=p.effort;
    if('reasoning_effort' in p)s.effort=p.reasoning_effort;
    if(p.model_provider_id||p.model_provider)s.provider=p.model_provider_id||p.model_provider;
    if('service_tier' in p)s.serviceTier=p.service_tier;
    if(c.currentTurn)c.currentTurn.configuration=configuration(s);
  }
  recordCall(c,call){
    const s=c.state;s.requests++;s.recentCalls=[...s.recentCalls,call].slice(-10);s.last=call.usage;
    const turn=c.currentTurn;
    if(turn&&(!call.turnId||call.turnId===turn.id)){
      turn.calls++;
      if(!turn.configurations.some(v=>JSON.stringify(v)===JSON.stringify(call.configuration)))turn.configurations.push(call.configuration);
    }
  }
  compaction(c,r,source,p){
    const s=c.state;const at=timestamp(r.timestamp);const start=nonnegative(p.started_at_ms);const end=nonnegative(p.completed_at_ms)??at;
    const identity=source==='record'?(p.window_id??p.compaction_response_id??p.window_number):source==='item'?p.item?.id:p.id;
    const key=source+':'+(identity??r.timestamp??c.sequence);
    if(c.compactionSignals.has(key))return c.compactionSignals.get(key);
    // A persisted compaction and its lifecycle item describe the same operation.
    // Join only different signal types in the same turn and completion interval.
    let entry=c.compactionRecords.slice().reverse().find(e=>e.turnId===(p.turn_id||s.turnId)&&!e.sources.has(source)&&at!=null&&e.at!=null&&(Math.abs(e.at-at)<=2000||(start!=null&&e.at>=start&&e.at<=(end??at))));
    if(!entry){
      entry={at,turnId:p.turn_id||s.turnId,sources:new Set(),value:{recordedAt:r.timestamp||null,beforeTokens:s.context?.tokens??null,afterTokens:null,reductionPercent:null,durationMs:null}};
      c.compactionRecords.push(entry);s.compactions++;
    }
    entry.sources.add(source);c.compactionSignals.set(key,entry);
    if(source==='item'&&start!=null&&end>=start)entry.value.durationMs=end-start;
    if(entry.value.afterTokens==null)c.pendingCompaction=entry;
    s.latestCompaction=entry.value;return entry;
  }
  apply(c,r){
    const p=r.payload||{},s=c.state;c.sequence++;s.updatedAt=r.timestamp||s.updatedAt;
    if(r.type==='session_meta'){s.provider=p.model_provider||null;return;}
    if(r.type==='turn_context'){this.settings(c,p);return;}
    if(r.type==='compacted'){this.compaction(c,r,'record',p);return;}
    if(r.type==='token_usage_record'){
      const rid=p.response_id??('ordinal:'+(r.ordinal??c.sequence));
      if(c.seen.has(rid))return;
      if(!c.hasUsageRecords){c.hasUsageRecords=true;s.recentCalls=[];s.requests=0;c.seen.clear();}
      c.seen.add(rid);const u=usage(p.usage);
      this.recordCall(c,{responseId:p.response_id||null,turnId:p.turn_id||s.turnId,recordedAt:r.timestamp||null,model:s.model,configuration:configuration(s),usage:u,source:'token_usage_record'});
      const turn=c.currentTurn;
      if(turn&&(!p.turn_id||p.turn_id===turn.id)){
        turn.summedUsage=addUsage(turn.summedUsage,u);
        turn.nativeUsage=p.turn_token_usage?usage(p.turn_token_usage):null;
        s.turn=turn.nativeUsage??turn.summedUsage;
      }
      if(p.thread_token_usage)s.total=usage(p.thread_token_usage);
      this.setContext(c,u.total_tokens,r.timestamp,'request');c.pendingCompaction=null;return;
    }
    if(r.type!=='event_msg')return;
    if(p.type==='thread_settings_applied'){this.settings(c,p.thread_settings||{});return;}
    if(p.type==='task_started'){
      s.turnId=p.turn_id;s.active=true;s.startedAt=iso(timestamp(p.started_at)??timestamp(r.timestamp));s.window=p.model_context_window||s.window;s.turn=null;
      c.currentTurn={id:p.turn_id,startedAt:timestamp(r.timestamp)??timestamp(p.started_at),configuration:configuration(s),configurations:[],calls:0,nativeUsage:null,summedUsage:null,legacyBase:s.total??zeroUsage(),legacyUsage:null,hasItems:false,tools:new Map()};
      return;
    }
    if(p.type==='item_completed'){
      const kind=(p.item?.type||'').replaceAll('_','').toLowerCase();
      if(kind==='contextcompaction')this.compaction(c,r,'item',p);
      const turn=c.currentTurn;
      if(turn&&(!p.turn_id||p.turn_id===turn.id)){
        turn.hasItems=true;
        if(toolKinds.has(kind))turn.tools.set(p.item.id??r.ordinal??c.sequence,{start:nonnegative(p.started_at_ms),end:nonnegative(p.completed_at_ms)});
      }
      return;
    }
    if(p.type==='task_complete'){
      const id=p.turn_id||s.turnId;if(c.completed.has(id))return;c.completed.add(id);
      const turn=c.currentTurn;const matches=turn&&(!p.turn_id||p.turn_id===turn.id);
      s.latestCompletedTurn=completedTurn(p,r,matches?turn:null);s.ttftMs=s.latestCompletedTurn.ttftMs;s.ttftTurnId=s.latestCompletedTurn.turnId;
      s.recentTurns=[...s.recentTurns,s.latestCompletedTurn].slice(-10);
      if(!turn||matches){s.active=false;c.currentTurn=null;}
      return;
    }
    if(p.type==='turn_aborted'&&(!p.turn_id||p.turn_id===s.turnId)){s.active=false;c.currentTurn=null;return;}
    if(p.type==='context_compacted'){this.compaction(c,r,'legacy',p);return;}
    if(p.type==='token_count'&&p.info){
      const info=p.info;const total=usage(info.total_token_usage);const last=usage(info.last_token_usage);
      s.window=info.model_context_window||s.window;
      const synthetic=info.last_usage_includes_reasoning===true&&last.input_tokens===0&&last.output_tokens===0&&last.total_tokens>0;
      const compacted=!!c.pendingCompaction||synthetic;
      this.setContext(c,last.total_tokens,r.timestamp,compacted?'compaction':'request');
      if(c.pendingCompaction&&last.total_tokens!=null){
        const v=c.pendingCompaction.value;v.afterTokens=last.total_tokens;
        v.reductionPercent=v.beforeTokens>0?(v.beforeTokens-v.afterTokens)/v.beforeTokens*100:null;c.pendingCompaction=null;
      }
      // Native cumulative usage remains authoritative; token_count also carries
      // synthetic context-only snapshots after compaction.
      if(!c.hasUsageRecords){
        if(info.total_token_usage)s.total=total;
        if(c.currentTurn){c.currentTurn.legacyUsage=usageDifference(total,c.currentTurn.legacyBase);s.turn=c.currentTurn.legacyUsage;}
        const n=total.total_tokens;const advanced=n!=null&&n>0&&n!==c.lastLegacyTotal;
        if(!compacted&&advanced)this.recordCall(c,{responseId:null,turnId:s.turnId,recordedAt:r.timestamp||null,model:s.model,configuration:configuration(s),usage:last,source:'token_count'});
        if(n!=null)c.lastLegacyTotal=n;
      }
    }
  }
}
