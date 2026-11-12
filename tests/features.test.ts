import { before,after,describe,it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase,asUser,USER_A,USER_B } from './helpers/database';
let db:PGlite;
before(async()=>{db=await createTestDatabase();});after(async()=>{await db?.close();});
async function generation(user=USER_A){return (await db.query<{memory_generation:number}>(`select memory_generation from public.profiles where id=$1`,[user])).rows[0].memory_generation;}
async function comparison(labels=['Sushi','Pizza']){
  const opts=labels.map((label,i)=>({label,score:0.8-i*0.05,breakdown:{preferenceMatch:0.7}}));
  const gen=await generation();
  const {rows}=await asUser(db,USER_A,tx=>tx.query<{id:string}>(`select public.create_comparison('food','Dinner','{"mood":"Relaxed"}','Enjoy dinner',$1,$2) as id`,[JSON.stringify(opts),gen]));
  const id=rows[0].id;
  const {rows:options}=await db.query<{id:string;label:string;score:number;score_breakdown:Record<string,number>}>(`select * from public.decision_options where decision_id=$1 order by rank`,[id]);
  return {id,options};
}
async function choose(id:string,option:string,label='Sushi'){
  await asUser(db,USER_A,tx=>tx.query(`select public.commit_choice_and_learn($1,$2,$3)`,[id,option,`learned.food.${label.toLowerCase()}`]));
}

describe('memory inspection and corrections',()=>{
  it("searches beyond the initial page without exposing another user's beliefs",async()=>{
    for(let i=0;i<25;i++)await db.query(`insert into public.knowledge_nodes(user_id,key,value) values($1,$2,$3)`,[USER_A,`hobby.search-${i}`,`Searchable ${i}`]);
    await db.query(`insert into public.knowledge_nodes(user_id,key,value) values($1,'hobby.foreign','Searchable private')`,[USER_B]);
    const {rows}=await asUser(db,USER_A,tx=>tx.query<{user_id:string}>(`select * from public.search_beliefs('Searchable',20)`));
    assert.equal(rows.length,5);assert.ok(rows.every(n=>n.user_id===USER_A));
  });
  it('changes a belief immediately, preserves evidence, and resists subsequent inferred reversal',async()=>{
    const {rows}=await asUser(db,USER_A,tx=>tx.query<{id:string}>(`select public.record_knowledge_signal('food.sushi','Sushi','food','like','inferred',0.5::real,'manual') as id`));
    await asUser(db,USER_A,tx=>tx.query(`select public.correct_knowledge_node($1,'dislike','Too heavy for me')`,[rows[0].id]));
    assert.equal((await db.query<{polarity:string}>(`select polarity from public.preferences where key='food.sushi' and user_id=$1`,[USER_A])).rows[0].polarity,'dislike');
    await asUser(db,USER_A,tx=>tx.query(`select public.record_knowledge_signal('learned.food.sushi','Sushi','food','like','inferred',1::real,'decision')`));
    const n=(await db.query<{polarity:string;confidence:number}>(`select polarity,confidence from public.knowledge_nodes where id=$1`,[rows[0].id])).rows[0];
    assert.equal(n.polarity,'dislike');assert.equal(n.confidence,1);
    assert.equal((await db.query(`select * from public.knowledge_evidence where node_id=$1`,[rows[0].id])).rows.length,3);
    await assert.rejects(asUser(db,USER_B,tx=>tx.query(`select public.correct_knowledge_node($1,'like','Other user')`,[rows[0].id])),/Belief not found/);
  });
  it('neutralizes an outdated manual belief without inferring its opposite',async()=>{
    const {rows:nodes}=await db.query<{id:string}>(`select id from public.knowledge_nodes where key='food.sushi' and user_id=$1`,[USER_A]);
    const {rows:q}=await db.query<{id:string}>(`insert into public.knowledge_verification_queue(user_id,node_id,prompt) values($1,$2,'Still avoiding?') returning id`,[USER_A,nodes[0].id]);
    await asUser(db,USER_A,tx=>tx.query(`select public.answer_knowledge_verification($1,'not_anymore')`,[q[0].id]));
    assert.equal((await db.query<{polarity:string}>(`select polarity from public.knowledge_nodes where id=$1`,[nodes[0].id])).rows[0].polarity,'neutral');
  });
  it('supports neutral correction and canonical forgetting without leaving a ranking projection',async()=>{
    const {rows}=await asUser(db,USER_A,tx=>tx.query<{id:string}>(`select public.record_knowledge_signal('food.tea','Tea','food','like','explicit',0.5::real,'manual') as id`));
    await asUser(db,USER_A,tx=>tx.query(`select public.correct_knowledge_node($1,'neutral','')`,[rows[0].id]));
    assert.equal((await db.query<{strength:number}>(`select strength from public.preferences where key='food.tea' and user_id=$1`,[USER_A])).rows[0].strength,0);
    await asUser(db,USER_A,tx=>tx.exec(`select public.forget_knowledge_key('food.tea')`));
    assert.equal((await db.query(`select * from public.preferences where key='food.tea' and user_id=$1`,[USER_A])).rows.length,0);
  });
  it('does not ask impossible still-true questions for a neutral belief',async()=>{
    const {rows}=await asUser(db,USER_A,tx=>tx.query<{id:string}>(`select public.record_knowledge_signal('food.water','Water','food','like','explicit',0.5::real,'manual') as id`));
    await asUser(db,USER_A,tx=>tx.query(`select public.correct_knowledge_node($1,'neutral','Indifferent')`,[rows[0].id]));
    await db.query(`update public.knowledge_nodes set confidence=0.3,verification_due_at=now()-interval '1 day' where id=$1`,[rows[0].id]);
    await db.exec('select public.enqueue_due_knowledge_verifications()');
    assert.equal((await db.query(`select * from public.knowledge_verification_queue where node_id=$1 and status='pending'`,[rows[0].id])).rows.length,0);
  });
  it('edits/deletes only the caller\'s extracted memory and invalidates old extraction jobs',async()=>{
    const old=await generation();
    await asUser(db,USER_A,tx=>tx.query(`select public.save_ai_memories('[{"kind":"goal","content":"Walk more","confidence":0.8}]',$1)`,[old]));
    const {rows}=await db.query<{id:string}>(`select id from public.ai_memories where user_id=$1`,[USER_A]);
    await assert.rejects(asUser(db,USER_B,tx=>tx.query(`select public.edit_ai_memory($1,'Foreign edit','fact')`,[rows[0].id])),/Memory not found/);
    await asUser(db,USER_A,tx=>tx.query(`select public.edit_ai_memory($1,'Walk twice weekly','habit')`,[rows[0].id]));
    assert.equal((await db.query<{content:string}>(`select content from public.ai_memories where id=$1`,[rows[0].id])).rows[0].content,'Walk twice weekly');
    assert.equal((await asUser(db,USER_A,tx=>tx.query<{count:number}>(`select public.save_ai_memories('[{"kind":"fact","content":"Stale","confidence":0.8}]',$1) as count`,[old]))).rows[0].count,0);
    await asUser(db,USER_A,tx=>tx.query(`select public.edit_ai_memory($1,'','fact',true)`,[rows[0].id]));
    assert.equal((await db.query(`select * from public.ai_memories where id=$1`,[rows[0].id])).rows.length,0);
  });
});

describe('persisted comparisons',()=>{
  it('creates all eight options atomically and allows an owner to restore all saved inputs',async()=>{
    const labels=Array.from({length:8},(_,i)=>`Choice ${i+1}`);const d=await comparison(labels);
    const {rows}=await asUser(db,USER_A,tx=>tx.query<{question:string;expected_outcome:string}>(`select question,expected_outcome from public.decisions where id=$1`,[d.id]));
    assert.equal(rows[0].question,'Dinner');assert.equal(rows[0].expected_outcome,'Enjoy dinner');assert.equal(d.options.length,8);
    assert.equal((await asUser(db,USER_B,tx=>tx.query(`select * from public.decisions where id=$1`,[d.id]))).rows.length,0);
  });
  it('rejects an invalid option list without leaving an empty comparison',async()=>{
    const before=(await db.query(`select * from public.decisions where user_id=$1`,[USER_A])).rows.length;
    const gen=await generation();
    await assert.rejects(asUser(db,USER_A,tx=>tx.query(`select public.create_comparison('food','Bad','{}',null,'[{"label":"A","score":0.7,"breakdown":{}},{"label":"a","score":0.6,"breakdown":{}}]',$1)`,[gen])),/distinct/);
    assert.equal((await db.query(`select * from public.decisions where user_id=$1`,[USER_A])).rows.length,before);
  });
  it('adds an option and saves all ranks together, with stale-tab and ownership protection',async()=>{
    const d=await comparison();const gen=await generation();
    const ranked=[{label:'Ramen',id:null,score:0.9,breakdown:{}},...d.options.map((o,i)=>({id:o.id,label:o.label,score:0.8-i*0.1,breakdown:{}}))];
    await asUser(db,USER_A,tx=>tx.query(`select public.rerank_comparison($1,0,$2,'{"confidence":"high"}',$3)`,[d.id,JSON.stringify(ranked),gen]));
    const {rows}=await db.query<{label:string;rank:number}>(`select label,rank from public.decision_options where decision_id=$1 order by rank`,[d.id]);
    assert.deepEqual(rows.map(o=>o.label),['Ramen','Sushi','Pizza']);assert.deepEqual(rows.map(o=>o.rank),[1,2,3]);
    await assert.rejects(asUser(db,USER_A,tx=>tx.query(`select public.rerank_comparison($1,0,$2,'{}',$3)`,[d.id,JSON.stringify(ranked),gen])),/another tab/);
    await assert.rejects(asUser(db,USER_B,tx=>tx.query(`select public.rerank_comparison($1,1,$2,'{}',0)`,[d.id,JSON.stringify(ranked)])),/no longer open/);
    await choose(d.id,d.options[0].id);
    await assert.rejects(asUser(db,USER_A,tx=>tx.query(`select public.rerank_comparison($1,1,$2,'{}',$3)`,[d.id,JSON.stringify(ranked),gen])),/no longer open/);
  });
  it('rejects scoring from an older memory generation',async()=>{
    const d=await comparison();const old=await generation();
    const node=(await db.query<{id:string}>(`select id from public.knowledge_nodes where key='food.sushi' and user_id=$1`,[USER_A])).rows[0];
    await asUser(db,USER_A,tx=>tx.query(`select public.correct_knowledge_node($1,'like','Changed')`,[node.id]));
    await assert.rejects(asUser(db,USER_A,tx=>tx.query(`select public.rerank_comparison($1,0,$2,'{}',$3)`,[d.id,JSON.stringify(d.options.map(o=>({id:o.id,label:o.label,score:o.score,breakdown:o.score_breakdown}))),old])),/memory changed/);
  });
});

describe('outcome check-ins',()=>{
  it('defaults to 24 hours, supports future custom time, and deduplicates a scheduled prompt',async()=>{
    const d=await comparison();await choose(d.id,d.options[0].id);
    const state=(await db.query<{hours:number}>(`select extract(epoch from(reflection_due_at-decided_at))/3600 as hours from public.decisions where id=$1`,[d.id])).rows[0];assert.equal(Number(state.hours),24);
    const due=new Date(Date.now()+7*86400000).toISOString();
    await asUser(db,USER_A,tx=>tx.query(`select public.schedule_reflection($1,$2,true)`,[d.id,due]));
    assert.equal((await db.query<{due:string}>(`select reflection_due_at::text as due from public.decisions where id=$1`,[d.id])).rows.length,1);
    await db.query(`update public.decisions set reflection_due_at=now()-interval '1 minute' where id=$1`,[d.id]);
    await db.exec('select public.enqueue_due_reflection_prompts();select public.enqueue_due_reflection_prompts();');
    assert.equal((await db.query(`select * from public.notifications where payload->>'decision_id'=$1`,[d.id])).rows.length,1);
    await assert.rejects(asUser(db,USER_B,tx=>tx.query(`select public.schedule_reflection($1,$2,true)`,[d.id,due])),/not waiting/);
  });
  it('snoozes once, turns reminders off, and closes them when reflected',async()=>{
    const d=await comparison();await choose(d.id,d.options[0].id);
    await db.query(`update public.decisions set reflection_due_at=now()-interval '1 minute' where id=$1`,[d.id]);await db.exec('select public.enqueue_due_reflection_prompts()');
    await asUser(db,USER_A,tx=>tx.query(`select public.schedule_reflection($1,$2,true)`,[d.id,new Date(Date.now()+86400000).toISOString()]));
    assert.equal((await db.query(`select * from public.notifications where payload->>'decision_id'=$1 and read_at is null`,[d.id])).rows.length,0);
    await asUser(db,USER_A,tx=>tx.query(`select public.schedule_reflection($1,null,false)`,[d.id]));
    await db.exec('select public.enqueue_due_reflection_prompts()');
    assert.equal((await db.query(`select * from public.notifications where payload->>'decision_id'=$1`,[d.id])).rows.length,1);
    await asUser(db,USER_A,tx=>tx.query(`select public.submit_decision_reflection($1,4,true,false,null,true,null,'learned.food.sushi')`,[d.id]));
    await assert.rejects(asUser(db,USER_A,tx=>tx.query(`select public.schedule_reflection($1,$2,true)`,[d.id,new Date(Date.now()+86400000).toISOString()])),/not waiting/);
  });
  it('disables retained-history reminders on reset and allows explicit rescheduling',async()=>{
    const d=await comparison();await choose(d.id,d.options[0].id);
    await asUser(db,USER_A,tx=>tx.exec('select public.erase_learned_memory()'));
    assert.equal((await db.query<{reminder_enabled:boolean}>(`select reminder_enabled from public.decisions where id=$1`,[d.id])).rows[0].reminder_enabled,false);
    await asUser(db,USER_A,tx=>tx.query(`select public.schedule_reflection($1,$2,true)`,[d.id,new Date(Date.now()+86400000).toISOString()]));
    await db.query(`update public.decisions set reflection_due_at=now()-interval '1 minute' where id=$1`,[d.id]);await db.exec('select public.enqueue_due_reflection_prompts()');
    assert.equal((await db.query(`select * from public.notifications where payload->>'decision_id'=$1 and read_at is null`,[d.id])).rows.length,1);
  });
});
