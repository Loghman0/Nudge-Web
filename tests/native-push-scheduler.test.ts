import {it} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTestDatabase} from './helpers/database';
it('restricts the hosted scheduler and reads a unique Vault secret only at dispatch time',async()=>{
 const db=await createTestDatabase();
 try{
  // pg_net and Vault are hosted extensions. Stub their public signatures here;
  // the hosted HTTP receipt is verified separately, not by this database test.
  await db.exec(`create schema net; create schema vault; create schema if not exists cron;
   create table vault.decrypted_secrets(name text,decrypted_secret text);
   create table nudge_private.scheduler_capture(url text,headers jsonb,body jsonb,timeout integer);
   create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$
    insert into nudge_private.scheduler_capture values(url,headers,body,timeout_milliseconds); select 1::bigint; $$;
   create table cron.job(jobname text,schedule text,active boolean,command text);
   create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job values($1,$2,true,$3);select 1::bigint;$$;`);
  const sql=(await readFile('supabase/native_push_scheduler.sql','utf8')).replace('create extension if not exists pg_net with schema extensions;','');
  await db.exec(sql);
  assert.deepEqual((await db.query('select schedule,active,command from cron.job')).rows,[{schedule:'*/5 * * * *',active:true,command:'select nudge_private.dispatch_native_push_checkins();'}]);
  for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query<{ok:boolean}>("select has_function_privilege($1,'nudge_private.dispatch_native_push_checkins()','execute') ok",[role])).rows[0].ok,false);
  await assert.rejects(db.query('select nudge_private.dispatch_native_push_checkins()'),/One valid/);
  await db.query('insert into vault.decrypted_secrets values($1,$2)',['nudge_native_push_cron','synthetic-scheduler-secret-for-tests-only']);
  await db.query('select nudge_private.dispatch_native_push_checkins()');
  const row=(await db.query<{url:string;headers:Record<string,string>;body:object;timeout:number}>('select * from nudge_private.scheduler_capture')).rows[0];
  assert.equal(row.url,'https://projectnudge.vercel.app/api/cron/native-checkins');assert.equal(row.headers['x-nudge-cron-secret'],'synthetic-scheduler-secret-for-tests-only');assert.deepEqual(row.body,{});assert.equal(row.timeout,55000);
  await db.query('insert into vault.decrypted_secrets values($1,$2)',['nudge_native_push_cron','another-synthetic-scheduler-secret']);
  await assert.rejects(db.query('select nudge_private.dispatch_native_push_checkins()'),/One valid/);
 }finally{await db.close();}
});
