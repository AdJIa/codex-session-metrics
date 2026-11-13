export function updateTimingHistory(previous,sample){
  let history=Array.isArray(previous?.history)?previous.history:[];
  // Only completed successful model calls enter the rolling window.
  if(!sample.active&&!sample.interrupted&&sample.completed){
    history=history.filter(x=>x.callId!==sample.callId);
    history=[...history,sample].slice(-10);
  }
  const values=key=>history.map(x=>x[key]).filter(x=>Number.isFinite(x)&&x>=0);
  const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
  const ttft=values('ttftMs'),tps=values('tps');
  return {history,current:sample,average:{window:10,calls:history.length,ttftMs:mean(ttft),ttftSamples:ttft.length,tps:mean(tps),tpsSamples:tps.length,estimatedTpsSamples:history.filter(x=>Number.isFinite(x.tps)&&x.tpsSource==='o200k_base 估算').length},updatedAt:sample.updatedAt};
}
