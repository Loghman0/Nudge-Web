import {before,after,beforeEach,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase,asUser,USER_A,USER_B} from './helpers/database';

const question=(n:number)=>`12000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
type Answer={questionId:string;answer:'a'|'b'|'skip'};
describe('contextual foundation questions and explicit onboarding answers',()=>{
  let db:PGlite,legacyQuestions:unknown[],legacyAnswers:unknown[],legacyNodes:unknown[];
  let oldQuestion:string;
  before(async()=>{
    db=await createTestDatabase();
    for(const migration of ['00010_ai_usage_ledger.sql','00011_comparison_evidence_and_settings.sql'])
      await db.exec(await readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
    oldQuestion=(await db.query<{id:string}>('select id from questions where is_onboarding and is_active order by sort_order,id limit 1')).rows[0].id;
    await asUser(db,USER_B,tx=>tx.query("select complete_onboarding('{\"fullName\":\"Legacy user\",\"country\":\"Azerbaijan\",\"language\":\"en\",\"age\":\"24\",\"occupation\":\"Builder\"}',$1::jsonb,0)",
      [JSON.stringify([{questionId:oldQuestion,answer:'a'}])]));
    legacyQuestions=(await db.query('select * from questions order by id')).rows;
    legacyAnswers=(await db.query('select * from question_answers where user_id=$1 order by id',[USER_B])).rows;
    legacyNodes=(await db.query('select * from knowledge_nodes where user_id=$1 order by id',[USER_B])).rows;
    await db.exec(await readFile(new URL('../supabase/migrations/00012_foundation_questions.sql',import.meta.url),'utf8'));
  });
  after(async()=>{await db?.close();});
  beforeEach(async()=>{
    await db.query('delete from preferences where user_id=$1',[USER_A]);
    await db.query('delete from knowledge_nodes where user_id=$1',[USER_A]);
    await db.query('delete from question_answers where user_id=$1',[USER_A]);
    await db.query("update profiles set full_name='Existing name',country='Azerbaijan',language='az',age=24,occupation='Builder',onboarded_at=null,memory_generation=0,memory_reset_at=null where id=$1",[USER_A]);
  });
  const answers:Answer[]=[{questionId:question(1),answer:'a'},{questionId:question(2),answer:'b'},
    {questionId:question(3),answer:'skip'},{questionId:question(4),answer:'a'},{questionId:question(5),answer:'b'},{questionId:question(6),answer:'skip'}];
  async function complete(input:unknown=answers,profile:unknown={fullName:'Updated name'},generation=0,user=USER_A){
    return (await asUser(db,user,tx=>tx.query<{generation:number}>('select complete_onboarding($1::jsonb,$2::jsonb,$3) generation',
      [JSON.stringify(profile),JSON.stringify(input),generation]))).rows[0].generation;
  }
  async function count(table:string){return (await db.query<{n:number}>(`select count(*)::integer n from public.${table} where user_id=$1`,[USER_A])).rows[0].n;}

  it('adds exactly six reviewed questions without changing old catalog records, flags, answers or learning',async()=>{
    assert.deepEqual((await db.query("select * from questions where context->>'foundationEdition' is distinct from '1' order by id")).rows,legacyQuestions);
    assert.deepEqual((await db.query('select * from question_answers where user_id=$1 order by id',[USER_B])).rows,legacyAnswers);
    assert.deepEqual((await db.query('select * from knowledge_nodes where user_id=$1 order by id',[USER_B])).rows,legacyNodes);
    const rows=(await db.query<{id:string;kind:string;is_onboarding:boolean;is_active:boolean;sort_order:number;slug:string;maps_to_key_a:string;maps_to_key_b:string;context:Record<string,string>}>(
      "select q.*,c.slug from questions q join preference_categories c on c.id=q.category_id where q.context->>'foundationEdition'='1' order by q.sort_order")).rows;
    assert.equal(rows.length,6);assert.deepEqual(rows.map(r=>r.id),Array.from({length:6},(_,i)=>question(i+1)));
    assert.deepEqual(rows.map(r=>r.slug),['food','entertainment','relationships','career','hobbies','shopping']);
    for(const row of rows){
      assert.equal(row.kind,'this_or_that');assert.equal(row.is_onboarding,true);assert.equal(row.is_active,true);
      assert.equal(row.context.domain,'everyday life');assert.equal(row.context.answerPolicy,'single_preference_or_skip');
      assert.ok(row.context.starterRationale.length>40);assert.match(row.maps_to_key_a,/^[a-z]+[.]foundation[.]/);assert.match(row.maps_to_key_b,/^[a-z]+[.]foundation[.]/);
    }
    assert.equal((await db.query<{v:number}>('select nudge_private.foundation_questions_version() v')).rows[0].v,12);
  });

  it('learns only the selected contextual labels/categories and stores the source question and rationale context',async()=>{
    const before=(await asUser(db,USER_A,tx=>tx.query('select * from question_progress()'))).rows;
    assert.equal(await complete(),0);
    assert.equal(await count('question_answers'),6);assert.equal(await count('knowledge_nodes'),4);assert.equal(await count('preferences'),4);
    const nodes=(await db.query<{key:string;value:string;category_slug:string;source:string;polarity:string}>('select key,value,category_slug,source,polarity from knowledge_nodes where user_id=$1 order by key',[USER_A])).rows;
    assert.deepEqual(nodes.map(n=>[n.key,n.value,n.category_slug]),[
      ['food.foundation.meal.cook-at-home','Cook at home','food'],
      ['learning.foundation.skill.try-example','Try a small example','career'],
      ['outdoor.foundation.free-hour.exploring','Explore outdoors','hobbies'],
      ['watch.foundation.free-hour.film','Watch a film','movies'],
    ]);
    assert.ok(nodes.every(n=>n.source==='explicit'&&n.polarity==='like'));
    const evidence=(await db.query<{source_question_id:string;kind:string;detail:Record<string,string>}>('select source_question_id,kind,detail from knowledge_evidence where user_id=$1 order by source_question_id',[USER_A])).rows;
    assert.equal(evidence.length,4);
    for(const event of evidence){
      assert.equal(event.kind,'onboarding_answer');assert.equal(event.detail.foundation_edition,'1');assert.equal(event.detail.domain,'everyday life');
      assert.ok(event.detail.prompt.length>20);assert.ok(['a','b'].includes(event.detail.chose));assert.ok(event.detail.topic);
    }
    assert.deepEqual((await asUser(db,USER_A,tx=>tx.query('select * from question_progress()'))).rows,before,'starter choices do not complete Discover daily targets');
    const profile=(await db.query<{memory_generation:number;onboarded_at:string}>('select memory_generation,onboarded_at from profiles where id=$1',[USER_A])).rows[0];
    assert.equal(profile.memory_generation,0,'positive starter answers do not purge existing comparison derivatives');assert.ok(profile.onboarded_at);
  });

  it('treats Both/depends/neither mapped to skip as no single preference and leaves skipped questions unlearned',async()=>{
    await complete(Array.from({length:6},(_,i)=>({questionId:question(i+1),answer:'skip'})));
    assert.equal(await count('question_answers'),6);assert.equal(await count('knowledge_nodes'),0);assert.equal(await count('preferences'),0);assert.equal(await count('knowledge_evidence'),0);
    assert.ok((await db.query<{skipped:boolean}>('select skipped from question_answers where user_id=$1',[USER_A])).rows.every(r=>r.skipped));
    await assert.rejects(complete([{questionId:question(1),answer:'both'}]),/Invalid onboarding answers/);
  });

  it('preserves omitted profile basics while retaining compatible explicit blank and legacy profile behavior',async()=>{
    await complete([], {fullName:'Question-only setup'});
    assert.deepEqual((await db.query('select full_name,country,language,age,occupation from profiles where id=$1',[USER_A])).rows[0],
      {full_name:'Question-only setup',country:'Azerbaijan',language:'az',age:24,occupation:'Builder'});
    await complete([], {fullName:'Legacy full form',country:'',language:'en',age:'28',occupation:''});
    assert.deepEqual((await db.query('select full_name,country,language,age,occupation from profiles where id=$1',[USER_A])).rows[0],
      {full_name:'Legacy full form',country:null,language:'en',age:28,occupation:null});
    await assert.rejects(complete([], {age:'15'}),/16 and older/);
    await assert.rejects(complete([], {age:'121'}),/Invalid age/);
    await assert.rejects(complete([], {country:123}),/Invalid onboarding profile/);
  });

  it('keeps identical saves idempotent and rejects changed answers instead of silently reporting them saved',async()=>{
    await complete();
    const first=(await db.query('select * from knowledge_evidence where user_id=$1 order by id',[USER_A])).rows;
    const onboarded=(await db.query('select onboarded_at from profiles where id=$1',[USER_A])).rows;
    await complete();assert.equal(await count('question_answers'),6);
    assert.deepEqual((await db.query('select * from knowledge_evidence where user_id=$1 order by id',[USER_A])).rows,first);
    assert.deepEqual((await db.query('select onboarded_at from profiles where id=$1',[USER_A])).rows,onboarded);
    await assert.rejects(complete([{questionId:question(1),answer:'b'}]),/already has a saved answer/);
    assert.deepEqual((await db.query('select * from knowledge_evidence where user_id=$1 order by id',[USER_A])).rows,first);
  });

  it('rejects malformed/duplicate/foreign-catalog answers before any partial profile or learning write',async()=>{
    const notOnboarding=(await db.query<{id:string}>('select id from questions where not is_onboarding limit 1')).rows[0].id;
    for(const malformed of [null,{},[{}],[{questionId:question(1)}],[{questionId:question(1),answer:null}],
      [{questionId:question(1),answer:'a',extra:'unreviewed'}],[{questionId:'not-a-uuid',answer:'a'}],
      [{questionId:question(1),answer:'a'},{questionId:question(1),answer:'b'}],
      [{questionId:question(1),answer:'a'},{questionId:notOnboarding,answer:'a'}],Array.from({length:21},()=>({questionId:question(1),answer:'skip'}))]){
      await assert.rejects(complete(malformed),/Invalid onboarding|only once/);
      assert.equal(await count('question_answers'),0);assert.equal(await count('knowledge_nodes'),0);
      assert.equal((await db.query<{name:string}>('select full_name name from profiles where id=$1',[USER_A])).rows[0].name,'Existing name');
    }
  });

  it('retains the legacy onboarding signature/answer learning and blocks direct private or anonymous execution',async()=>{
    await complete([{questionId:oldQuestion,answer:'a'}]);assert.equal(await count('knowledge_nodes'),1);
    const old=(await db.query<{value:string|null}>('select value from knowledge_nodes where user_id=$1',[USER_A])).rows[0];assert.equal(old.value,null);
    assert.deepEqual((await db.query(`select has_function_privilege('authenticated','public.complete_onboarding(jsonb,jsonb,integer)','execute') owner,
      has_function_privilege('anon','public.complete_onboarding(jsonb,jsonb,integer)','execute') anon,
      has_function_privilege('authenticated','nudge_private.complete_onboarding(jsonb,jsonb,integer)','execute') implementation`)).rows[0],{owner:true,anon:false,implementation:false});
    await assert.rejects(asUser(db,USER_A,tx=>tx.exec("select nudge_private.complete_onboarding('{}','[]',0)")),/permission denied/);
    assert.deepEqual((await db.query('select * from question_answers where user_id=$1 order by id',[USER_B])).rows,legacyAnswers,'the requesting account cannot modify another account answers');
  });

  it('rejects an onboarding save begun before memory erasure and accepts only a fresh captured generation',async()=>{
    await asUser(db,USER_A,tx=>tx.exec('select erase_learned_memory()'));
    const generation=(await db.query<{generation:number}>('select memory_generation generation from profiles where id=$1',[USER_A])).rows[0].generation;
    assert.ok(generation>0);await assert.rejects(complete(answers,{fullName:'Stale request'},0),/Memory changed/);
    assert.equal(await count('question_answers'),0);assert.equal(await count('knowledge_nodes'),0);
    assert.equal((await db.query<{name:string}>('select full_name name from profiles where id=$1',[USER_A])).rows[0].name,'Existing name');
    assert.equal(await complete(answers,{fullName:'Fresh explicit answers'},generation),generation);
    assert.equal(await count('knowledge_nodes'),4);
    assert.equal((await db.query<{generation:number}>('select memory_generation generation from profiles where id=$1',[USER_A])).rows[0].generation,generation);
  });
});
