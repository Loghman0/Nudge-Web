import {before,after,beforeEach,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase,asUser,USER_A,USER_B} from './helpers/database';

type Transaction=Parameters<Parameters<PGlite['transaction']>[0]>[0];
const reserveSignature='public.reserve_ai_usage_attempt(uuid,uuid,text,text,text,integer,bigint,bigint,bigint)';
const finishSignature='public.finish_ai_usage_attempt(uuid,uuid,text,bigint,bigint,bigint)';

describe('durable AI attempt cost accounting',()=>{
  let db:PGlite;
  before(async()=>{
    db=await createTestDatabase();
    await db.exec(await readFile(new URL('../supabase/migrations/00010_ai_usage_ledger.sql',import.meta.url),'utf8'));
  });
  after(async()=>{await db?.close();});
  beforeEach(async()=>{
    await db.exec(`delete from nudge_private.ai_usage_attempts;delete from nudge_private.ai_usage_daily_totals;
      update public.profiles set ai_enabled=true,terms_version='2026-10-12',memory_generation=0`);
  });
  async function asService<T>(action:(tx:Transaction)=>Promise<T>){
    return db.transaction(async tx=>{await tx.exec('set local role service_role');return action(tx);});
  }
  async function reserve(request=randomUUID(),user=USER_A,max=100,userBudget=300,globalBudget=1000,generation=0){
    return (await asService(tx=>tx.query<{reserved:boolean;reason:string}>(
      `select * from public.reserve_ai_usage_attempt($1,$2,'interpret','test','test-model',$3,$4,$5,$6)`,
      [user,request,generation,max,userBudget,globalBudget]))).rows[0];
  }
  async function finish(request:string,outcome='unknown',input:number|null=null,output:number|null=null,cost:number|null=null,user=USER_A){
    return (await asService(tx=>tx.query<{finished:boolean}>(`select public.finish_ai_usage_attempt($1,$2,$3,$4,$5,$6) finished`,
      [user,request,outcome,input,output,cost]))).rows[0].finished;
  }
  async function attempt(request:string){return (await db.query<Record<string,unknown>>(
    `select * from nudge_private.ai_usage_attempts where request_id=$1`,[request])).rows[0];}
  async function total(){return Number((await db.query<{cost:string}>(`select coalesce(sum(charged_cost_micros),0) cost from nudge_private.ai_usage_daily_totals`)).rows[0].cost);}

  it('upgrades a version-nine database through generated SQL and preserves journal rows on replay',async()=>{
    const upgrade=await createTestDatabase();
    try {
      const id=(await upgrade.query<{id:string}>(`insert into public.decisions(user_id,question) values($1,'Saved before usage ledger') returning id`,[USER_A])).rows[0].id;
      const sql=await readFile(new URL('../sql/02_UPDATE_EXISTING.sql',import.meta.url),'utf8');
      await upgrade.exec(sql);await upgrade.exec(sql);
      assert.equal((await upgrade.query<{question:string}>(`select question from public.decisions where id=$1`,[id])).rows[0].question,'Saved before usage ledger');
      assert.equal((await upgrade.query<{version:number}>(`select nudge_private.ai_usage_ledger_version() version`)).rows[0].version,10);
      const verification=(await upgrade.query<Record<string,boolean>>(await readFile(new URL('../sql/03_VERIFY_DATABASE.sql',import.meta.url),'utf8'))).rows[0];
      for(const [name,value] of Object.entries(verification))assert.equal(value,true,name);
    } finally {await upgrade.close();}
  });

  it('allows only the service role to reserve/finish and only the owner to export operational metadata',async()=>{
    const request=randomUUID();await reserve(request);await reserve(randomUUID(),USER_B);
    for(const signature of [reserveSignature,finishSignature]){
      const permissions=(await db.query<{anon:boolean;authenticated:boolean;service:boolean}>(`select
        has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,
        has_function_privilege('service_role',$1,'execute') service`,[signature])).rows[0];
      assert.deepEqual(permissions,{anon:false,authenticated:false,service:true});
    }
    const rls=await db.query<{enabled:boolean;readable:boolean;writable:boolean}>(`select relrowsecurity enabled,
      has_table_privilege('authenticated',oid,'select') readable,has_table_privilege('service_role',oid,'insert') writable
      from pg_class where oid in ('nudge_private.ai_usage_attempts'::regclass,'nudge_private.ai_usage_daily_totals'::regclass)`);
    assert.ok(rls.rows.every(r=>r.enabled&&!r.readable&&!r.writable));
    await assert.rejects(asUser(db,USER_A,tx=>tx.query(`select * from public.reserve_ai_usage_attempt($1,$2,'interpret','test','test-model',0,100,300,1000)`,[USER_A,randomUUID()])),/permission denied/);
    await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');await tx.exec('select * from public.export_my_ai_usage()');}),/permission denied/);
    const exported=(await asUser(db,USER_A,tx=>tx.query<Record<string,unknown>>('select * from public.export_my_ai_usage()'))).rows;
    assert.deepEqual(exported.map(r=>r.request_id),[request]);
    assert.deepEqual(Object.keys(exported[0]).sort(),['request_id','action','provider','model','status','outcome','input_tokens','output_tokens','reserved_cost_micros','actual_cost_micros','created_at','finished_at'].sort());
    assert.equal(await finish(request,'failed',0,0,0,USER_B),false,'another owner cannot reconcile an attempt');
  });

  it('checks consent, current terms and the captured memory generation at reservation',async()=>{
    await db.query(`update public.profiles set ai_enabled=false where id=$1`,[USER_A]);
    assert.deepEqual(await reserve(),{reserved:false,reason:'consent_or_generation'});
    await db.query(`update public.profiles set ai_enabled=true,terms_version=null where id=$1`,[USER_A]);
    assert.deepEqual(await reserve(),{reserved:false,reason:'consent_or_generation'});
    await db.query(`update public.profiles set terms_version='2026-10-12',memory_generation=3 where id=$1`,[USER_A]);
    assert.deepEqual(await reserve(),{reserved:false,reason:'consent_or_generation'});
    assert.deepEqual(await reserve(randomUUID(),USER_A,100,300,1000,3),{reserved:true,reason:'reserved'});
    assert.equal((await db.query('select * from nudge_private.ai_usage_attempts')).rows.length,1);
    await assert.rejects(reserve(randomUUID(),USER_A,0),/Invalid AI usage reservation/);
    await assert.rejects(reserve(randomUUID(),USER_A,100,0),/Invalid AI usage reservation/);
  });

  it('does not authorize a duplicated request or count the same reservation twice',async()=>{
    const request=randomUUID();assert.equal((await reserve(request)).reserved,true);
    assert.deepEqual(await reserve(request),{reserved:false,reason:'duplicate'});
    assert.deepEqual(await reserve(request,USER_B),{reserved:false,reason:'duplicate'});
    assert.equal(await total(),100);
    await finish(request,'succeeded',20,5,35);
    assert.deepEqual(await reserve(request),{reserved:false,reason:'duplicate'});
    assert.equal(await total(),35);
  });

  it('accepts configured NVIDIA route labels and bounds model metadata',async()=>{
    const reserveNvidia=(model:string)=>asService(tx=>tx.query<{reserved:boolean}>(
      `select * from public.reserve_ai_usage_attempt($1,$2,'interpret','nvidia:gemma',$3,0,100,300,1000)`,
      [USER_A,randomUUID(),model]));
    assert.equal((await reserveNvidia('google/gemma-4-31b-it')).rows[0].reserved,true);
    await assert.rejects(reserveNvidia('x'.repeat(161)),/Invalid AI usage reservation/);
    await assert.rejects(reserveNvidia('model\ncredentials'),/Invalid AI usage reservation/);
    assert.equal(await total(),100);
  });

  it('keeps user and shared daily reservations within budget for competing calls',async()=>{
    // PGlite queues transactions in one connection. These concurrent callers
    // exercise the same atomic RPC path; production PostgreSQL also uses the
    // explicit shared day row lock to serialize independent connections.
    const first=await Promise.all(Array.from({length:8},()=>reserve(randomUUID(),USER_A,100,300,1000)));
    assert.equal(first.filter(r=>r.reserved).length,3);assert.equal(await total(),300);
    const second=await Promise.all(Array.from({length:8},()=>reserve(randomUUID(),USER_B,100,1000,500)));
    assert.equal(second.filter(r=>r.reserved).length,2);assert.equal(await total(),500);
    assert.ok(second.filter(r=>!r.reserved).every(r=>r.reason==='global_budget'));
    assert.equal((await db.query('select * from nudge_private.ai_usage_attempts')).rows.length,5);
  });

  it('rolls back the shared reservation when storing its attempt fails',async()=>{
    await db.exec(`create function nudge_private.fail_ai_usage_test() returns trigger language plpgsql as $$
      begin raise exception 'Synthetic attempt failure'; end $$;
      create trigger fail_ai_usage_test before insert on nudge_private.ai_usage_attempts
      for each row execute function nudge_private.fail_ai_usage_test()`);
    try {
      await assert.rejects(reserve(),/Synthetic attempt failure/);
      assert.equal(await total(),0);
      assert.equal((await db.query('select * from nudge_private.ai_usage_attempts')).rows.length,0);
    } finally {
      await db.exec(`drop trigger fail_ai_usage_test on nudge_private.ai_usage_attempts;drop function nudge_private.fail_ai_usage_test()`);
    }
    assert.equal((await reserve()).reserved,true);assert.equal(await total(),100);
  });

  it('keeps the full liability when usage is missing and reconciles a late known result exactly once',async()=>{
    const request=randomUUID();await reserve(request);
    assert.equal(await finish(request,'failed'),true);
    let row=await attempt(request);assert.equal(row.status,'unknown');assert.equal(row.actual_cost_micros,null);
    assert.equal(Number(row.charged_cost_micros),100);assert.equal(await total(),100);
    // A fabricated free cost cannot release a reservation without both counts.
    await finish(request,'failed',null,null,0);assert.equal(await total(),100);
    assert.equal(await finish(request,'succeeded',30,5,25),true);
    assert.equal(await total(),25);row=await attempt(request);
    assert.equal(row.status,'settled');assert.equal(Number(row.actual_cost_micros),25);
    assert.equal(await finish(request,'succeeded',30,5,25),true);assert.equal(await total(),25);
    assert.equal(await finish(request,'unknown'),true);assert.equal(await total(),25);
    await assert.rejects(finish(request,'succeeded',31,5,25),/Conflicting AI usage reconciliation/);
    assert.equal(await total(),25);
  });

  it('charges overruns completely and blocks later calls while preserving known zero usage',async()=>{
    const request=randomUUID();await reserve(request,USER_A,100,1000,300);
    await finish(request,'succeeded',400,500,350);assert.equal(await total(),350);
    assert.deepEqual(await reserve(randomUUID(),USER_B,1,1000,300),{reserved:false,reason:'global_budget'});
    const second=randomUUID();await reserve(second,USER_A,50,1000,1000);
    await finish(second,'failed',0,0,0);assert.equal(await total(),350);
    assert.equal(Number((await attempt(second)).actual_cost_micros),0);
  });

  it('reconciles the reservation day after UTC rollover without refunding today',async()=>{
    const yesterday=randomUUID();await reserve(yesterday);
    await db.query(`update nudge_private.ai_usage_attempts set usage_day=usage_day-1 where request_id=$1`,[yesterday]);
    await db.exec(`update nudge_private.ai_usage_daily_totals set usage_day=usage_day-1`);
    await reserve(randomUUID());assert.equal(await total(),200);
    await finish(yesterday,'succeeded',10,5,25);assert.equal(await total(),125);
    const current=(await db.query<{cost:string}>(`select charged_cost_micros cost from nudge_private.ai_usage_daily_totals where usage_day=(now() at time zone 'UTC')::date`)).rows[0];
    assert.equal(Number(current.cost),100);
  });

  it('purges expired operational attempts on the next reservation without truncating owner exports',async()=>{
    // More than one API page: the RPC itself must not impose an invisible cap.
    await db.query(`insert into nudge_private.ai_usage_attempts(request_id,user_id,action,provider,model,memory_generation,
      usage_day,reserved_cost_micros,charged_cost_micros,created_at)
      select gen_random_uuid(),$1,'extract','test','test-model',0,(now() at time zone 'UTC')::date,1,1,now()
      from generate_series(1,205)`,[USER_A]);
    await db.exec(`insert into nudge_private.ai_usage_daily_totals values((now() at time zone 'UTC')::date,205)`);
    assert.equal((await asUser(db,USER_A,tx=>tx.query('select * from public.export_my_ai_usage()'))).rows.length,205);
    const expired=randomUUID();
    await db.query(`insert into nudge_private.ai_usage_attempts(request_id,user_id,action,provider,model,memory_generation,
      usage_day,reserved_cost_micros,charged_cost_micros,created_at)
      values($1,$2,'extract','test','test-model',0,(now() at time zone 'UTC')::date-3,50,50,now()-interval '73 hours')`,[expired,USER_A]);
    await db.exec(`insert into nudge_private.ai_usage_daily_totals values((now() at time zone 'UTC')::date-3,50)`);
    assert.equal((await asUser(db,USER_A,tx=>tx.query('select * from public.export_my_ai_usage()'))).rows.length,205);
    assert.equal((await reserve(randomUUID(),USER_A,1,1000,1000)).reserved,true);
    assert.equal(await attempt(expired),undefined);
    assert.equal((await db.query(`select * from nudge_private.ai_usage_daily_totals where usage_day=(now() at time zone 'UTC')::date-3`)).rows.length,0);
    assert.equal(await total(),206);
  });

  it('cascades owner deletion while retaining today shared costs and other owners',async()=>{
    const first=randomUUID(),second=randomUUID();await reserve(first);await reserve(second,USER_B);
    await db.query(`delete from auth.users where id=$1`,[USER_A]);
    assert.equal(await attempt(first),undefined);assert.ok(await attempt(second));assert.equal(await total(),200);
    assert.equal(await finish(first,'succeeded',10,10,10),false);
    assert.deepEqual(await reserve(randomUUID(),USER_B,100,1000,200),{reserved:false,reason:'global_budget'});
  });
});
