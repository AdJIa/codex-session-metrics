import {App,applyDocumentTheme} from '@modelcontextprotocol/ext-apps';
import {cacheRatio} from '../src/metrics.mjs';
const el=id=>document.getElementById(id),set=(id,v)=>{el(id).textContent=v;};
const fmt=v=>v==null?'—':new Intl.NumberFormat('zh-CN',{maximumFractionDigits:0}).format(v);
let threadId=null,snapshot=null,stopped=false,busy=false,app=null,connected=false,currentThreadId=null;
const preview=location.protocol==='http:'&&location.hostname==='127.0.0.1';
function error(e){set('error',e?.message||String(e));el('error').classList.remove('hide');set('live','连接异常');}
const seconds=v=>v==null?'—':(v/1000).toLocaleString('zh-CN',{maximumFractionDigits:2});
const percent=v=>v==null?'—':v.toFixed(1)+'%';
const time=v=>v?new Date(v).toLocaleString('zh-CN',{hour12:false}):'—';
const modelLabel=c=>[c?.model||'未知模型',c?.effort,c?.provider,c?.serviceTier].filter(Boolean).join(' · ');
const configurations=t=>(t?.configurations||[]).map(modelLabel).join(' → ')||'该轮模型配置未记录';
function render(s){
  snapshot=s;threadId=s.id;el('error').classList.add('hide');set('live',s.active?'本轮进行中':'已同步');
  set('context',percent(s.contextPercent));el('fill').style.width=(s.contextPercent||0)+'%';el('progress').setAttribute('aria-valuenow',String(s.contextPercent||0));
  set('capacity',fmt(s.contextUsed)+' / '+fmt(s.window)+' tokens');set('remaining',s.window&&s.contextUsed!=null?'剩余 '+fmt(Math.max(0,s.window-s.contextUsed)):'—');
  set('context-note',s.context?'快照更新于 '+time(s.context.recordedAt)+(s.context.source==='compaction'?' · 压缩后':' · 请求结算后'):'等待上下文快照');
  const turn=s.latestCompletedTurn;
  set('ttft',turn?.ttftMs!=null?(turn.ttftMs/1000).toFixed(2):'—');set('tps',turn?.tps!=null?turn.tps.toFixed(1):'—');
  set('ttft-note',turn?turn.ttftMs!=null?'完成于 '+time(turn.completedAt):'该轮未记录 TTFT':'暂无已完成轮次');
  set('tps-note',turn?turn.tps!=null?fmt(turn.outputTokens)+' 输出 Token ÷ '+seconds(turn.durationMs)+' 秒（整轮）':'该轮缺少有效耗时或输出用量':'暂无已完成轮次');
  set('turn-model',turn?'该轮配置：'+configurations(turn):'等待已完成轮次');
  set('tool-time',seconds(turn?.toolDurationMs));set('tool-share',percent(turn?.toolPercent));
  el('tool-fill').style.width=(turn?.toolPercent||0)+'%';
  set('tool-note',turn?.toolCount!=null?'已记录 '+turn.toolCount+' 个工具条目，'+turn.timedToolCount+' 个含起止时间；并行重叠区间已合并。':'该轮未记录工具条目起止时间');
  const comp=s.latestCompaction;set('compactions',fmt(s.compactions)+' 次');
  set('compaction-change',comp?fmt(comp.beforeTokens)+' → '+fmt(comp.afterTokens)+' tokens':'暂无压缩记录');
  set('compaction-note',comp?'最近压缩 '+time(comp.recordedAt)+' · '+(comp.reductionPercent==null?'变化量未记录':(comp.reductionPercent>=0?'下降 ':'增加 ')+percent(Math.abs(comp.reductionPercent)))+' · 耗时 '+seconds(comp.durationMs)+' 秒':'');
  renderTurns(s.recentTurns||[],s.turnSummary||{});renderCalls(s.recentCalls||[],s.recent);
  const u=s[el('scope').value];set('input',fmt(u?.input_tokens));set('output',fmt(u?.output_tokens));set('cached',fmt(u?.cached_input_tokens));set('cache-ratio',percent(cacheRatio(u)));
  const uncached=u?.input_tokens!=null&&u?.cached_input_tokens!=null&&u.input_tokens>=u.cached_input_tokens?u.input_tokens-u.cached_input_tokens:null;
  set('uncached','未命中读取缓存 '+fmt(uncached));set('cache-write','缓存写入 '+fmt(u?.cache_write_input_tokens));
  set('reasoning','推理 '+fmt(u?.reasoning_output_tokens));set('requests','已记录调用 '+fmt(s.requests));set('model','当前配置：'+modelLabel(s));syncSelection(s);set('updated',time(s.sampledAt));
}
function rows(target,values){
  el(target).replaceChildren(...values.map(values=>{const row=document.createElement('tr');for(const value of values){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}return row;}));
}
function renderCalls(calls,u){
  set('calls-count',calls.length+' / 10 条');el('calls-empty').classList.toggle('hide',calls.length>0);
  set('recent-cache',percent(cacheRatio(u)));set('recent-cache-note',fmt(u?.cached_input_tokens)+' 缓存 / '+fmt(u?.input_tokens)+' 输入');
  set('recent-write',fmt(u?.cache_write_input_tokens));
  rows('call-rows',calls.slice().reverse().map(call=>[time(call.recordedAt),call.configuration?modelLabel(call.configuration):call.model||'—',fmt(call.usage?.input_tokens),fmt(call.usage?.output_tokens),percent(cacheRatio(call.usage))]));
}
function renderTurns(turns,summary){
  set('turns-count',turns.length+' / 10 轮');set('ttft-mean',seconds(summary.ttftMeanMs)+' 秒');set('ttft-median','中位数 '+seconds(summary.ttftMedianMs)+' 秒 · '+(summary.ttftSamples||0)+' 个有效样本');
  set('tps-weighted',summary.weightedTps!=null?summary.weightedTps.toFixed(1)+' tok/s':'—');set('tps-samples','总输出 ÷ 总耗时 · '+(summary.tpsSamples||0)+' 个有效样本');
  el('turns-empty').classList.toggle('hide',turns.length>0);
  spark('ttft-trend',turns,'ttftMs','TTFT',v=>seconds(v)+' 秒');spark('tps-trend',turns,'tps','TPS',v=>v.toFixed(1)+' tok/s');
  rows('turn-rows',turns.slice().reverse().map(t=>[time(t.completedAt),configurations(t),seconds(t.ttftMs),t.tps==null?'—':t.tps.toFixed(1),percent(t.toolPercent)]));
}
function spark(id,turns,key,label,format){
  const svg=el(id),ns='http://www.w3.org/2000/svg';svg.replaceChildren();
  const values=turns.map(t=>t[key]);const valid=values.filter(v=>v!=null);const max=Math.max(...valid,1);
  svg.setAttribute('aria-label',label+' 趋势，旧到新：'+values.map(v=>v==null?'缺失':format(v)).join('，'));
  let segment=[];
  const flush=()=>{if(segment.length>1){const line=document.createElementNS(ns,'polyline');line.setAttribute('points',segment.join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','currentColor');line.setAttribute('stroke-width','2');svg.append(line);}segment=[];};
  values.forEach((v,i)=>{if(v==null){flush();return;}const x=10+i*280/Math.max(1,values.length-1),y=58-v/max*48;segment.push(x+','+y);
    const point=document.createElementNS(ns,'circle');point.setAttribute('cx',x);point.setAttribute('cy',y);point.setAttribute('r','3');point.setAttribute('fill','currentColor');
    const title=document.createElementNS(ns,'title');title.textContent=time(turns[i].completedAt)+' · '+configurations(turns[i])+' · '+format(v);point.append(title);svg.append(point);
  });flush();
}
async function call(name,args={}){const r=await app.callServerTool({name,arguments:args});if(r.isError)throw new Error(r.content?.find(c=>c.type==='text')?.text||'工具返回错误');return r.structuredContent;}
function syncSelection(s){
  const select=el('sessions');
  let option=Array.from(select.options).find(o=>o.value===s.id);
  const title=s.title||'未命名会话';
  const label=title+(s.id===currentThreadId?'（当前会话）':'');
  if(!option){option=new Option(label,s.id);select.add(option);}else option.textContent=label;
  select.value=s.id;
  set('binding-note',s.id===currentThreadId?'已绑定当前会话':'正在查看所选会话；可从列表切回当前会话。');
}
function showSessions(sessions){
  const counts=new Map();for(const s of sessions)counts.set(s.title,(counts.get(s.title)||0)+1);
  const options=sessions.map(s=>new Option((s.title||'未命名会话')+(s.id===currentThreadId?'（当前会话）':'')+(counts.get(s.title)>1?' · '+new Date(s.mtime).toLocaleString('zh-CN'):''),s.id));
  el('sessions').replaceChildren(new Option(sessions.length?'请选择会话':'暂无本机会话',''),...options);
  if(snapshot&&snapshot.id===threadId)syncSelection(snapshot);else el('sessions').value=threadId||'';
}
async function loadSessions(){try{const d=await call('list_sessions',threadId?{thread_id:threadId}:{});showSessions(d.sessions||[]);}catch(e){error(e);}}
async function poll(){if(stopped||busy||(!threadId&&!preview))return;busy=true;const requestedId=threadId;try{const d=preview?await (await fetch('/snapshot')).json():await call('read_metrics',{thread_id:requestedId});if(d.error)throw new Error(d.error);if(threadId===requestedId)render(d);}catch(e){if(threadId===requestedId)error(e);}finally{busy=false;if(threadId!==requestedId)poll();}}
el('scope').onchange=()=>snapshot&&snapshot.id===threadId&&render(snapshot);
el('refresh-sessions').onclick=()=>!preview&&loadSessions();
el('sessions').onchange=()=>{const selected=el('sessions').value;if(selected){threadId=selected;set('live','切换中');poll();}};
if(preview){connected=true;poll();}else{
  app=new App({name:'会话指标',version:'0.1.9'});
  app.ontoolresult=r=>{const d=r.structuredContent;if(!d)return;if(d.threadId)currentThreadId=d.threadId;if(d.sessions)showSessions(d.sessions);if(d.snapshot)render(d.snapshot);else if(d.threadId){threadId=d.threadId;poll();}else if(d.needsBinding){set('live','请选择会话');set('binding-note','选择会话名称后查看指标。');}};
  app.onhostcontextchanged=ctx=>{if(ctx.theme)applyDocumentTheme(ctx.theme);};app.onteardown=async()=>{stopped=true;return {};};
  try{await app.connect();connected=true;const ctx=app.getHostContext();if(ctx?.theme)applyDocumentTheme(ctx.theme);if(!threadId)set('live','请选择会话');await loadSessions();poll();}catch(e){error(e);}
}
setInterval(()=>{if(connected)poll();},1000);
