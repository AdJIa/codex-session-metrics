import {test} from 'node:test';
import assert from 'node:assert/strict';
import {metadataThread} from '../src/thread-context.mjs';
const id='55555555-5555-5555-5555-555555555555';
test('current desktop thread metadata works without a model-supplied argument',()=>{
 for(const key of ['thread_id','threadId','openai/threadId','openai/thread_id','codexThreadId','codex_thread_id'])assert.equal(metadataThread({_meta:{[key]:id}}),id);
 for(const turn of [{thread_id:id},JSON.stringify({thread_id:id})])assert.equal(metadataThread({_meta:{'x-codex-turn-metadata':turn}}),id);
});
test('missing or unrelated metadata never guesses a current session',()=>{
 assert.equal(metadataThread(),null);
 assert.equal(metadataThread({_meta:{thread_id:'invalid','openai/session':id}}),null);
 assert.equal(metadataThread({_meta:{'x-codex-turn-metadata':'bad-json'}}),null);
});
