import {before,after,beforeEach,it,describe} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase,asUser,USER_A,USER_B} from './helpers/database';
const install='10000000-0000-4000-8000-000000000001',secret='a'.repeat(64),token='test:device-token-'.repeat(3);
describe('native push registration and delivery boundaries',()=>{
 let db:PGlite;
 before(async()=>{db=await createTestDatabase();await db.exec(await readFile('supabase/migrations/00020_native_push.sql','utf8'));});
 after(async()=>{await db.close();});
 beforeEach(async()=>{await db.exec('delete from public.native_push_devices;delete from public.notifications;delete from public.decisions;');});
 const set=(epoch=1,settings:unknown={enabled:true,token,timeZone:'UTC',quietStart:0,quietEnd:0},user=USER_A,proof=secret,id=install)=>asUser(db,user,tx=>tx.query<{value:any}>('select set_native_push_device($1,$2,$3,$4::jsonb) value',[id,proof,epoch,JSON.stringify(settings)]));
 const job=(sql:string,args:unknown[]=[])=>db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query<Record<string,any>>(sql,args);});
 const claim=()=>job('select * from claim_native_push_deliveries()');
 const finish=(row:Record<string,any>,outcome='accepted')=>job('select finish_native_push_delivery($1,$2,$3,200) ok',[row.delivery_id,row.claim_token,outcome]);
 async function seed(){
  const decision=(await db.query<{id:string}>("insert into decisions(user_id,category,question,status,decided_at,reminder_enabled,reminder_version,reflection_due_at) values($1,'food','Private question','decided',now()-interval '2 days',true,1,now()-interval '1 hour') returning id",[USER_A])).rows[0].id;
  const notification=(await db.query<{id:string}>("insert into notifications(user_id,kind,title,body,payload) values($1,'reflection_prompt','Private title','Private answer',jsonb_build_object('decision_id',$2::text,'reminder_version',1)) returning id",[USER_A,decision])).rows[0].id;
  return {decision,notification};
 }
 it('keeps tokens/proofs/ledger unreadable and jobs unavailable to ordinary accounts',async()=>{
  await set();const state=await asUser(db,USER_A,tx=>tx.query('select id,enabled from native_push_devices'));assert.equal(state.rows.length,1);
  assert.equal((await asUser(db,USER_B,tx=>tx.query('select id,enabled from native_push_devices'))).rows.length,0);
  await assert.rejects(asUser(db,USER_A,tx=>tx.query('select token from native_push_devices')),/permission denied/);
  await assert.rejects(asUser(db,USER_A,tx=>tx.query('select secret_hash from native_push_devices')),/permission denied/);
  await assert.rejects(asUser(db,USER_A,tx=>tx.query('select * from claim_native_push_deliveries()')),/permission denied/);
  await assert.rejects(asUser(db,USER_A,tx=>tx.query('select * from nudge_private.native_push_deliveries')),/permission denied/);
 });
 it('requires device proof, permits exact replay, and rejects equal-epoch edits and late previous-account writes',async()=>{
  await set();await set();assert.equal((await db.query('select id from native_push_devices')).rows.length,1);
  await assert.rejects(set(2,undefined,USER_B,'b'.repeat(64)));
  await assert.rejects(set(1,{enabled:false}),/Device settings changed/);
  await set(2,undefined,USER_B);await assert.rejects(set(1),/Device settings changed/);
  assert.equal((await db.query<{user_id:string}>('select user_id from native_push_devices')).rows[0].user_id,USER_B);
  await set(3,{enabled:false},USER_B);await assert.rejects(set(2,undefined,USER_B),/Device settings changed/);
 });
 it('writes a logout tombstone even before the first registration arrives',async()=>{
  await set(2,{enabled:false});await assert.rejects(set(1),/Device settings changed/);
  assert.equal((await db.query<{enabled:boolean}>('select enabled from native_push_devices')).rows[0].enabled,false);
 });
 it('rejects malformed settings and unknown zones without creating devices',async()=>{
  for(const settings of [{enabled:true,token,timeZone:'Unknown/Zone',quietStart:0,quietEnd:0},{enabled:true,token,timeZone:'UTC',quietStart:1.2,quietEnd:0},{enabled:false,token},{enabled:true,token:'short',timeZone:'UTC',quietStart:0,quietEnd:0}])await assert.rejects(set(1,settings));
  assert.equal((await db.query('select id from native_push_devices')).rows.length,0);
 });
 it('claims generic metadata once, fences leases, and never includes private notification copy',async()=>{
  await set();const ids=await seed();const row=(await claim()).rows[0];assert.ok(row);assert.equal(row.decision_id,ids.decision);assert.equal(row.recipient_user_id,USER_A);assert.equal(row.title,undefined);assert.equal(row.body,undefined);
  assert.equal((await claim()).rows.length,0);assert.equal((await job('select native_push_delivery_current($1,$2) ok',[row.delivery_id,row.claim_token])).rows[0].ok,true);
  assert.equal((await finish(row)).rows[0].ok,true);assert.equal((await finish(row)).rows[0].ok,false);assert.equal((await claim()).rows.length,0);
 });
 it('invalidates a claimed message when read, cancelled, quiet, or switched to another account',async()=>{
  await set();const ids=await seed();const row=(await claim()).rows[0];await db.query('update notifications set read_at=now() where id=$1',[ids.notification]);
  assert.equal((await job('select native_push_delivery_current($1,$2) ok',[row.delivery_id,row.claim_token])).rows[0].ok,false);
  await db.query('update notifications set read_at=null where id=$1',[ids.notification]);await db.query('update decisions set reminder_enabled=false where id=$1',[ids.decision]);assert.equal((await job('select native_push_delivery_current($1,$2) ok',[row.delivery_id,row.claim_token])).rows[0].ok,false);
  await set(2,undefined,USER_B);assert.equal((await job('select native_push_delivery_current($1,$2) ok',[row.delivery_id,row.claim_token])).rows[0].ok,false);assert.equal((await claim()).rows.length,0);
 });
 it('defers quiet hours, expires stale devices, and never pushes pre-opt-in backlog',async()=>{
  await set();await seed();await db.exec("update native_push_devices set quiet_start=0,quiet_end=1439");
  const minute=(await db.query<{m:number}>("select extract(hour from now() at time zone 'UTC')::integer*60+extract(minute from now() at time zone 'UTC')::integer m")).rows[0].m;
  if(minute<1439)assert.equal((await claim()).rows.length,0);
  await db.exec("update native_push_devices set quiet_start=0,quiet_end=0,expires_at=now()-interval '1 second'");assert.equal((await claim()).rows.length,0);
  await db.exec("update native_push_devices set expires_at=now()+interval '1 day',enabled_at=now()+interval '1 minute'");assert.equal((await claim()).rows.length,0);
 });
 it('does not invalidate a newly rotated token when an older send reports gone, and cascades deletion',async()=>{
  await set();const ids=await seed();const row=(await claim()).rows[0];await set(2,{enabled:true,token:token+'new',timeZone:'UTC',quietStart:0,quietEnd:0});await finish(row,'gone');
  const device=(await db.query<{enabled:boolean;token:string}>('select enabled,token from native_push_devices')).rows[0];assert.equal(device.enabled,true);assert.equal(device.token,token+'new');
  await db.query('delete from notifications where id=$1',[ids.notification]);assert.equal((await db.query('select id from nudge_private.native_push_deliveries')).rows.length,0);
 });
});
