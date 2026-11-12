import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {validPushEndpoint} from '../src/lib/services/push-endpoint';
import {aiAllowed,reserveAiRequest} from '../src/lib/services/ai/privacy';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../src/lib/types/database';

describe('launch protection regressions',()=>{
 it('keeps missing AI consent and failed quota checks off',async()=>{
  const db={from:()=>({select:()=>({eq:()=>({single:async()=>({data:null,error:{code:'missing'}})})})}),rpc:async()=>({data:null,error:{code:'missing'}})} as unknown as SupabaseClient<Database>;
  assert.equal(await aiAllowed(db,'test'),false);assert.equal(await reserveAiRequest(db,'explain'),false);
 });
 it('rejects push URLs outside supported browser services and malicious credentials/ports',()=>{
  for(const url of ['http://fcm.googleapis.com/send','https://localhost/send','https://127.0.0.1/send','https://fcm.googleapis.com.evil.test/send','https://user:password@fcm.googleapis.com/send','https://fcm.googleapis.com:8443/send'])assert.equal(validPushEndpoint(url),false,url);
  for(const url of ['https://fcm.googleapis.com/fcm/send/test','https://updates.push.services.mozilla.com/wpush/v2/test','https://web.push.apple.com/test'])assert.equal(validPushEndpoint(url),true,url);
 });
});
