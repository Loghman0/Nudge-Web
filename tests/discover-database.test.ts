import { before,after,describe,it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase,asUser,USER_A,USER_B } from './helpers/database';

describe('Discover question trees and quick checks',()=>{
  let db:PGlite;
  before(async()=>{db=await createTestDatabase();}); after(async()=>{await db.close();});
  const next = (topic:string,user=USER_A) => asUser(db,user,tx=>tx.query<{id:string;prompt:string;context:{depth:number;topic:string;connection?:string}}>('select * from public.discover_next_question($1)',[topic]));
  const answer=(id:string,choice:string,user=USER_A)=>asUser(db,user,tx=>tx.query('select public.answer_discover_question($1,$2)',[id,choice]));
  it('seeds 126 distinct questions, 108 connections and 18 complete two-level trees',async()=>{
    const {rows}=await db.query<{total:number;topics:number}>('select count(*)::integer total,count(distinct context->>\'topic\')::integer topics from questions where context->>\'edition\'=\'1\'');
    assert.deepEqual(rows[0],{total:126,topics:18});
    assert.equal((await db.query("select b.* from question_branches b join questions q on q.id=b.child_question_id where q.context->>'edition'='1'")).rows.length,108);
    const duplicates=await db.query('select prompt from questions group by prompt having count(*)>1');assert.equal(duplicates.rows.length,0);
  });
  it('saves the finance question from the reported failure and advances',async()=>{
    const {rows}=await db.query<{id:string}>("select id from questions where prompt='Budget every month or keep a rough eye?'");
    await answer(rows[0].id,'a'); await answer(rows[0].id,'a');
    assert.equal((await db.query('select * from question_answers where user_id=$1 and question_id=$2',[USER_A,rows[0].id])).rows.length,1);
    const {rows:nodes}=await db.query<{category_slug:string;value:string}>('select category_slug,value from knowledge_nodes where user_id=$1 and key=\'finance.budgeter\'',[USER_A]);
    assert.equal(nodes[0].category_slug,'finance');assert.equal(nodes[0].value,'Budget it');
    assert.notEqual((await next('finance')).rows[0].id,rows[0].id);
  });
  it('unlocks only the chosen branch, follows through two levels, and links chosen beliefs',async()=>{
    const root=(await next('food')).rows[0];assert.equal(root.context.depth,0);
    const {rows:branches}=await db.query<{child_question_id:string;parent_choice:string}>('select * from question_branches where parent_question_id=$1 order by parent_choice',[root.id]);
    await assert.rejects(answer(branches[0].child_question_id,'a'),/not available/);
    await answer(root.id,'b');
    const child=(await next('food')).rows[0];assert.equal(child.id,branches[1].child_question_id);
    assert.match(child.context.connection!,/Perfect a familiar favourite/);
    assert.notEqual((await next('food',USER_B)).rows[0].id,child.id);
    await answer(child.id,'a');
    const leaf=(await next('food')).rows[0];assert.equal(leaf.context.depth,2);
    await answer(leaf.id,'b');
    assert.equal((await db.query("select * from knowledge_edges where user_id=$1 and relation='contextualizes'",[USER_A])).rows.length,2);
    assert.equal((await db.query('select * from question_answers where user_id=$1 and question_id=$2',[USER_A,branches[0].child_question_id])).rows.length,0);
    const counts=await asUser(db,USER_A,tx=>tx.query<{total_questions:number;total_answered:number;answered_today:number}>('select * from question_progress()'));
    assert.equal(counts.rows[0].answered_today,4);assert.ok(counts.rows[0].total_questions>counts.rows[0].total_answered);
  });
  it('skips without learning or unlocking a branch and respects topic boundaries',async()=>{
    const root=(await next('music')).rows[0];await answer(root.id,'skip');
    assert.equal((await db.query('select * from knowledge_evidence where source_question_id=$1',[root.id])).rows.length,0);
    const following=(await next('music')).rows[0];assert.equal(following.context.topic,'music');assert.notEqual(following.id,root.id);
    assert.equal((await next('nonexistent')).rows.length,0);
  });
  async function queue(polarity:string,key:string) {
    const {rows:n}=await asUser(db,USER_A,tx=>tx.query<{id:string}>("select public.record_knowledge_signal($1,$3,'hobbies',$2,'inferred',1::real,'manual') id",[key,polarity,key.split('.').pop()]));
    const {rows:q}=await db.query<{id:string}>('insert into knowledge_verification_queue(user_id,node_id,prompt) values($1,$2,\'Still true?\') returning id',[USER_A,n[0].id]);
    return {node:n[0].id,id:q[0].id};
  }
  it('confirms dislikes, neutralizes outdated assumptions and retries without duplicate evidence',async()=>{
    const q=await queue('dislike','hobby.languages');
    await asUser(db,USER_A,tx=>tx.query("select answer_knowledge_verification($1,'still_true')",[q.id]));
    await asUser(db,USER_A,tx=>tx.query("select answer_knowledge_verification($1,'still_true')",[q.id]));
    assert.equal((await db.query<{polarity:string}>('select polarity from knowledge_nodes where id=$1',[q.node])).rows[0].polarity,'dislike');
    assert.equal((await db.query('select * from knowledge_evidence where node_id=$1',[q.node])).rows.length,2);
    const q2=await queue('like','hobby.puzzles');
    await asUser(db,USER_A,tx=>tx.query("select answer_knowledge_verification($1,'not_anymore')",[q2.id]));
    assert.equal((await db.query<{polarity:string}>('select polarity from knowledge_nodes where id=$1',[q2.node])).rows[0].polarity,'neutral');
  });
  it('dismisses an already neutral or inactive check instead of stranding it',async()=>{
    const q=await queue('like','hobby.stale');
    await db.query("update knowledge_nodes set polarity='neutral' where id=$1",[q.node]);
    await asUser(db,USER_A,tx=>tx.query("select answer_knowledge_verification($1,'still_true')",[q.id]));
    assert.equal((await db.query<{status:string}>('select status from knowledge_verification_queue where id=$1',[q.id])).rows[0].status,'dismissed');
  });
  it('enqueues due checks on page visits, deduplicates and never touches another owner',async()=>{
    const q=await queue('like','hobby.due');
    await db.query("update knowledge_verification_queue set status='answered' where id=$1",[q.id]);
    await db.query("update knowledge_nodes set confidence=0.9,verification_due_at=now()-interval '1 day' where id=$1",[q.node]);
    await asUser(db,USER_B,tx=>tx.query('select refresh_my_verifications()'));
    assert.equal((await db.query("select * from knowledge_verification_queue where node_id=$1 and status='pending'",[q.node])).rows.length,0);
    await asUser(db,USER_A,tx=>tx.query('select refresh_my_verifications()'));await asUser(db,USER_A,tx=>tx.query('select refresh_my_verifications()'));
    assert.equal((await db.query("select * from knowledge_verification_queue where node_id=$1 and status='pending'",[q.node])).rows.length,1);
    await assert.rejects(asUser(db,USER_B,tx=>tx.query("select answer_knowledge_verification($1,'forget')",[q.id])),/Verification not found/);
  });
});
