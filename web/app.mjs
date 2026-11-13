import {App,applyDocumentTheme} from '@modelcontextprotocol/ext-apps';
const el=id=>document.getElementById(id),set=(id,v)=>{el(id).textContent=v;};
const fmt=v=>v==null?'—':new Intl.NumberFormat('zh-CN',{maximumFractionDigits:0}).format(v);
let threadId=null,snapshot=null,stopped=false,busy=false,app=null,connected=false,currentThreadId=null;
const preview=location.protocol==='http:'&&location.hostname==='127.0.0.1';
function error(e){set('error',e?.message||String(e));el('error').classList.remove('hide');set('live','连接异常');}
function render(s){snapshot=s;threadId=s.id;el('error').classList.add('hide');set('live',s.active?'本轮进行中':'已同步');set('context',s.contextPercent==null?'—':s.contextPercent.toFixed(1)+'%');el('fill').style.width=Math.min(100,s.contextPercent||0)+'%';el('progress').setAttribute('aria-valuenow',String(s.contextPercent||0));set('capacity',fmt(s.contextUsed)+' / '+fmt(s.window)+' tokens');set('remaining',s.window&&s.contextUsed!=null?'剩余 '+fmt(Math.max(0,s.window-s.contextUsed)):'—');
  const a=s.timing?.average;
  set('ttft',a?.ttftMs!=null?(a.ttftMs/1000).toFixed(2):'—');
  set('ttft-note',a?.ttftSamples?'近 10 次调用 · '+a.ttftSamples+' 个有效样本':'等待模型调用计时');
  set('tps',a?.tps!=null?'≈ '+a.tps.toFixed(1):'—');
  set('tps-note',a?.tpsSamples?'近 10 次调用 · '+a.tpsSamples+' 个有效样本':'需启用计时代理');
  const u=s[el('scope').value];set('input',fmt(u?.input_tokens));set('output',fmt(u?.output_tokens));set('cached',fmt(u?.cached_input_tokens));const cachePercent=Number.isFinite(u?.input_tokens)&&u.input_tokens>0&&Number.isFinite(u?.cached_input_tokens)?u.cached_input_tokens/u.input_tokens*100:null;set('cache-ratio',cachePercent==null?'—':cachePercent.toFixed(1)+'%');set('reasoning','推理 '+fmt(u?.reasoning_output_tokens));set('requests','会话请求 '+fmt(s.requests));set('model',(s.model||'未知模型')+' · '+(s.provider||'未知提供商'));syncSelection(s);set('updated',new Date(s.sampledAt).toLocaleTimeString('zh-CN',{hour12:false}));}
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
  app=new App({name:'会话指标',version:'0.1.5'});
  app.ontoolresult=r=>{const d=r.structuredContent;if(!d)return;if(d.threadId)currentThreadId=d.threadId;if(d.sessions)showSessions(d.sessions);if(d.snapshot)render(d.snapshot);else if(d.threadId){threadId=d.threadId;poll();}else if(d.needsBinding){set('live','请选择会话');set('binding-note','选择会话名称后查看指标。');}};
  app.onhostcontextchanged=ctx=>{if(ctx.theme)applyDocumentTheme(ctx.theme);};app.onteardown=async()=>{stopped=true;return {};};
  try{await app.connect();connected=true;const ctx=app.getHostContext();if(ctx?.theme)applyDocumentTheme(ctx.theme);if(!threadId)set('live','请选择会话');await loadSessions();poll();}catch(e){error(e);}
}
setInterval(()=>{if(connected)poll();},1000);
