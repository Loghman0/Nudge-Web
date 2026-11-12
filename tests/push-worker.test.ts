import {before,after,beforeEach,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase,USER_A} from './helpers/database';

describe('check-in worker with real durable SQL and mocked Web Push',()=>{
 let db:PGlite;
 let handler:(request:Request)=>Promise<Response>;
 let mode='normal';let deliveries:string[]=[];let flaky=true;
 const secret='test-scheduler-secret-longer-than-32-characters';
 before(async()=>{
  db=await createTestDatabase(undefined,6);
  await db.exec(await readFile(new URL('../supabase/migrations/00007_push_delivery.sql',import.meta.url),'utf8'));
  const rpc=async(name:string,args:Record<string,unknown>={})=>{
   if(mode==='throw')throw new Error('synthetic transport failure');
   if(mode==='claim-error'&&name==='claim_push_deliveries')return {data:null,error:{message:'synthetic query error'}};
   if(mode==='ack-error'&&name==='finish_push_delivery')return {data:null,error:{message:'synthetic ack error'}};
   try {
    return await db.transaction(async tx=>{
     await tx.exec('set local role service_role');
     if(name==='enqueue_due_reflection_prompts')return {data:(await tx.query<{n:number}>('select enqueue_due_reflection_prompts() n')).rows[0].n,error:null};
     if(name==='claim_push_deliveries')return {data:(await tx.query('select * from claim_push_deliveries($1)',[args.p_limit])).rows,error:null};
     if(name==='finish_push_delivery')return {data:(await tx.query<{ok:boolean}>('select finish_push_delivery($1,$2,$3,$4) ok',[args.p_delivery_id,args.p_claim_token,args.p_outcome,args.p_status])).rows[0].ok,error:null};
     throw new Error('unexpected RPC');
    });
   }catch(error){return {data:null,error:{message:String(error)}};}
  };
  const source=stripTypeScriptTypes(await readFile(new URL('../supabase/functions/send-checkins/index.ts',import.meta.url),'utf8')).replace(/^import[\s\S]*?;\s*$/gm,'');
  vm.runInContext(source,vm.createContext({Response,Request,URL,Date,console,
   Deno:{env:{get:(key:string)=>key==='CHECKINS_CRON_SECRET'?secret:key.startsWith('VAPID_')?'synthetic':undefined},serve:(fn:typeof handler)=>handler=fn},
   createClient:()=>({rpc}),
   webpush:{setVapidDetails:()=>{},sendNotification:async(sub:{endpoint:string},payload:string,options:{timeout:number;TTL:number})=>{
    assert.equal(options.timeout,10000);assert.equal(options.TTL,3600);assert.equal(JSON.parse(payload).url,'/notifications');deliveries.push(sub.endpoint);
    if(sub.endpoint.endsWith('/gone'))throw {statusCode:410};
    if(sub.endpoint.endsWith('/flaky')&&flaky){flaky=false;throw {statusCode:503};}
   }},
  }));
 });
 after(async()=>{await db.close();});
 beforeEach(async()=>{mode='normal';deliveries=[];flaky=true;await db.exec('delete from notifications;delete from push_subscriptions;');});
 const invoke=()=>handler(new Request('https://nudge.test/checkins',{method:'POST',headers:{'x-nudge-cron-secret':secret}}));
 async function seed(endpoints:string[]){
  await db.query("insert into notifications(user_id,kind,title,created_at) values($1,'reflection_prompt','Revisit',now()-interval '3 hours')",[USER_A]);
  for(const endpoint of endpoints)await db.query("insert into push_subscriptions(user_id,endpoint,p256dh,auth) values($1,$2,'key','auth')",[USER_A,endpoint]);
 }
 it('does not redeliver successful devices on a second invocation and recovers only failed devices after backoff',async()=>{
  await seed(['https://fcm.googleapis.com/good','https://fcm.googleapis.com/flaky','https://fcm.googleapis.com/gone']);
  const first=await invoke();assert.equal(first.status,200);
  const body=await first.json();assert.equal(body.pushed,1);assert.equal(body.retried,1);assert.equal(body.cleaned,1);
  assert.equal((await db.query('select * from push_subscriptions')).rows.length,2);
  assert.equal((await invoke()).status,200);assert.equal(deliveries.length,3);
  await db.exec("update nudge_private.push_deliveries set next_attempt_at=now()-interval '1 second' where status='pending'");
  const retry=await (await invoke()).json();assert.equal(retry.pushed,1);assert.equal(deliveries.length,4);
  assert.equal(deliveries.filter(v=>v.endsWith('/good')).length,1);
  await invoke();assert.equal(deliveries.length,4);
 });
 it('returns explicit errors for claim and transport failures and never sends disallowed endpoints',async()=>{
  await seed(['https://attacker.test/ssrf']);
  mode='claim-error';const failed=await invoke();assert.equal(failed.status,500);assert.equal((await failed.json()).stage,'claim');assert.equal(deliveries.length,0);
  mode='throw';assert.equal((await invoke()).status,503);assert.equal(deliveries.length,0);
  mode='normal';const blocked=await (await invoke()).json();assert.equal(blocked.failed,1);assert.equal(deliveries.length,0);
  assert.equal((await db.query<{status:string}>('select status from nudge_private.push_deliveries')).rows[0].status,'failed');
 });
 it('reports ACK failure, waits for lease recovery and documents the unavoidable provider-success/ACK-crash duplicate window',async()=>{
  await seed(['https://fcm.googleapis.com/good']);
  mode='ack-error';const first=await invoke();assert.equal(first.status,503);assert.equal((await first.json()).stage,'ack');assert.equal(deliveries.length,1);
  mode='normal';await invoke();assert.equal(deliveries.length,1);
  await db.exec("update nudge_private.push_deliveries set lease_until=now()-interval '1 second'");
  await invoke();assert.equal(deliveries.length,2);
  await invoke();assert.equal(deliveries.length,2);
 });
});
