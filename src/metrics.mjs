export const usageKeys=['input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens','reasoning_output_tokens','total_tokens'];
export const nonnegative=v=>Number.isFinite(v)&&v>=0?v:null;
export const timestamp=v=>{
  if(v==null)return null;
  const ms=typeof v==='number'?v*1000:Date.parse(v);
  return Number.isFinite(ms)?ms:null;
};
export const iso=ms=>ms!=null?new Date(ms).toISOString():null;
export const usage=u=>Object.fromEntries(usageKeys.map(k=>[k,nonnegative(u?.[k])]));
export const zeroUsage=()=>Object.fromEntries(usageKeys.map(k=>[k,0]));
export function sumUsage(rows){
  return Object.fromEntries(usageKeys.map(k=>[k,rows.length&&rows.every(u=>u?.[k]!=null)?rows.reduce((n,u)=>n+u[k],0):null]));
}
export function addUsage(a,b){return a?sumUsage([a,b]):usage(b);}
export function usageDifference(end,start){
  return Object.fromEntries(usageKeys.map(k=>[k,end?.[k]!=null&&start?.[k]!=null?nonnegative(end[k]-start[k]):null]));
}
export function cacheRatio(u){
  return u?.input_tokens>0&&u.cached_input_tokens!=null&&u.cached_input_tokens<=u.input_tokens?u.cached_input_tokens/u.input_tokens*100:null;
}
export function unionDuration(intervals){
  let total=0,end=null;
  for(const [a,b] of intervals.slice().sort((a,b)=>a[0]-b[0])){
    if(end==null||a>end){total+=b-a;end=b;}
    else if(b>end){total+=b-end;end=b;}
  }
  return total;
}
export function completedTurn(p,r,turn){
  const startedAt=timestamp(p.started_at)??turn?.startedAt??null;
  const completedAt=timestamp(p.completed_at)??timestamp(r.timestamp);
  const elapsed=startedAt!=null&&completedAt!=null?nonnegative(completedAt-startedAt):null;
  const durationMs=nonnegative(p.duration_ms)??elapsed;
  const outputTokens=turn?.nativeUsage?.output_tokens??turn?.summedUsage?.output_tokens??turn?.legacyUsage?.output_tokens??null;
  const tools=[...(turn?.tools.values()||[])];
  const timed=tools.filter(t=>t.start!=null&&t.end!=null&&t.end>=t.start);
  const boundsStart=turn?.startedAt??startedAt;
  const boundsEnd=timestamp(r.timestamp)??completedAt;
  const intervals=timed.map(t=>[Math.max(t.start,boundsStart??t.start),Math.min(t.end,boundsEnd??t.end)]).filter(([a,b])=>b>=a);
  const toolDurationMs=turn?.hasItems?(timed.length||!tools.length?Math.min(unionDuration(intervals),durationMs??Infinity):null):null;
  const configurations=turn?.configurations.length?turn.configurations:turn?[turn.configuration]:[];
  return {
    turnId:p.turn_id||turn?.id||null,startedAt:iso(startedAt),completedAt:iso(completedAt),
    ttftMs:nonnegative(p.time_to_first_token_ms),durationMs,outputTokens,
    tps:outputTokens!=null&&durationMs>0?outputTokens/(durationMs/1000):null,
    configurations,calls:turn?.calls??null,
    toolDurationMs,toolPercent:toolDurationMs!=null&&durationMs>0?toolDurationMs/durationMs*100:null,
    toolCount:turn?.hasItems?tools.length:null,timedToolCount:turn?.hasItems?timed.length:null,
    tpsBasis:'该轮累计输出 Token ÷ 整轮耗时（含工具执行和等待）'
  };
}
export function turnSummary(turns){
  const ttfts=turns.map(t=>t.ttftMs).filter(v=>v!=null).sort((a,b)=>a-b);
  const valid=turns.filter(t=>t.outputTokens!=null&&t.durationMs>0);
  const n=ttfts.length;
  return {window:10,turns:turns.length,ttftSamples:n,
    ttftMeanMs:n?ttfts.reduce((a,b)=>a+b,0)/n:null,
    ttftMedianMs:n?(ttfts[Math.floor((n-1)/2)]+ttfts[Math.floor(n/2)])/2:null,
    tpsSamples:valid.length,weightedTps:valid.length?valid.reduce((a,t)=>a+t.outputTokens,0)/(valid.reduce((a,t)=>a+t.durationMs,0)/1000):null};
}
