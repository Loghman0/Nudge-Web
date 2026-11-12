import { describe,it } from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTestDatabase,asUser,USER_A,USER_B} from './helpers/database';

const migration=new URL('../supabase/migrations/00006_privacy_boundaries.sql',import.meta.url);

describe('privacy boundaries migration',()=>{
  it('installs the generated fresh SQL, passes read-only verification and reruns the upgrade without reapplying repairs',async()=>{
    const db=await createTestDatabase(undefined,0);
    try {
      await db.exec(await readFile(new URL('../sql/01_FRESH_DATABASE.sql',import.meta.url),'utf8'));
      await db.query(`insert into auth.users(id) values($1)`,[USER_A]);
      await asUser(db,USER_A,tx=>tx.exec(`select record_knowledge_signal('food.sushi','Sushi','food','like','explicit',0.5::real,'manual');select forget_knowledge_key('food.sushi')`));
      const before=(await db.query<{memory_generation:number}>(`select memory_generation from profiles where id=$1`,[USER_A])).rows[0].memory_generation;
      const update=await readFile(new URL('../sql/02_UPDATE_EXISTING.sql',import.meta.url),'utf8');
      await db.exec(update);await db.exec(update);
      assert.equal((await db.query<{memory_generation:number}>(`select memory_generation from profiles where id=$1`,[USER_A])).rows[0].memory_generation,before);
      const verification=await db.query<Record<string,boolean>>(await readFile(new URL('../sql/03_VERIFY_DATABASE.sql',import.meta.url),'utf8'));
      for(const [name,value] of Object.entries(verification.rows[0]))assert.equal(value,true,name);
    } finally {await db.close();}
  });

  it('forgets existing aliases, projections and pending checks without touching another user or category',async()=>{
    const db=await createTestDatabase();
    try {
      for(const [user,key,category] of [[USER_A,'food.sushi','food'],[USER_A,'learned.food.sushi','food'],[USER_A,'hobby.sushi','hobbies'],[USER_B,'food.sushi','food']]) {
        await asUser(db,user,tx=>tx.query(`select record_knowledge_signal($1,'Sushi',$2,'like','explicit',0.5::real,'manual')`,[key,category]));
      }
      await db.query(`insert into knowledge_verification_queue(user_id,node_id,prompt) select user_id,id,'Synthetic check' from knowledge_nodes where user_id=$1 and category_slug='food'`,[USER_A]);
      const before=(await db.query<{memory_generation:number}>(`select memory_generation from profiles where id=$1`,[USER_A])).rows[0].memory_generation;
      await asUser(db,USER_A,tx=>tx.exec(`select forget_knowledge_key('food.sushi')`));
      assert.deepEqual((await db.query<{key:string}>(`select key from preferences where user_id=$1 order by key`,[USER_A])).rows.map(r=>r.key),['hobby.sushi']);
      assert.equal((await db.query(`select * from preferences where user_id=$1`,[USER_B])).rows.length,1);
      assert.equal((await db.query(`select * from knowledge_verification_queue where user_id=$1 and status='pending'`,[USER_A])).rows.length,0);
      assert.equal((await db.query(`select * from forgotten_knowledge_keys where user_id=$1`,[USER_A])).rows.length,2);
      assert.equal((await db.query<{memory_generation:number}>(`select memory_generation from profiles where id=$1`,[USER_A])).rows[0].memory_generation,before+1);
      const {rows}=await asUser(db,USER_A,tx=>tx.query<{id:string|null}>(`select record_knowledge_signal('food.new-sushi',' Sushi ',null,'like','explicit',0.5::real,'manual') id`));
      assert.equal(rows[0].id,null,'Discover-style NULL category must not reintroduce forgotten labels');
      assert.equal((await asUser(db,USER_A,tx=>tx.query<{id:string|null}>(`select record_knowledge_signal('food.delayed','Late','food','like','ai_extracted',0.5::real,'ai_extraction',null,null,false,'{}',$1) id`,[before]))).rows[0].id,null);
    } finally {await db.close();}
  });

  it('repairs forgotten legacy aliases and orphan analytics on upgrade, then cascades account deletion',async()=>{
    const db=await createTestDatabase(undefined,5);
    try {
      await asUser(db,USER_A,tx=>tx.exec(`
        select record_knowledge_signal('food.sushi','Sushi','food','like','explicit',0.5::real,'manual');
        select record_knowledge_signal('learned.food.sushi','Sushi','food','like','explicit',0.5::real,'manual');
        select forget_knowledge_key('food.sushi');
      `));
      await db.query(`insert into knowledge_verification_queue(user_id,node_id,prompt) select user_id,id,'Check Sushi' from knowledge_nodes where user_id=$1 and status='active'`,[USER_A]);
      await db.query(`insert into analytics_events(user_id,event,properties) values(null,'orphan','{"private":"legacy"}'),($1,'owned','{"private":"remove"}'),($2,'other','{"private":"keep"}')`,[USER_A,USER_B]);
      await db.exec(await readFile(migration,'utf8'));
      assert.equal((await db.query(`select * from preferences where user_id=$1`,[USER_A])).rows.length,0);
      assert.equal((await db.query(`select * from forgotten_knowledge_keys where user_id=$1`,[USER_A])).rows.length,2);
      assert.equal((await db.query(`select * from knowledge_verification_queue where user_id=$1 and status='pending'`,[USER_A])).rows.length,0);
      assert.equal((await db.query(`select * from analytics_events where user_id is null`)).rows.length,0);
      await db.query(`delete from auth.users where id=$1`,[USER_A]);
      const {rows}=await db.query<{event:string}>(`select event from analytics_events`);
      assert.deepEqual(rows.map(r=>r.event),['other']);
    } finally {await db.close();}
  });

  it('denies anonymous application functions, keeps authenticated APIs and service-only jobs, and closes future defaults',async()=>{
    const db=await createTestDatabase();
    try {
      assert.equal((await db.query<{enabled:boolean}>(`select relrowsecurity enabled from pg_class where oid='nudge_private.comparison_requests'::regclass`)).rows[0].enabled,true);
      const {rows}=await db.query<{name:string;anon:boolean;authenticated:boolean;service:boolean}>(`
        select p.proname name,has_function_privilege('anon',p.oid,'execute') anon,
          has_function_privilege('authenticated',p.oid,'execute') authenticated,
          has_function_privilege('service_role',p.oid,'execute') service
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')`);
      const internal=new Set(['set_updated_at','handle_new_user','assert_selected_option_matches_decision','assert_poll_vote_option_matches_poll','commit_decision_choice','project_knowledge_node_to_preference']);
      const jobs=new Set(['refill_streak_freezes','apply_knowledge_confidence_decay','enqueue_due_knowledge_verifications','enqueue_due_reflection_prompts','claim_push_deliveries','finish_push_delivery']);
      for(const fn of rows){
        assert.equal(fn.anon,false,`${fn.name}: anonymous execution`);
        assert.equal(fn.authenticated,!internal.has(fn.name)&&!jobs.has(fn.name),`${fn.name}: authenticated API allowlist`);
        if(jobs.has(fn.name))assert.equal(fn.service,true,`${fn.name}: service job`);
      }
      const privateFns=await db.query<{allowed:boolean}>(`select has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='nudge_private'`);
      assert.ok(privateFns.rows.every(r=>!r.allowed));
      await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');await tx.exec('select public.erase_learned_memory()');}),/permission denied/);
      await db.exec(`create function public.future_privacy_test() returns integer language sql as $$ select 1 $$`);
      const future=await db.query<{allowed:boolean}>(`select has_function_privilege('anon','public.future_privacy_test()','execute') or has_function_privilege('authenticated','public.future_privacy_test()','execute') allowed`);
      assert.equal(future.rows[0].allowed,false);
      await db.exec('drop function public.future_privacy_test()');
      // An allowed API still performs its intended operation after ACL reset.
      await asUser(db,USER_A,tx=>tx.exec(`select create_circle('Allowed after ACL repair')`));
    } finally {await db.close();}
  });

  it('replays a durable creation request across memory changes, isolates owners and rejects changed intent',async()=>{
    const db=await createTestDatabase();
    try {
      const request='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      const intent={category:'food',options:['Sushi','Soup']};
      const options=[{label:'Sushi',score:0.7,breakdown:{}},{label:'Soup',score:0.5,breakdown:{}}];
      const create=(user:string,payload:unknown=intent,generation=0,scored:unknown=options)=>asUser(db,user,tx=>tx.query<{id:string}>(
        `select create_comparison_once($1,$2,'food','Dinner','{}',null,$3,$4) id`,[request,JSON.stringify(payload),JSON.stringify(scored),generation]));
      const first=(await create(USER_A)).rows[0].id;
      await asUser(db,USER_A,tx=>tx.exec('select erase_learned_memory()'));
      // Generation and derived scores changed; raw intent/request identify the
      // completed operation before generation checks, preventing a duplicate.
      const replay=(await create(USER_A,intent,0,[{label:'Sushi',score:0.4,breakdown:{}},{label:'Soup',score:0.8,breakdown:{}}])).rows[0].id;
      assert.equal(replay,first);
      assert.equal((await db.query(`select * from decisions where user_id=$1`,[USER_A])).rows.length,1);
      assert.equal((await db.query(`select * from decision_options where decision_id=$1`,[first])).rows.length,2);
      await assert.rejects(create(USER_A,{category:'food',options:['Pasta','Soup']},1),/different options/);
      const second=(await create(USER_B)).rows[0].id;
      assert.notEqual(second,first);
      await asUser(db,USER_A,tx=>tx.query(`delete from decisions where id=$1`,[first]));
      assert.equal((await db.query(`select * from nudge_private.comparison_requests where user_id=$1`,[USER_A])).rows.length,0);
      const recreated=(await create(USER_A,intent,1)).rows[0].id;
      assert.notEqual(recreated,first,'deleted decisions must never be returned from retry state');
      await db.query(`delete from auth.users where id=$1`,[USER_A]);
      assert.equal((await db.query(`select * from nudge_private.comparison_requests where user_id=$1`,[USER_A])).rows.length,0);
      assert.equal((await db.query(`select * from nudge_private.comparison_requests where user_id=$1`,[USER_B])).rows.length,1);
    } finally {await db.close();}
  });

  it('rolls back both comparison and retry state on failure and supports the new RPC after upgrade',async()=>{
    const db=await createTestDatabase(undefined,5);
    try {
      await db.exec(await readFile(migration,'utf8'));
      const request='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      const create=(options:string)=>asUser(db,USER_A,tx=>tx.query<{id:string}>(
        `select create_comparison_once($1,'{"options":["One","Two"]}','food','Dinner','{}',null,$2,0) id`,[request,options]));
      await assert.rejects(create('[{"label":"One","score":0.5,"breakdown":{}},{"label":"Two","score":2,"breakdown":{}}]'),/Invalid scored option/);
      assert.equal((await db.query('select * from decisions')).rows.length,0);
      assert.equal((await db.query('select * from nudge_private.comparison_requests')).rows.length,0);
      // Force a failure after comparison insertion to prove the wrapper is one
      // transaction, including failures storing the durable request identity.
      await db.exec(`create function nudge_private.fail_test_request() returns trigger language plpgsql as $$ begin raise exception 'Synthetic request insert failure'; end $$;
        create trigger fail_test_request before insert on nudge_private.comparison_requests for each row execute function nudge_private.fail_test_request()`);
      await assert.rejects(create('[{"label":"One","score":0.5,"breakdown":{}},{"label":"Two","score":0.6,"breakdown":{}}]'),/Synthetic request insert failure/);
      assert.equal((await db.query('select * from decisions')).rows.length,0);
      assert.equal((await db.query('select * from decision_options')).rows.length,0);
      await db.exec(`drop trigger fail_test_request on nudge_private.comparison_requests;drop function nudge_private.fail_test_request()`);
      assert.ok((await create('[{"label":"One","score":0.5,"breakdown":{}},{"label":"Two","score":0.6,"breakdown":{}}]')).rows[0].id);
      const acl=(await db.query<{anon:boolean;authenticated:boolean}>(`select has_function_privilege('anon','public.create_comparison_once(uuid,jsonb,public.decision_category,text,jsonb,text,jsonb,integer)','execute') anon,has_function_privilege('authenticated','public.create_comparison_once(uuid,jsonb,public.decision_category,text,jsonb,text,jsonb,integer)','execute') authenticated`)).rows[0];
      assert.equal(acl.anon,false);assert.equal(acl.authenticated,true);
    } finally {await db.close();}
  });
});
