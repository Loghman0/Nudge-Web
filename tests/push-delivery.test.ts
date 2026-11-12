import {before,after,beforeEach,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase,asUser,USER_A} from './helpers/database';

describe('durable device push SQL jobs',()=>{
 let db:PGlite;
 before(async()=>{db=await createTestDatabase(undefined,6);await db.exec(await readFile(new URL('../supabase/migrations/00007_push_delivery.sql',import.meta.url),'utf8'));});
 after(async()=>{await db.close();});
 beforeEach(async()=>{await db.exec('delete from notifications;delete from push_subscriptions;');});
 const job=(sql:string,args:unknown[]=[])=>db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query<Record<string,unknown>>(sql,args);});
 const claim=(limit=25)=>job('select * from claim_push_deliveries($1)',[limit]);
 const finish=(row:Record<string,unknown>,outcome='delivered',status:number|null=null)=>job('select finish_push_delivery($1,$2,$3,$4) ok',[row.delivery_id,row.claim_token,outcome,status]);
 async function seed(devices=1,age='2 hours'){
  const n=(await db.query<{id:string}>("insert into notifications(user_id,kind,title,created_at) values($1,'reflection_prompt','Check in',now()-$2::interval) returning id",[USER_A,age])).rows[0].id;
  for(let i=0;i<devices;i++)await db.query("insert into push_subscriptions(user_id,endpoint,p256dh,auth) values($1,$2,'test-key','test-auth')",[USER_A,`https://fcm.googleapis.com/${n}/${i}`]);
  return n;
 }
 it('restricts jobs and ledger to the service role, including after hardened default ACLs',async()=>{
  await assert.rejects(asUser(db,USER_A,tx=>tx.query('select * from claim_push_deliveries()')),/permission denied/);
  await assert.rejects(asUser(db,USER_A,tx=>tx.query("select finish_push_delivery(gen_random_uuid(),gen_random_uuid(),'delivered')")),/permission denied/);
  await assert.rejects(asUser(db,USER_A,tx=>tx.query('select * from nudge_private.push_deliveries')),/permission denied/);
 });
 it('delivers each notification/device identity once across repeated invocations and excludes active leases',async()=>{
  await seed(2);
  const first=(await claim(1)).rows;assert.equal(first.length,1);
  const second=(await claim()).rows;assert.equal(second.length,1);assert.notEqual(first[0].delivery_id,second[0].delivery_id);
  assert.equal((await claim()).rows.length,0);
  assert.equal((await finish(first[0])).rows[0].ok,true);await finish(second[0]);
  assert.equal((await claim()).rows.length,0);
  assert.equal((await db.query("select * from nudge_private.push_deliveries where status='delivered'")).rows.length,2);
 });
 it('backs off failed requests, retries only that device, and fences stale crash-recovery acknowledgements',async()=>{
  await seed(2);const rows=(await claim()).rows;await finish(rows[0]);await finish(rows[1],'retry',503);
  assert.equal((await claim()).rows.length,0);
  const pending=(await db.query<{seconds:number}>("select extract(epoch from next_attempt_at-now())::integer seconds from nudge_private.push_deliveries where status='pending'")).rows[0];
  assert.ok(pending.seconds>=59&&pending.seconds<=60);
  await db.exec("update nudge_private.push_deliveries set next_attempt_at=now()-interval '1 second' where status='pending'");
  const retry=(await claim()).rows[0];assert.equal(retry.delivery_id,rows[1].delivery_id);
  await db.exec("update nudge_private.push_deliveries set lease_until=now()-interval '1 second' where status='processing'");
  const recovered=(await claim()).rows[0];assert.notEqual(recovered.claim_token,retry.claim_token);
  assert.equal((await finish(retry)).rows[0].ok,false);assert.equal((await finish(recovered)).rows[0].ok,true);
  assert.equal((await claim()).rows.length,0);
 });
 it('cleans expired subscriptions and cascades delivery rows on either parent deletion/reset',async()=>{
  const n=await seed(2);const rows=(await claim()).rows;
  await finish(rows[0],'gone',410);
  assert.equal((await db.query('select * from push_subscriptions')).rows.length,1);
  assert.equal((await db.query('select * from nudge_private.push_deliveries')).rows.length,1);
  await db.query('delete from notifications where id=$1',[n]);
  assert.equal((await db.query('select * from nudge_private.push_deliveries')).rows.length,0);
 });
 it('expires read notifications, deadlines and exhausted crashed attempts instead of retrying forever',async()=>{
  const n=await seed();await claim();await db.query('update notifications set read_at=now() where id=$1',[n]);
  assert.equal((await claim()).rows.length,0);
  assert.equal((await db.query<{status:string}>('select status from nudge_private.push_deliveries')).rows[0].status,'expired');
  await db.exec('delete from notifications;delete from push_subscriptions;');
  await seed();await claim();
  await db.exec("update nudge_private.push_deliveries set attempts=6,lease_until=now()-interval '1 second'");
  assert.equal((await claim()).rows.length,0);
  assert.equal((await db.query<{status:string}>('select status from nudge_private.push_deliveries')).rows[0].status,'expired');
  await db.exec('delete from notifications;delete from push_subscriptions;');
  await seed();await claim();
  await db.exec("update nudge_private.push_deliveries set deadline_at=now()-interval '1 second'");
  assert.equal((await claim()).rows.length,0);
  assert.equal((await db.query<{status:string}>('select status from nudge_private.push_deliveries')).rows[0].status,'expired');
  await db.exec('delete from notifications;delete from push_subscriptions;');
  await seed(1,'8 days');assert.equal((await claim()).rows.length,0);
 });
 it('advances a bounded oldest-first backlog beyond the seed batch and beyond one hour',async()=>{
  await db.query("insert into push_subscriptions(user_id,endpoint,p256dh,auth) values($1,'https://fcm.googleapis.com/backlog','test','test')",[USER_A]);
  await db.query("insert into notifications(user_id,kind,title,created_at) select $1,'reflection_prompt','Backlog',now()-interval '2 hours'-i*interval '1 second' from generate_series(1,251) i",[USER_A]);
  const ids=new Set();
  for(let i=0;i<6;i++){const rows=(await claim(50)).rows;for(const row of rows){assert.equal(ids.has(row.delivery_id),false);ids.add(row.delivery_id);}}
  assert.equal(ids.size,251);
 });
});
