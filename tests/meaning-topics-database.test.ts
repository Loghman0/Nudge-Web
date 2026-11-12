import {before,after,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase,asUser,USER_A,USER_B} from './helpers/database';
import {domainScope} from '../src/lib/services/decision-domain';

describe('meaning and Discover topic database upgrade',()=>{
  let db:PGlite;
  before(async()=>{db=await createTestDatabase(undefined,8);});
  after(async()=>{await db.close();});
  it('adds 42 questions and 36 branches without changing an existing answer or learned record',async()=>{
    const root=(await asUser(db,USER_A,tx=>tx.query<{id:string}>("select id from discover_next_question('food')"))).rows[0];
    await asUser(db,USER_A,tx=>tx.query("select answer_discover_question($1,'a')",[root.id]));
    const before=(await db.query<{questions:number;answers:number;nodes:number}>(`select (select count(*)::integer from questions) questions,
      (select count(*)::integer from question_answers) answers,(select count(*)::integer from knowledge_nodes) nodes`)).rows[0];
    await db.exec(await readFile(new URL('../supabase/migrations/00009_decision_meaning_and_topics.sql',import.meta.url),'utf8'));
    const after=(await db.query<{questions:number;answers:number;nodes:number}>(`select (select count(*)::integer from questions) questions,
      (select count(*)::integer from question_answers) answers,(select count(*)::integer from knowledge_nodes) nodes`)).rows[0];
    assert.deepEqual(after,{...before,questions:before.questions+42});
    assert.equal((await db.query("select * from question_branches b join questions q on q.id=b.child_question_id where q.context->>'edition'='2'")).rows.length,36);
    assert.deepEqual((await db.query<{topic:string}>("select distinct context->>'topic' topic from questions where context->>'edition'='2' order by topic")).rows.map(r=>r.topic),
      ['community','gaming','making','outdoors','reading','sports']);
  });
  it('changes topic without answering, unlocking a path, learning a dislike or altering daily progress',async()=>{
    const stats=async()=>JSON.stringify((await db.query("select (select count(*) from question_answers) answers,(select count(*) from knowledge_evidence) evidence,(select memory_generation from profiles where id=$1) generation",[USER_A])).rows);
    const before=await stats();
    const next=(await asUser(db,USER_A,tx=>tx.query<{id:string;context:{topic:string}}>("select * from discover_other_topic('food')"))).rows[0];
    assert.notEqual(next.context.topic,'food');assert.equal(await stats(),before);
    const original=(await asUser(db,USER_A,tx=>tx.query<{id:string}>("select * from discover_next_question('food')"))).rows[0];
    assert.ok(original.id);assert.notEqual(original.id,next.id);
    assert.equal((await db.query("select * from question_answers where user_id=$1 and question_id=$2",[USER_A,original.id])).rows.length,0);
  });
  async function comparison(domain:string) {
    const id=(await asUser(db,USER_A,tx=>tx.query<{id:string}>(`select create_comparison('hobbies','Gather materials',$1::jsonb,null,
      '[{"label":"Mining","score":0.5,"breakdown":{}},{"label":"Woodcutting","score":0.5,"breakdown":{}}]'::jsonb,0) id`,
      [JSON.stringify({domain,meaningConfirmed:true,goal:'Test scope',optionDetails:{Mining:'Defined by the test user'}})]))).rows[0].id;
    const option=(await db.query<{id:string}>("select id from decision_options where decision_id=$1 and label='Mining'",[id])).rows[0].id;
    return {id,option};
  }
  it('learns and reflects within the owned decision setting and keeps legacy signatures and owner checks',async()=>{
    const game=await comparison('my game v2'),work=await comparison('real-world work');
    for(const c of [game,work])await asUser(db,USER_A,tx=>tx.query("select commit_choice_and_learn($1,$2,'learned.hobbies.mining')",[c.id,c.option]));
    const keys=(await db.query<{key:string}>("select key from knowledge_nodes where user_id=$1 and value='Mining' order by key",[USER_A])).rows.map(r=>r.key);
    assert.deepEqual(keys.sort(),['my game v2','real-world work'].map(d=>'learned.hobbies.scope.'+domainScope(d)+'.mining').sort());
    await asUser(db,USER_A,tx=>tx.query("select * from submit_decision_reflection($1,5,true,false,true,true,'Useful','learned.hobbies.mining')",[game.id]));
    assert.equal((await db.query("select * from knowledge_evidence where source_decision_id=$1",[game.id])).rows.length,2);
    await assert.rejects(asUser(db,USER_B,tx=>tx.query("select commit_choice_and_learn($1,$2,'learned.hobbies.mining')",[game.id,game.option])),/Decision not found/);
    assert.equal((await db.query("select * from knowledge_nodes where user_id=$1 and key='learned.hobbies.mining'",[USER_A])).rows.length,0);
  });
  it('bounds metadata at the database boundary and denies direct access to private learning implementations',async()=>{
    await assert.rejects(asUser(db,USER_A,tx=>tx.query("select create_comparison('hobbies','Bad context',$1::jsonb,null,'[{\"label\":\"A\",\"score\":0.5,\"breakdown\":{}},{\"label\":\"B\",\"score\":0.5,\"breakdown\":{}}]'::jsonb,0)",[JSON.stringify({domain:'x',meaningConfirmed:false})])),/Confirm a valid/);
    const permissions=(await db.query<{anon:boolean;private_commit:boolean;private_reflect:boolean}>(`select
      has_function_privilege('anon','public.discover_other_topic(text)','execute') anon,
      has_function_privilege('authenticated','nudge_private.commit_choice_unscoped(uuid,uuid,text)','execute') private_commit,
      has_function_privilege('authenticated','nudge_private.submit_reflection_unscoped(uuid,integer,boolean,boolean,boolean,boolean,text,text)','execute') private_reflect`)).rows[0];
    assert.deepEqual(permissions,{anon:false,private_commit:false,private_reflect:false});
  });
  it('keeps corrections, forgetting and later signals inside the same setting while retaining suppression',async()=>{
    const gameKey='learned.hobbies.scope.'+domainScope('my game v2')+'.mining';
    const workKey='learned.hobbies.scope.'+domainScope('real-world work')+'.mining';
    const node=(await db.query<{id:string}>("select id from knowledge_nodes where user_id=$1 and key=$2",[USER_A,gameKey])).rows[0].id;
    await asUser(db,USER_A,tx=>tx.query("select correct_knowledge_node($1,'dislike','Only in this game')",[node]));
    assert.equal((await db.query<{polarity:string}>("select polarity from knowledge_nodes where user_id=$1 and key=$2",[USER_A,workKey])).rows[0].polarity,'like');
    await asUser(db,USER_A,tx=>tx.query("select record_knowledge_signal($1,'Mining','hobbies','like','inferred',0.2::real,'manual')",[workKey]));
    assert.equal((await db.query<{polarity:string}>("select polarity from knowledge_nodes where user_id=$1 and key=$2",[USER_A,gameKey])).rows[0].polarity,'dislike');
    await asUser(db,USER_A,tx=>tx.query("select forget_knowledge_key($1)",[gameKey]));
    assert.equal((await db.query<{status:string}>("select status from knowledge_nodes where user_id=$1 and key=$2",[USER_A,workKey])).rows[0].status,'active');
    assert.equal((await asUser(db,USER_A,tx=>tx.query<{id:string|null}>("select record_knowledge_signal($1,'Mining','hobbies','like','explicit',0.2::real,'manual') id",[gameKey+'-alias']))).rows[0].id,null);
    assert.ok((await asUser(db,USER_A,tx=>tx.query<{id:string|null}>("select record_knowledge_signal($1,'Mining','hobbies','like','explicit',0.2::real,'manual') id",[workKey]))).rows[0].id);
  });
  it('stores new-topic answers under the right knowledge category and unlocks only the chosen branch',async()=>{
    for(const [topic,category] of [['reading','movies'],['outdoors','hobbies'],['community','relationships']]){
      const q=(await asUser(db,USER_B,tx=>tx.query<{id:string;maps_to_key_a:string}>("select * from discover_next_question($1)",[topic]))).rows[0];
      await asUser(db,USER_B,tx=>tx.query("select answer_discover_question($1,'a')",[q.id]));
      const belief=(await db.query<{category_slug:string}>("select category_slug from knowledge_nodes where user_id=$1 and key=$2",[USER_B,q.maps_to_key_a])).rows[0];
      assert.equal(belief.category_slug,category);
      const next=(await asUser(db,USER_B,tx=>tx.query<{id:string}>("select * from discover_next_question($1)",[topic]))).rows[0];
      assert.equal((await db.query<{parent_choice:string}>("select parent_choice from question_branches where child_question_id=$1",[next.id])).rows[0].parent_choice,'a');
    }
  });
  it('requires current AI consent for interpretation and enforces its durable ten-call limit',async()=>{
    assert.equal((await asUser(db,USER_A,tx=>tx.query<{ok:boolean}>("select reserve_ai_request('interpret') ok"))).rows[0].ok,false);
    await db.query("update profiles set ai_enabled=true,terms_version='2026-10-12' where id=$1",[USER_A]);
    for(let i=0;i<10;i++)assert.equal((await asUser(db,USER_A,tx=>tx.query<{ok:boolean}>("select reserve_ai_request('interpret') ok"))).rows[0].ok,true);
    assert.equal((await asUser(db,USER_A,tx=>tx.query<{ok:boolean}>("select reserve_ai_request('interpret') ok"))).rows[0].ok,false);
  });
  it('replays the generated existing-upgrade file without duplicating questions or moving journal state',async()=>{
    const before=(await db.query<{questions:number;answers:number;nodes:number}>("select (select count(*) from questions) questions,(select count(*) from question_answers) answers,(select count(*) from knowledge_nodes) nodes")).rows;
    const update=await readFile(new URL('../sql/02_UPDATE_EXISTING.sql',import.meta.url),'utf8');
    await db.exec(update);
    const expected=before.map(row=>({...row,questions:Number(row.questions)+6}));
    assert.deepEqual((await db.query("select (select count(*) from questions) questions,(select count(*) from question_answers) answers,(select count(*) from knowledge_nodes) nodes")).rows,expected);
    await db.exec(update);
    assert.deepEqual((await db.query("select (select count(*) from questions) questions,(select count(*) from question_answers) answers,(select count(*) from knowledge_nodes) nodes")).rows,expected);
  });
});
