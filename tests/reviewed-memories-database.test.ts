import {before,after,beforeEach,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase,asUser,USER_A,USER_B} from './helpers/database';

describe('explicitly reviewed memories database boundary',()=>{
  let db:PGlite,legacyId:string,legacy:Record<string,unknown>;
  let upgradeBefore:unknown,upgradeAfter:unknown,upgradeGeneration:number;
  const upgradeRequest=randomUUID(),upgradeMemories=[{kind:'goal',content:'Reviewed before conflict-response upgrade'}];
  const signature='public.save_reviewed_memories(uuid,jsonb,integer)';
  const memories=[{kind:'goal',content:'  Finish a small creative project  '},{kind:'constraint',content:'Prefer plans with advance notice'}];
  before(async()=>{
    db=await createTestDatabase();
    for(const migration of ['00010_ai_usage_ledger.sql','00011_comparison_evidence_and_settings.sql','00012_foundation_questions.sql'])
      await db.exec(await readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
    legacy=(await db.query<Record<string,unknown>>(`insert into ai_memories(user_id,kind,content,confidence,created_at,updated_at)
      values($1,'fact','Legacy note before explicit review',0.9,'2026-10-18T10:00:00Z','2026-10-18T10:00:00Z') returning *`,[USER_B])).rows[0];
    legacyId=String(legacy.id);
    await db.exec(await readFile(new URL('../supabase/migrations/00013_reviewed_memories.sql',import.meta.url),'utf8'));
    await db.query("update profiles set ai_enabled=true,terms_version='2026-10-12' where id=$1",[USER_B]);
    upgradeGeneration=(await db.query<{g:number}>('select memory_generation g from profiles where id=$1',[USER_B])).rows[0].g;
    await asUser(db,USER_B,tx=>tx.query('select save_reviewed_memories($1,$2::jsonb,$3)',[upgradeRequest,JSON.stringify(upgradeMemories),upgradeGeneration]));
    const upgradeSnapshot=async()=>({
      memories:(await db.query('select * from ai_memories order by id')).rows,
      requests:(await db.query('select * from nudge_private.reviewed_memory_requests order by user_id,request_id')).rows,
      acl:(await db.query(`select has_function_privilege('anon',$1,'execute') anon,
        has_function_privilege('authenticated',$1,'execute') owner,
        has_function_privilege('service_role',$1,'execute') service`,[signature])).rows[0]
    });
    upgradeBefore=await upgradeSnapshot();
    await db.exec(await readFile(new URL('../supabase/migrations/00014_reviewed_memory_conflicts.sql',import.meta.url),'utf8'));
    upgradeAfter=await upgradeSnapshot();
  });
  after(async()=>{await db?.close();});
  beforeEach(async()=>{
    await db.query('delete from nudge_private.reviewed_memory_requests where user_id=$1',[USER_A]);
    await db.query('delete from ai_memories where user_id=$1',[USER_A]);
    await db.query("update profiles set ai_enabled=true,terms_version='2026-10-12',memory_generation=0,memory_reset_at=null where id=$1",[USER_A]);
    await db.query("update profiles set ai_enabled=true,terms_version='2026-10-12' where id=$1",[USER_B]);
  });
  async function save(payload:unknown=memories,request:string|null=randomUUID(),generation:number|null=0,user=USER_A){
    return (await asUser(db,user,tx=>tx.query<{count:number}>('select save_reviewed_memories($1,$2::jsonb,$3) count',
      [request,JSON.stringify(payload),generation]))).rows[0].count;
  }
  async function counts(user=USER_A){return (await db.query<{memories:number;requests:number}>(`select
    (select count(*)::integer from ai_memories where user_id=$1) memories,
    (select count(*)::integer from nudge_private.reviewed_memory_requests where user_id=$1) requests`,[user])).rows[0];}
  async function generation(user=USER_A){return (await db.query<{g:number}>('select memory_generation g from profiles where id=$1',[user])).rows[0].g;}

  it('upgrades conflict responses without changing existing reviewed rows, retry ledgers or execution privileges',async()=>{
    assert.deepEqual(upgradeAfter,upgradeBefore);
    assert.equal((await db.query<{v:number}>('select nudge_private.reviewed_memory_conflicts_version() v')).rows[0].v,14);
    assert.equal(await save(upgradeMemories,upgradeRequest,upgradeGeneration,USER_B),1,'an existing review still returns its original acknowledgement');
    assert.equal((await db.query<{count:number}>('select count(*)::integer count from nudge_private.reviewed_memory_requests where user_id=$1',[USER_B])).rows[0].count,1);
    assert.deepEqual((await db.query(`select has_function_privilege('anon','nudge_private.reviewed_memory_conflicts_version()','execute') anon,
      has_function_privilege('authenticated','nudge_private.reviewed_memory_conflicts_version()','execute') owner,
      has_function_privilege('service_role','nudge_private.reviewed_memory_conflicts_version()','execute') service`)).rows[0],{anon:false,owner:false,service:false});
    const body=(await db.query<{body:string}>('select pg_get_functiondef($1::regprocedure) body',[signature])).rows[0].body;
    assert.match(body,/PT409/);assert.doesNotMatch(body,/40001/,'business validation must not request serialization retries');
  });

  it('adds review provenance without rewriting existing memory content, confidence or timestamps',async()=>{
    const row=(await db.query<Record<string,unknown>>('select * from ai_memories where id=$1',[legacyId])).rows[0];
    assert.equal(row.reviewed_at,null);const {reviewed_at:_,...rest}=row;assert.deepEqual(rest,legacy);
    assert.equal((await db.query<{v:number}>('select nudge_private.reviewed_memories_version() v')).rows[0].v,13);
  });

  it('allows only authenticated reviewed RPC execution and denies private ledger/helper access',async()=>{
    assert.deepEqual((await db.query(`select has_function_privilege('anon',$1,'execute') anon,
      has_function_privilege('authenticated',$1,'execute') owner`,[signature])).rows[0],{anon:false,owner:true});
    assert.deepEqual((await db.query(`select relrowsecurity rls,has_table_privilege('authenticated',oid,'select') readable,
      has_table_privilege('authenticated',oid,'insert,update,delete') writable,
      has_table_privilege('service_role',oid,'insert,update,delete') service_writable
      from pg_class where oid='nudge_private.reviewed_memory_requests'::regclass`)).rows[0],
    {rls:true,readable:false,writable:false,service_writable:false});
    assert.equal((await db.query<{private:boolean}>(`select has_function_privilege('authenticated','nudge_private.purge_memory_review_requests()','execute') private`)).rows[0].private,false);
    assert.deepEqual((await db.query(`select has_function_privilege('authenticated','public.save_ai_memories(jsonb,integer,uuid)','execute') owner,
      has_function_privilege('anon','public.save_ai_memories(jsonb,integer,uuid)','execute') anon,
      has_function_privilege('service_role','public.save_ai_memories(jsonb,integer,uuid)','execute') service`)).rows[0],{owner:false,anon:false,service:false});
    await assert.rejects(asUser(db,USER_A,tx=>tx.exec('select * from nudge_private.reviewed_memory_requests')),/permission denied/);
    await assert.rejects(asUser(db,USER_A,tx=>tx.query('select save_ai_memories($1::jsonb,0,null)',[JSON.stringify([{kind:'fact',content:'Legacy bypass',confidence:.9}])])),/permission denied/);
    await assert.rejects(asUser(db,USER_A,tx=>tx.query("insert into ai_memories(user_id,content,confidence,reviewed_at) values($1,'Unreviewed structural write',0.5,now())",[USER_A])),/permission denied/);
    await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('select save_reviewed_memories($1,$2::jsonb,0)',[randomUUID(),JSON.stringify(memories)]);}),/permission denied/);
    await assert.rejects(db.query('select save_reviewed_memories($1,$2::jsonb,0)',[randomUUID(),JSON.stringify(memories)]),/signed in/);
  });

  it('persists only explicit normalized statements with owner, review time and conservative compatibility confidence',async()=>{
    const started=Date.now();assert.equal(await save(),2);
    const rows=(await asUser(db,USER_A,tx=>tx.query<{user_id:string;kind:string;content:string;confidence:number;reviewed_at:string;source_decision_id:string|null;expires_at:string|null}>(
      'select user_id,kind,content,confidence,reviewed_at,source_decision_id,expires_at from ai_memories where user_id=$1 order by kind',[USER_A]))).rows;
    assert.deepEqual(rows.map(r=>[r.kind,r.content]),[['constraint','Prefer plans with advance notice'],['goal','Finish a small creative project']]);
    for(const row of rows){assert.equal(row.user_id,USER_A);assert.equal(row.confidence,.5);assert.ok(Date.parse(row.reviewed_at)>=started-1000);assert.equal(row.source_decision_id,null);assert.equal(row.expires_at,null);}
    assert.deepEqual(await counts(),{memories:2,requests:1});
    const learned=(await db.query<{preferences:number;nodes:number}>(`select (select count(*)::integer from preferences where user_id=$1) preferences,
      (select count(*)::integer from knowledge_nodes where user_id=$1) nodes`,[USER_A])).rows[0];
    assert.deepEqual(learned,{preferences:0,nodes:0},'reviewed notes do not silently become ranking preferences');
    assert.equal(await generation(),0,'new explicitly reviewed notes do not purge unrelated comparison settings');
  });

  it('returns the original acknowledgement for a normalized identical retry without duplicate rows or raw ledger content',async()=>{
    const request=randomUUID();assert.equal(await save(memories,request),2);
    const before=(await db.query('select * from ai_memories where user_id=$1 order by id',[USER_A])).rows;
    assert.equal(await save(memories.map(m=>({content:m.content.trim(),kind:m.kind})),request),2);
    assert.deepEqual((await db.query('select * from ai_memories where user_id=$1 order by id',[USER_A])).rows,before);
    const ledger=(await db.query<Record<string,unknown>>('select * from nudge_private.reviewed_memory_requests where user_id=$1 and request_id=$2',[USER_A,request])).rows[0];
    assert.deepEqual(Object.keys(ledger).sort(),['user_id','request_id','memory_generation','payload_hash','inserted_count','created_at'].sort());
    assert.match(String(ledger.payload_hash),/^[a-f0-9]{64}$/);assert.equal(ledger.inserted_count,2);assert.equal(ledger.memory_generation,0);
    assert.ok(!JSON.stringify(ledger).includes('creative project'));assert.deepEqual(await counts(),{memories:2,requests:1});
    await assert.rejects(save([{kind:'goal',content:'Changed statement'}],request),/different statements/);
    assert.deepEqual((await db.query('select * from ai_memories where user_id=$1 order by id',[USER_A])).rows,before);
  });

  it('keeps request IDs and acknowledgements independent for each verified owner',async()=>{
    const request=randomUUID();await save(memories,request);
    const before=await counts(USER_B);assert.equal(await save([{kind:'habit',content:'A separate reviewed habit'}],request,await generation(USER_B),USER_B),1);
    assert.deepEqual(await counts(),{memories:2,requests:1});assert.deepEqual(await counts(USER_B),{memories:before.memories+1,requests:before.requests+1});
    const visible=(await asUser(db,USER_B,tx=>tx.query<{user_id:string;content:string}>('select user_id,content from ai_memories'))).rows;
    assert.ok(visible.every(r=>r.user_id===USER_B));assert.ok(!visible.some(r=>r.content==='Finish a small creative project'));
    await assert.rejects(save([{kind:'fact',content:'Forged ownership',user_id:USER_B}]),/Invalid/);
  });

  it('enforces one to six bounded exact-shape statements and rolls back malformed batches',async()=>{
    for(const payload of [null,{},[],Array.from({length:7},(_,i)=>({kind:'fact',content:'Statement '+i})),
      [null],[{}],[{kind:'fact'}],[{kind:'fact',content:null}],[{kind:'unknown',content:'x'}],[{kind:1,content:'x'}],
      [{kind:'fact',content:''}],[{kind:'fact',content:'   '}],[{kind:'fact',content:'\n\t  '}],
      [{kind:'fact',content:'x'.repeat(301)}],[{kind:'fact',content:'x',confidence:.99}],
      [{kind:'goal',content:'Same statement'},{kind:'goal',content:' same STATEMENT '}],
      [{kind:'fact',content:'A valid first row'},{kind:'fact',content:'x'.repeat(301)}]]){
      await assert.rejects(save(payload));assert.deepEqual(await counts(),{memories:0,requests:0},'invalid batch cannot leave partial memories or a retry ledger');
    }
    await assert.rejects(save(memories,null));assert.deepEqual(await counts(),{memories:0,requests:0});
    assert.equal(await save(Array.from({length:6},(_,i)=>({kind:['fact','goal','habit','constraint'][i%4],content:String(i)+'x'.repeat(299)}))),6);
    assert.deepEqual(await counts(),{memories:6,requests:1});
  });

  it('checks current AI consent, terms and captured generation before accepting even an old retry',async()=>{
    const request=randomUUID();await save(memories,request);
    await db.query('update profiles set ai_enabled=false where id=$1',[USER_A]);
    await assert.rejects(save(memories,request),{code:'PT409'});await assert.rejects(save([{kind:'fact',content:'New while disabled'}]),{code:'PT409'});
    await db.query("update profiles set ai_enabled=true,terms_version='outdated' where id=$1",[USER_A]);
    await assert.rejects(save(memories,request),{code:'PT409'});
    await db.query("update profiles set terms_version='2026-10-12' where id=$1",[USER_A]);
    await assert.rejects(save(memories,request,null),{code:'PT409'});await assert.rejects(save(memories,request,1),{code:'PT409'});
    assert.deepEqual(await counts(),{memories:2,requests:1});
  });

  it('purges retry ledgers on consent generation changes without deleting existing reviewed statements',async()=>{
    const request=randomUUID();await save(memories,request);
    await asUser(db,USER_A,tx=>tx.exec('select set_ai_enabled(false)'));
    assert.deepEqual(await counts(),{memories:2,requests:0});const disabledGeneration=await generation();assert.ok(disabledGeneration>0);
    await asUser(db,USER_A,tx=>tx.exec('select set_ai_enabled(true)'));
    assert.ok(await generation()>disabledGeneration);await assert.rejects(save(memories,request,0),{code:'PT409'});
    assert.deepEqual(await counts(),{memories:2,requests:0});
  });

  it('removes reviewed notes and retry state on erasure and prevents pre-reset replay from recreating them',async()=>{
    const request=randomUUID();await save(memories,request);
    await asUser(db,USER_A,tx=>tx.exec('select erase_learned_memory()'));
    assert.deepEqual(await counts(),{memories:0,requests:0});assert.ok(await generation()>0);
    await assert.rejects(save(memories,request,0),{code:'PT409'});assert.deepEqual(await counts(),{memories:0,requests:0});
    const fresh=randomUUID();assert.equal(await save([{kind:'goal',content:'A fresh explicit review'}],fresh,await generation()),1);
    assert.deepEqual(await counts(),{memories:1,requests:1});
  });

  it('keeps writes atomic when a later insert fails and does not consume the review request',async()=>{
    const request=randomUUID();
    await db.exec(`create function nudge_private.reject_synthetic_review() returns trigger language plpgsql as $$
      begin if new.content='Synthetic forced failure' then raise exception 'Synthetic write failure'; end if; return new; end $$;
      create trigger test_reject_synthetic_review before insert on ai_memories for each row execute function nudge_private.reject_synthetic_review()`);
    try{await assert.rejects(save([{kind:'goal',content:'First valid statement'},{kind:'fact',content:'Synthetic forced failure'}],request),/Synthetic write failure/);
      assert.deepEqual(await counts(),{memories:0,requests:0});
    }finally{await db.exec('drop trigger test_reject_synthetic_review on ai_memories;drop function nudge_private.reject_synthetic_review()');}
    assert.equal(await save([{kind:'goal',content:'First valid statement'}],request),1);
  });

  it('cascades the owner ledger and reviewed statements when the authenticated account is deleted',async()=>{
    await save();await db.query('delete from auth.users where id=$1',[USER_A]);
    assert.deepEqual(await counts(),{memories:0,requests:0});
    assert.equal((await db.query('select id from ai_memories where id=$1',[legacyId])).rows.length,1,'another account remains untouched');
  });
});
