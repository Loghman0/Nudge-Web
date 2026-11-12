import {it} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../src/lib/types/database';
import type {NativeDelivery} from '../src/lib/services/fcm-sender';
import {createNativePushWorker} from '../src/lib/services/native-push-worker';
const id='00000000-0000-4000-8000-000000000001',secret='synthetic-cron-secret-'.repeat(3);
const item:NativeDelivery={delivery_id:id,claim_token:id,notification_id:id,device_id:id,device_revision:1,recipient_user_id:id,decision_id:id,token:'synthetic-registration-token'};
function fixture({current=true,ack=true,bad=false,disabled=false}={}){
 const calls:{name:string;args:any}[]=[],sent:NativeDelivery[]=[];
 const db={rpc:async(name:string,args:any)=>{calls.push({name,args});return {error:null,data:name==='enqueue_due_reflection_prompts'?1:name==='claim_native_push_deliveries'?[bad?{...item,token:'short'}:item]:name==='native_push_delivery_current'?current:ack};}} as unknown as SupabaseClient<Database>;
 const handler=createNativePushWorker({db,secret,send:disabled?null:async(item)=>{sent.push(item);return {outcome:'accepted',status:200};}});
 return {calls,sent,invoke:(key=secret)=>handler(new Request('https://nudge.test/api/cron/native-checkins',{method:'POST',headers:{'x-nudge-cron-secret':key}}))};
}
it('requires the scheduler secret before any service-role RPC, not merely a user bearer token',async()=>{
 const h=fixture();assert.equal((await h.invoke('wrong')).status,401);assert.equal(h.calls.length,0);assert.equal(h.sent.length,0);
 const off=createNativePushWorker({db:null,secret:undefined,send:null});assert.equal((await off(new Request('https://nudge.test'))).status,503);
});
it('keeps in-app enqueue useful without native sender credentials',async()=>{
 const h=fixture({disabled:true}),result=await h.invoke();assert.equal(result.status,200);assert.equal((await result.json()).nativeTransport,false);assert.deepEqual(h.calls.map(c=>c.name),['enqueue_due_reflection_prompts']);assert.equal(h.sent.length,0);
});
it('preflights claims, sends once, and acknowledges provider acceptance without exposing device tokens',async()=>{
 const h=fixture(),result=await h.invoke(),data=await result.json();assert.equal(data.accepted,1);assert.equal(h.sent.length,1);assert.deepEqual(h.calls.map(c=>c.name),['enqueue_due_reflection_prompts','claim_native_push_deliveries','native_push_delivery_current','finish_native_push_delivery']);assert.equal(h.calls[3].args.p_outcome,'accepted');assert.ok(!JSON.stringify(data).includes(item.token));
});
it('does not send read/cancelled/stale claims or immediately resend after a failed acknowledgement',async()=>{
 const old=fixture({current:false}),res=await old.invoke();assert.equal((await res.json()).expired,1);assert.equal(old.sent.length,0);
 const uncertain=fixture({ack:false}),result=await uncertain.invoke();assert.equal(result.status,503);assert.equal(uncertain.sent.length,1);assert.equal((await result.json()).acknowledgementsFailed,1);
 const bad=fixture({bad:true});assert.equal((await bad.invoke()).status,503);assert.equal(bad.sent.length,0);
});
