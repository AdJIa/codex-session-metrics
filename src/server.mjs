import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {SessionStore,UUID} from './store.mjs';
import {ensureProxy} from './ensure-proxy.mjs';
if(!process.argv.includes('--preview'))await ensureProxy();
const store=new SessionStore();
const html=await readFile(new URL('./panel.html',import.meta.url),'utf8');
const uri='ui://session-metrics/panel-v4.html';
const server=new McpServer({name:'会话指标',version:'0.1.4'},{capabilities:{tools:{},resources:{}}});
const result=d=>({content:[],structuredContent:d});
function metadataThread(extra){const m=extra?._meta||{};return [m['openai/threadId'],m['openai/thread_id'],m['openai/conversationId']].find(x=>typeof x==='string'&&UUID.test(x));}
server.registerResource('session-metrics-ui',uri,{},async()=>({contents:[{uri,mimeType:'text/html;profile=mcp-app',text:html,_meta:{ui:{prefersBorder:true,csp:{connectDomains:[],resourceDomains:[]}},'openai/ui':{availableDisplayModes:['inline','fullscreen'],preferredDisplayMode:'fullscreen'}}}]}));
server.registerTool('open_metrics',{title:'会话指标',description:'打开当前聊天的实时 Token、上下文、TTFT 和 TPS 面板。调用时传入当前 thread_id，以精确绑定会话。',inputSchema:{thread_id:z.string().regex(UUID).optional()},annotations:{readOnlyHint:true,openWorldHint:false},_meta:{ui:{resourceUri:uri},'openai/ui':{entrypoints:[{type:'thread'}]}}},async({thread_id},extra)=>{const id=thread_id||metadataThread(extra);return result({threadId:id||null,snapshot:id?await store.snapshot(id):null,needsBinding:!id});});
server.registerTool('read_metrics',{title:'读取会话指标',description:'读取指定本地会话的指标；供面板自动刷新。',inputSchema:{thread_id:z.string().regex(UUID)},annotations:{readOnlyHint:true,openWorldHint:false},_meta:{ui:{visibility:['app']}}},async({thread_id})=>result(await store.snapshot(thread_id)));
server.registerTool('list_sessions',{title:'选择本机会话',description:'列出最近本地会话 ID 和更新时间，不返回聊天正文。',inputSchema:{},annotations:{readOnlyHint:true,openWorldHint:false},_meta:{ui:{visibility:['app']}}},async()=>result({sessions:await store.list()}));
if(process.argv.includes('--preview')){
  const id=process.env.METRICS_THREAD_ID;
  createServer(async(req,res)=>{try{if(req.headers.host!=='127.0.0.1:43187'){res.writeHead(403).end();return;}if(req.url==='/snapshot'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await store.snapshot(id)));}else if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);}else res.writeHead(404).end();}catch(e){res.writeHead(500).end(JSON.stringify({error:e.message}));}}).listen(43187,'127.0.0.1',()=>console.error('Preview http://127.0.0.1:43187'));
}else await server.connect(new StdioServerTransport());
