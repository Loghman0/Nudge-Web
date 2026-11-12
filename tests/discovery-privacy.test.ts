import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createTestDatabase,asUser,USER_A,USER_B} from './helpers/database';

test('Discovery privacy repair retracts orphan sources and keeps unrelated explicit feedback',async()=>{
 const db=await createTestDatabase();
 try{
  const dir=new URL('../supabase/migrations/',import.meta.url);
  for(const file of (await readdir(dir)).filter(f=>/^0001[0-6]_.*sql$/.test(f)).sort())await db.exec(await readFile(new URL(file,dir),'utf8'));
  const answer=(questionId:string)=>({questionId,questionVersion:1,response:{kind:'choice',optionId:'a'}});
  const save=async(user=USER_A)=> (await asUser(db,user,tx=>tx.query<{value:{answerIds:string[]}}>('select save_discovery_answers($1,0,$2,\'preview\') value',[randomUUID(),JSON.stringify([answer('time-free-day'),answer('rest-break'),answer('learning-puzzle'),answer('food-snack')])]))).rows[0].value;
  const saved=await save();
  const key=(await db.query<{key:string}>("select key from public.knowledge_nodes where user_id=$1 and value='You chose one planned activity with room around it.'",[USER_A])).rows[0].key;
  await asUser(db,USER_A,tx=>tx.query('select forget_knowledge_key($1)',[key]));
  await asUser(db,USER_A,tx=>tx.query('select edit_discovery_answer($1,1,$2,0,null,null,true)',[randomUUID(),saved.answerIds[0]]));
  assert.equal((await db.query<{n:number}>("select count(*)::int n from public.knowledge_evidence where user_id=$1 and detail->>'discoveryAnswerId'=$2",[USER_A,saved.answerIds[0]])).rows[0].n,1,'fixture reproduces the old orphan');
  await db.exec(await readFile(new URL('00017_discovery_privacy.sql',dir),'utf8'));
  assert.equal((await db.query<{n:number}>("select count(*)::int n from public.knowledge_evidence where user_id=$1 and detail->>'discoveryAnswerId'=$2",[USER_A,saved.answerIds[0]])).rows[0].n,0);
  assert.equal((await db.query<{n:number}>('select count(*)::int n from public.knowledge_nodes where user_id=$1 and key=$2',[USER_A,key])).rows[0].n,0);
  assert.equal((await db.query<{n:number}>('select count(*)::int n from public.forgotten_knowledge_keys where user_id=$1 and key=$2',[USER_A,key])).rows[0].n,1);
  const state=(await asUser(db,USER_A,tx=>tx.query<{s:{suppressedQuestionIds:string[]}}>('select read_discovery_state() s'))).rows[0].s;
  assert.ok(state.suppressedQuestionIds.includes('time-free-day'));
  assert.deepEqual((await asUser(db,USER_B,tx=>tx.query<{s:{suppressedQuestionIds:string[]}}>('select read_discovery_state() s'))).rows[0].s.suppressedQuestionIds,[]);
  await assert.rejects(asUser(db,USER_A,tx=>tx.query('select reserve_discovery_question($1,2,$2,1)',[randomUUID(),'time-free-day'])),/forgotten/);
  await assert.rejects(asUser(db,USER_A,tx=>tx.query('select save_discovery_answers($1,2,$2,\'preview\')',[randomUUID(),JSON.stringify([answer('time-free-day')])])),/forgotten/);

  // Negative/context corrections survive unrelated answer changes and forget.
  const feedbackId=async(question:string)=>(await db.query<{id:string}>("select nudge_private.discovery_reflection_id(definition->'signals'->0) id from public.discovery_question_versions where question_id=$1 and version=1",[question])).rows[0].id;
  for(const [question,feedback] of [['learning-puzzle','not_me'],['food-snack','sometimes'],['rest-break','fits']]){
   const id=await feedbackId(question);
   await asUser(db,USER_A,tx=>tx.query('select save_discovery_feedback($1,2,$2,$3)',[randomUUID(),id,feedback]));
  }
  await asUser(db,USER_A,tx=>tx.query('select edit_discovery_answer($1,2,$2,0,$3)',[randomUUID(),saved.answerIds[1],JSON.stringify({kind:'neither'})]));
  assert.equal((await db.query<{n:number}>('select count(*)::int n from nudge_private.discovery_feedback where user_id=$1',[USER_A])).rows[0].n,2);
  await asUser(db,USER_A,tx=>tx.query('select edit_discovery_answer($1,3,$2,0,null,null,true)',[randomUUID(),saved.answerIds[2]]));
  assert.deepEqual((await db.query<{insight_id:string}>('select insight_id from nudge_private.discovery_feedback where user_id=$1',[USER_A])).rows.map(row=>row.insight_id),[await feedbackId('food-snack')],'deleting the last source removes its feedback but preserves other corrections');
  const encoded=(await db.query<{value:string}>('select nudge_private.discovery_encode_component($1) value',["café / ☀ &!'()"])).rows[0].value;
  assert.equal(encoded,encodeURIComponent("café / ☀ &!'()"));

  const other=await save(USER_B);
  const otherKey=(await db.query<{key:string}>("select key from public.knowledge_nodes where user_id=$1 and value='You chose one planned activity with room around it.'",[USER_B])).rows[0].key;
  await asUser(db,USER_B,tx=>tx.query('select forget_knowledge_key($1)',[otherKey]));
  assert.equal((await db.query<{revision:number}>('select revision from nudge_private.discovery_answers where id=$1',[other.answerIds[0]])).rows[0].revision,1);
  await assert.rejects(asUser(db,USER_B,tx=>tx.query('select edit_discovery_answer($1,1,$2,1,null,true)',[randomUUID(),other.answerIds[0]])),/forgotten/);
  await asUser(db,USER_B,tx=>tx.query('select edit_discovery_answer($1,1,$2,1,null,null,true)',[randomUUID(),other.answerIds[0]]));
  assert.equal((await db.query<{n:number}>('select count(*)::int n from public.knowledge_nodes where user_id=$1 and key=$2',[USER_B,otherKey])).rows[0].n,0);
  assert.equal((await db.query<{n:number}>("select count(*)::int n from public.knowledge_evidence where user_id=$1 and detail->>'discoveryAnswerId'=$2",[USER_B,other.answerIds[0]])).rows[0].n,0);
  assert.equal((await db.query<{denied:boolean}>("select not has_table_privilege('authenticated','nudge_private.discovery_rollout','select,insert,update,delete') denied")).rows[0].denied,true);
  await assert.rejects(asUser(db,USER_B,tx=>tx.query("select save_discovery_preferences(2,'[]',true,2,true,false)")),/not available yet/);
  await assert.rejects(asUser(db,USER_B,tx=>tx.query("select reserve_discovery_question($1,2,'values-friction',1)",[randomUUID()])),/not available yet/);
  await assert.rejects(asUser(db,USER_B,tx=>tx.query("select save_discovery_answers($1,2,$2,'preview')",[randomUUID(),JSON.stringify([{...answer('rest-break'),response:{kind:'depends',context:'private written context'}}])])),/Written answers are turned off/);
  await db.exec('update nudge_private.discovery_rollout set written_answers_ready=true,optional_topics_ready=true');
  await asUser(db,USER_B,tx=>tx.query("select save_discovery_preferences(2,'[]',true,2,true,false)"));
  const reservation=randomUUID();
  await asUser(db,USER_B,tx=>tx.query("select reserve_discovery_question($1,2,'values-friction',1,true)",[reservation]));
  const written=(await asUser(db,USER_B,tx=>tx.query<{value:{answerIds:string[]}}>("select save_discovery_answers($1,2,$2) value",[randomUUID(),JSON.stringify([{questionId:'values-friction',questionVersion:1,response:{kind:'text',text:'Too many meetings'}}])]))).rows[0].value;
  await db.exec('update nudge_private.discovery_rollout set written_answers_ready=false,optional_topics_ready=false');
  await assert.rejects(asUser(db,USER_B,tx=>tx.query("select reserve_discovery_question($1,2,'values-friction',1,true)",[reservation])),/no longer available/);
  await assert.rejects(asUser(db,USER_B,tx=>tx.query('select edit_discovery_answer($1,2,$2,0,$3)',[randomUUID(),written.answerIds[0],JSON.stringify({kind:'text',text:'Another written answer'})])),/Written answers are turned off/);
  await asUser(db,USER_B,tx=>tx.query('select edit_discovery_answer($1,2,$2,0,$3)',[randomUUID(),written.answerIds[0],JSON.stringify({kind:'skip'})]));
  const closedState=(await asUser(db,USER_B,tx=>tx.query<{s:{capabilities:unknown}}>('select read_discovery_state() s'))).rows[0].s;
  assert.deepEqual(closedState.capabilities,{writtenAnswers:false,optionalTopics:false});
  await db.exec('update nudge_private.discovery_rollout set written_answers_ready=true');
  const correctionState=(await asUser(db,USER_B,tx=>tx.query<{s:{generation:number}}>('select read_discovery_state() s'))).rows[0].s;
  const contextResponse={kind:'depends',context:'Only on evenings when I have time.'};
  await asUser(db,USER_B,tx=>tx.query('select edit_discovery_answer($1,$2,$3,0,$4)',[randomUUID(),correctionState.generation,other.answerIds[1],JSON.stringify(contextResponse)]));
  const corrected=(await db.query<{response:unknown}>('select response from nudge_private.discovery_answers where id=$1',[other.answerIds[1]])).rows[0];
  assert.deepEqual(corrected.response,contextResponse);
  assert.equal((await db.query<{n:number}>("select count(*)::int n from public.knowledge_evidence where detail->>'discoveryAnswerId'=$1",[other.answerIds[1]])).rows[0].n,0);
  await asUser(db,USER_A,tx=>tx.query('select erase_learned_memory()'));
  assert.equal((await db.query<{n:number}>('select count(*)::int n from nudge_private.discovery_feedback where user_id=$1',[USER_A])).rows[0].n,0);
 }finally{await db.close();}
});
