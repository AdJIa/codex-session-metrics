export class StreamTiming {
  constructor(now=()=>performance.now(),estimate=null){this.now=now;this.estimate=estimate;this.start=now();this.first=null;this.last=null;this.buffer='';this.usage=null;this.responseId=null;this.contentEvents=0;this.text='';this.completed=false;this.failed=false;}
  feed(text){this.buffer=(this.buffer+text).replace(/\r\n/g,'\n');let end;while((end=this.buffer.indexOf('\n\n'))>=0){const block=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+2);const data=block.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');if(!data||data==='[DONE]')continue;try{this.event(JSON.parse(data));}catch{}}}
  event(e){
    if(e.type==='response.completed'||e.choices?.some(c=>c.finish_reason))this.completed=true;
    if(e.type==='response.failed'||e.type==='error'||e.type==='response.incomplete')this.failed=true;
    const isContent=(e.type==='response.output_text.delta'||e.type==='response.function_call_arguments.delta'||e.type==='response.custom_tool_call_input.delta')&&typeof e.delta==='string'&&e.delta.length>0;
    if(isContent){const t=this.now();this.first??=t;this.last=t;this.contentEvents++;this.text+=e.delta;}
    if(e.response?.id)this.responseId=e.response.id;
    if(e.response?.usage)this.usage=e.response.usage;
    if(e.choices?.some(c=>c.delta?.content||c.delta?.tool_calls?.some(t=>t.function?.arguments))){const t=this.now();this.first??=t;this.last=t;this.contentEvents++;for(const c of e.choices){this.text+=c.delta?.content||'';for(const tool of c.delta?.tool_calls||[])this.text+=tool.function?.arguments||'';}}
    if(e.usage)this.usage=e.usage;
  }
  summary(active=false){const duration=this.first!==null&&this.last!==null?this.last-this.first:null;const u=this.usage;const output=u?.output_tokens??u?.completion_tokens;const reasoning=u?.output_tokens_details?.reasoning_tokens??u?.completion_tokens_details?.reasoning_tokens??0;const visible=output==null?null:Math.max(0,output-reasoning);
    const estimated=this.estimate&&this.text.length<=500000?this.estimate(this.text):null;
    const tokens=active?estimated:visible??estimated;
    return {active,completed:this.completed&&!this.failed,ttftMs:this.first===null?null:this.first-this.start,streamMs:duration,requestMs:this.now()-this.start,outputTokens:tokens,tps:tokens!==null&&duration>0&&this.contentEvents>1?tokens/(duration/1000):null,tpsSource:active||visible===null?'o200k_base 估算':'网关 usage（按兼容协议扣除推理 Token）',responseId:this.responseId,updatedAt:new Date().toISOString(),basis:'客户端接收时间；包含工具调用参数；TPS 为单次请求平均估算，不是推理引擎原始速度'};
  }
}
