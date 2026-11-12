import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createTestDatabase,asUser,USER_A,USER_B} from './helpers/database';
import {PREVIEW_QUESTIONS,DISCOVERY_CATALOG} from '../src/lib/discovery/catalog';
test('Discovery saves, retries, version validation, ownership, edits and deletion are transactional',async()=>{
 const db=await createTestDatabase();
 try{
  const dir=new URL('../supabase/migrations/',import.meta.url);
  for(const file of (await readdir(dir)).filter(f=>/^000(?:1[0-9])_.*sql$/.test(f)).sort())await db.exec(await readFile(new URL(file,dir),'utf8'));
  await db.exec(await readFile(new URL('00022_discovery_decision_priorities.sql',dir),'utf8'));
  const newQuestion=DISCOVERY_CATALOG.find(question=>question.id==='study-short-session')!;
  const storedQuestion=await db.query<{definition:unknown}>('select definition from public.discovery_question_versions where question_id=$1 and version=$2',[newQuestion.id,newQuestion.version]);
  assert.deepEqual(storedQuestion.rows[0]?.definition,newQuestion);
  const versions=(await db.query<{version:number;definition:{prompt:string}}>("select version,definition from public.discovery_question_versions where question_id='learning-puzzle' order by version")).rows;
  assert.deepEqual(versions.map(q=>q.version),[1,2]);assert.match(versions[0].definition.prompt,/puzzle box/);assert.doesNotMatch(versions[1].definition.prompt,/puzzle box/);
  const q=PREVIEW_QUESTIONS[0],answer={questionId:q.id,questionVersion:q.version,response:{kind:'choice',optionId:q.choices![0].id}},request=randomUUID();
  const save=()=>asUser(db,USER_A,tx=>tx.query<{value:{generation:number;answerIds:string[]}}>('select save_discovery_answers($1,0,$2,\'preview\') value',[request,JSON.stringify([answer])]));
  const first=await save();assert.deepEqual((await save()).rows,first.rows);
  const id=first.rows[0].value.answerIds[0];
  assert.equal((await asUser(db,USER_B,tx=>tx.query<{s:{answers:unknown[]}}>('select read_discovery_state() s'))).rows[0].s.answers.length,0);
  await assert.rejects(asUser(db,USER_B,tx=>tx.query('select edit_discovery_answer($1,0,$2,0,null,null,true)',[randomUUID(),id])),/not found/);
  await assert.rejects(asUser(db,USER_A,tx=>tx.query('select save_discovery_answers($1,0,$2,\'preview\')',[randomUUID(),JSON.stringify([{...answer,response:{kind:'choice'}}])])),/Invalid/);
  const edit=randomUUID();
  await asUser(db,USER_A,tx=>tx.query('select edit_discovery_answer($1,0,$2,0,$3)',[edit,id,JSON.stringify({kind:'neither'})]));
  await asUser(db,USER_A,tx=>tx.query('select edit_discovery_answer($1,0,$2,0,$3)',[edit,id,JSON.stringify({kind:'neither'})]));
  assert.equal((await db.query<{n:number}>("select count(*)::integer n from public.knowledge_nodes where user_id=$1 and key like 'discovery.%'",[USER_A])).rows[0].n,0);
  await asUser(db,USER_A,tx=>tx.query('select edit_discovery_answer($1,1,$2,1,null,null,true)',[randomUUID(),id]));
  assert.equal((await db.query<{n:number}>('select count(*)::integer n from nudge_private.discovery_answer_revisions')).rows[0].n,0);
  await assert.rejects(asUser(db,USER_A,tx=>tx.query('select * from nudge_private.discovery_answers')),/permission denied/);
  for(const q of DISCOVERY_CATALOG){
   const response=q.format==='choice'?{kind:'choice',optionId:q.choices![0].id}:q.format==='scale'?{kind:'scale',value:q.scale!.min}:q.format==='ranking'?{kind:'ranking',groups:q.choices!.slice(0,q.ranking!.min).map(c=>[c.id])}:{kind:'text',text:'A little note'};
   assert.equal((await db.query<{ok:boolean}>('select nudge_private.validate_discovery_response($1,$2) ok',[JSON.stringify(q),JSON.stringify(response)])).rows[0].ok,true,q.id);
  }
  const reserveId=randomUUID();
  await asUser(db,USER_A,tx=>tx.query('select reserve_discovery_question($1,2,$2,2,true)',[reserveId,q.id]));
  await asUser(db,USER_A,tx=>tx.query('select save_discovery_answers($1,2,$2,\'daily\')',[randomUUID(),JSON.stringify([answer])]));
  const daily=(await asUser(db,USER_A,tx=>tx.query<{e:{question_id:string;state:string}}>('select reserve_discovery_question($1,2,$2,1,true) e',[randomUUID(),PREVIEW_QUESTIONS[1].id]))).rows[0].e;
  assert.equal(daily.question_id,q.id);assert.equal(daily.state,'answered');
  await assert.rejects(asUser(db,USER_A,tx=>tx.query('select reserve_discovery_question($1,2,$2,1,false)',[randomUUID(),'childhood-kept-interest'])),/Unavailable|outside/);
  const node=(await db.query<{key:string}>("select key from public.knowledge_nodes where user_id=$1 and key like 'discovery.%'",[USER_A])).rows[0];assert.ok(node);
  await asUser(db,USER_A,tx=>tx.query('select public.forget_knowledge_key($1)',[node.key]));
  assert.equal((await asUser(db,USER_A,tx=>tx.query<{s:{answers:{active:boolean}[]}}>('select read_discovery_state() s'))).rows[0].s.answers[0].active,false);
  await asUser(db,USER_A,tx=>tx.query('select public.erase_learned_memory()'));
  for(const table of ['discovery_answers','discovery_answer_revisions','discovery_requests','discovery_exposures','discovery_feedback','discovery_settings','discovery_metrics'])assert.equal((await db.query<{n:number}>(`select count(*)::integer n from nudge_private.${table} where user_id=$1`,[USER_A])).rows[0].n,0,table);
 }finally{await db.close();}
});
