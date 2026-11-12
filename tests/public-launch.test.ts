import { before,after,describe,it } from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase,asUser,USER_A,USER_B} from './helpers/database';

describe('public launch privacy and atomic circles',()=>{
 let db:PGlite;before(async()=>{db=await createTestDatabase();});after(async()=>{await db.close();});
 const rpc=(user:string,sql:string,values:unknown[]=[])=>asUser(db,user,tx=>tx.query<Record<string,unknown>>(sql,values));
 it('defaults AI off, records versioned terms, validates age and prevents direct consent forgery',async()=>{
  const {rows}=await db.query<{ai_enabled:boolean;terms_version:string|null}>('select ai_enabled,terms_version from profiles where id=$1',[USER_A]);assert.equal(rows[0].ai_enabled,false);assert.equal(rows[0].terms_version,null);
  await assert.rejects(rpc(USER_A,"select set_ai_enabled(true)"),/Accept the current terms/);
  await assert.rejects(rpc(USER_A,"select accept_legal_terms('old',true)"),/Confirm eligibility/);
  await assert.rejects(rpc(USER_A,"select accept_legal_terms('2026-10-12',false)"),/Confirm eligibility/);
  await assert.rejects(rpc(USER_A,"update profiles set ai_enabled=true where id=$1",[USER_A]),/permission denied/);
  await rpc(USER_A,"select accept_legal_terms('2026-10-12',true)");
  assert.equal((await db.query<{terms_version:string}>('select terms_version from profiles where id=$1',[USER_A])).rows[0].terms_version,'2026-10-12');
  assert.equal((await rpc(USER_A,"select reserve_ai_request('explain') allowed")).rows[0].allowed,false);
 });
 it('enabling/disabling AI invalidates stale jobs and enforces durable quotas across callers',async()=>{
  const before=(await db.query<{memory_generation:number}>('select memory_generation from profiles where id=$1',[USER_A])).rows[0].memory_generation;
  await rpc(USER_A,'select set_ai_enabled(true)');
  assert.equal((await db.query<{memory_generation:number}>('select memory_generation from profiles where id=$1',[USER_A])).rows[0].memory_generation,before+1);
  for(let i=0;i<5;i++)assert.equal((await rpc(USER_A,"select reserve_ai_request('recap') allowed")).rows[0].allowed,true);
  assert.equal((await rpc(USER_A,"select reserve_ai_request('recap') allowed")).rows[0].allowed,false);
  assert.equal((await rpc(USER_B,"select reserve_ai_request('recap') allowed")).rows[0].allowed,false);
  assert.equal((await rpc(USER_A,"select reserve_ai_request('unbounded') allowed")).rows[0].allowed,false);
  await rpc(USER_A,'select set_ai_enabled(false)');
  assert.equal((await rpc(USER_A,"select reserve_ai_request('extract') allowed")).rows[0].allowed,false);
 });
 let group:string,poll:string,option:string,oldCode:string;
 it('creates circle and membership together and checks poll creation transactionally',async()=>{
  group=String((await rpc(USER_A,"select create_circle('Weekend test') id")).rows[0].id);
  assert.equal((await db.query('select * from decision_group_members where group_id=$1 and user_id=$2',[group,USER_A])).rows.length,1);
  await assert.rejects(rpc(USER_B,"select create_circle_poll($1,'Dinner?','[\"Pizza\",\"Soup\"]')",[group]),/Circle not found/);
  await assert.rejects(rpc(USER_A,"select create_circle_poll($1,'Dinner?','[\"Pizza\",\"pizza\"]')",[group]),/must be distinct/);
  await assert.rejects(rpc(USER_A,"select create_circle_poll($1,'Dinner?','[\"Pizza\",\"\"]')",[group]),/1 to 100/);
  assert.equal((await db.query('select * from group_polls where group_id=$1',[group])).rows.length,0);
  poll=String((await rpc(USER_A,"select create_circle_poll($1,'Dinner?','[\"Pizza\",\"Soup\"]') id",[group])).rows[0].id);
  option=(await db.query<{id:string}>('select id from group_poll_options where poll_id=$1 order by sort_order',[poll])).rows[0].id;
  oldCode=(await db.query<{invite_code:string}>('select invite_code from decision_groups where id=$1',[group])).rows[0].invite_code;
 });
 it('joins, rotates invitations, rejects stale codes and disallows direct structural writes',async()=>{
  await rpc(USER_B,'select join_decision_circle($1)',[oldCode]);
  const rotated=String((await rpc(USER_A,"select manage_circle($1,'rotate_invite') code",[group])).rows[0].code);assert.notEqual(rotated,oldCode);
  await assert.rejects(rpc(USER_B,'select join_decision_circle($1)',[oldCode]),/no longer valid/);
  await assert.rejects(rpc(USER_B,"select manage_circle($1,'rotate_invite')",[group]),/cannot manage/);
  await assert.rejects(rpc(USER_A,"insert into decision_groups(owner_id,name) values($1,'Forged')",[USER_A]),/permission denied/);
 });
 it('votes safely, exposes only aggregates/own vote, removes departing votes, and rejects closed votes',async()=>{
  await rpc(USER_A,'select cast_circle_vote($1,$2)',[poll,option]);await rpc(USER_B,'select cast_circle_vote($1,$2)',[poll,option]);
  assert.equal((await rpc(USER_B,'select * from group_poll_votes where poll_id=$1',[poll])).rows.length,1);
  assert.equal((await rpc(USER_B,'select * from circle_vote_counts($1)',[group])).rows.find(row=>row.option_id===option)!.votes,2);
  await assert.rejects(rpc(USER_A,"select manage_circle($1,'leave')",[group]),/Owners must delete/);
  await rpc(USER_B,"select manage_circle($1,'leave')",[group]);
  assert.equal((await db.query('select * from group_poll_votes where poll_id=$1 and user_id=$2',[poll,USER_B])).rows.length,0);
  await rpc(USER_A,'select close_circle_poll($1,$2)',[group,poll]);
  await assert.rejects(rpc(USER_A,'select cast_circle_vote($1,$2)',[poll,option]),/closed or unavailable/);
  await rpc(USER_A,"select manage_circle($1,'delete')",[group]);assert.equal((await db.query('select * from group_polls where id=$1',[poll])).rows.length,0);
 });
 it('does not let onboarding questions or skipped Discover answers finish the daily target',async()=>{
  const {rows}=await db.query<{id:string}>('select id from questions where is_onboarding limit 1');
  await rpc(USER_B,"select answer_discover_question($1,'a')",[rows[0].id]);
  const {rows:q}=await rpc(USER_B,"select * from discover_next_question('food')");await rpc(USER_B,"select answer_discover_question($1,'skip')",[q[0].id]);
  assert.equal((await rpc(USER_B,'select * from question_progress()')).rows[0].answered_today,0);
 });
 it('removes all user-owned live records including private quotas when the auth account is deleted',async()=>{
  await db.query('delete from auth.users where id=$1',[USER_A]);
  for(const table of ['profiles','decisions','preferences','knowledge_nodes','question_answers']){
   const column=table==='profiles'?'id':'user_id';assert.equal((await db.query(`select * from ${table} where ${column}=$1`,[USER_A])).rows.length,0);
  }
  assert.equal((await db.query('select * from nudge_private.ai_usage where user_id=$1',[USER_A])).rows.length,0);
 });
});

it('existing-update SQL is idempotent on an updated database and preserves answers',async()=>{
 const db=await createTestDatabase();try{
  const {rows}=await asUser(db,USER_A,tx=>tx.query<{id:string}>("select id from discover_next_question('food')"));
  await asUser(db,USER_A,tx=>tx.query("select answer_discover_question($1,'a')",[rows[0].id]));
  const sql=await readFile(new URL('../sql/02_UPDATE_EXISTING.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
  assert.equal((await db.query('select * from question_answers where user_id=$1',[USER_A])).rows.length,1);
  await assert.rejects(db.exec(await readFile(new URL('../sql/01_FRESH_DATABASE.sql',import.meta.url),'utf8')),/Existing Nudge data found/);
 }finally{await db.close();}
});

it('upgrades the current 00004 installation once while retaining old questions and memory and adding the expansion',async()=>{
 const db=await createTestDatabase(undefined,4);try{
  await asUser(db,USER_A,tx=>tx.query("select record_knowledge_signal('food.release','Release food','food','like','explicit',0.5::real,'manual')"));
  const count=(await db.query<{n:number}>('select count(*)::integer n from questions')).rows[0].n;
  const originalQuestions=(await db.query<{id:string;prompt:string;option_a:string|null;option_b:string|null;maps_to_key_a:string|null;maps_to_key_b:string|null}>('select id,prompt,option_a,option_b,maps_to_key_a,maps_to_key_b from questions order by id')).rows;
  const orphan=(await db.query<{id:string}>("insert into decision_groups(owner_id,name) values($1,'Legacy orphan') returning id",[USER_A])).rows[0].id;
  await db.exec(await readFile(new URL('../sql/02_UPDATE_EXISTING.sql',import.meta.url),'utf8'));
  assert.equal((await db.query<{n:number}>('select count(*)::integer n from questions')).rows[0].n,count+42+6); // expansion plus six foundation questions
  const originalIds=originalQuestions.map(row=>row.id);
  assert.deepEqual((await db.query('select id,prompt,option_a,option_b,maps_to_key_a,maps_to_key_b from questions where id=any($1::uuid[]) order by id',[originalIds])).rows,originalQuestions);
  assert.equal((await db.query('select * from preferences where user_id=$1',[USER_A])).rows.length,1);
  assert.equal((await db.query<{ai_enabled:boolean}>('select ai_enabled from profiles where id=$1',[USER_A])).rows[0].ai_enabled,false);
  assert.equal((await db.query<{role:string}>('select role from decision_group_members where group_id=$1 and user_id=$2',[orphan,USER_A])).rows[0].role,'owner');
  const verify=await db.query<Record<string,boolean>>(await readFile(new URL('../sql/03_VERIFY_DATABASE.sql',import.meta.url),'utf8'));
  assert.ok(Object.values(verify.rows[0]).every(value=>value===true));
 }finally{await db.close();}
});
