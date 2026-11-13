import {UUID} from './store.mjs';

// Desktop calls thread entrypoints with {} and carries the current thread in
// request metadata. Never fall back to a process-wide or most-recent thread.
export function metadataThread(extra){
  const meta=extra?._meta||{};
  for(const key of ['thread_id','threadId','openai/threadId','openai/thread_id','codexThreadId','codex_thread_id','openai/conversationId']){
    if(typeof meta[key]==='string'&&UUID.test(meta[key]))return meta[key];
  }
  let turn=meta['x-codex-turn-metadata'];
  if(typeof turn==='string'){try{turn=JSON.parse(turn);}catch{return null;}}
  return typeof turn?.thread_id==='string'&&UUID.test(turn.thread_id)?turn.thread_id:null;
}
