import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, asUser, USER_A, USER_B } from './helpers/database';
import type { PGlite } from '@electric-sql/pglite';

let db: PGlite;
before(async () => { db = await createTestDatabase(); });
after(async () => { await db?.close(); });
const record = (key: string, polarity = 'like') => asUser(db, USER_A, tx => tx.query<Record<string, unknown>>(
  `select public.record_knowledge_signal($1,'Sushi','food',$2::public.preference_polarity,'explicit',0.5::real,'manual') as id`, [key,polarity]));

describe('database privacy boundaries', () => {
  it('restricts global jobs and internal/trigger functions to trusted roles', async () => {
    for (const role of ['anon','authenticated']) {
      for (const fn of ['refill_streak_freezes()', 'enqueue_due_reflection_prompts()', 'apply_knowledge_confidence_decay()', 'enqueue_due_knowledge_verifications()', 'project_knowledge_node_to_preference()']) {
        const { rows } = await db.query<{ allowed: boolean }>(`select has_function_privilege($1,$2,'execute') as allowed`,[role,'public.'+fn]);
        assert.equal(rows[0].allowed,false, `${role} can execute ${fn}`);
      }
    }
    await assert.rejects(db.transaction(async tx => { await tx.exec('set local role anon'); await tx.exec('select public.refill_streak_freezes()'); }), /permission denied/);
    const { rows } = await db.query<{ allowed: boolean }>(`select has_function_privilege('service_role','public.refill_streak_freezes()','execute') as allowed`);
    assert.equal(rows[0].allowed,true);
  });

  it('rejects foreign decision provenance even through a definer RPC', async () => {
    const { rows } = await db.query<{ id: string }>(`insert into public.decisions(user_id,question) values($1,'Private') returning id`, [USER_B]);
    await assert.rejects(asUser(db,USER_A,tx=>tx.query<Record<string, unknown>>(`select public.record_knowledge_signal('food.foreign','X','food','like','inferred',0.2::real,'decision',$1)`,[rows[0].id])), /Invalid source decision/);
    await assert.rejects(asUser(db,USER_A,tx=>tx.query<Record<string, unknown>>(`insert into public.decision_reflections(user_id,decision_id,rating) values($1,$2,5)`,[USER_A,rows[0].id])),/permission denied/);
    await assert.rejects(db.query<Record<string, unknown>>(`insert into public.decision_reflections(user_id,decision_id,rating) values($1,$2,5)`,[USER_A,rows[0].id]),/Invalid decision owner/);
  });

  it('prevents direct edits of canonical graph, derived profile counters and achievements', async () => {
    await assert.rejects(asUser(db,USER_A,tx=>tx.query<Record<string, unknown>>(`update public.profiles set memory_generation=100 where id=$1`,[USER_A])),/permission denied/);
    await assert.rejects(asUser(db,USER_A,tx=>tx.query<Record<string, unknown>>(`insert into public.knowledge_nodes(user_id,key) values($1,'food.fake')`,[USER_A])),/permission denied/);
    await assert.rejects(asUser(db,USER_A,tx=>tx.query<Record<string, unknown>>(`insert into public.user_achievements(user_id,achievement_slug) values($1,'month-streak')`,[USER_A])),/permission denied/);
  });

  it('keeps a forgotten preference suppressed through later evidence and decay', async () => {
    await record('learned.suppressed');
    await asUser(db,USER_A,tx=>tx.exec(`select public.forget_knowledge_key('learned.suppressed')`));
    const result=await record('learned.food.suppressed');
    assert.equal(result.rows[0].id,null); // same label in a new namespaced key
    await db.exec(`select public.apply_knowledge_confidence_decay()`);
    assert.equal((await db.query<Record<string, unknown>>(`select * from public.preferences where user_id='${USER_A}' and value='Sushi'`)).rows.length,0);
  });

  it('erases the canonical graph and rejects pre-reset asynchronous writes', async () => {
    await asUser(db,USER_A,tx=>tx.exec(`select public.erase_learned_memory()`));
    const { rows: state } = await db.query<{ memory_generation: number }>(`select memory_generation from public.profiles where id=$1`,[USER_A]);
    await record('food.erase');
    await asUser(db,USER_A,tx=>tx.exec(`select public.erase_learned_memory()`));
    const { rows: delayed }=await asUser(db,USER_A,tx=>tx.query<Record<string, unknown>>(`select public.record_knowledge_signal('food.delayed','Late','food','like','ai_extracted',0.6::real,'ai_extraction',null,null,false,'{}',$1) as id`,[state[0].memory_generation]));
    assert.equal(delayed[0].id,null);
    await assert.rejects(asUser(db,USER_A,tx=>tx.exec(`select public.record_knowledge_signal('food.unguarded','Late','food','like','ai_extracted',0.6::real,'ai_extraction')`)),/requires a memory generation/);
    const { rows: ai }=await asUser(db,USER_A,tx=>tx.query<Record<string, unknown>>(`select public.save_ai_memories('[{"kind":"fact","content":"Late","confidence":0.8}]',$1) as count`,[state[0].memory_generation]));
    assert.equal(ai[0].count,0);
    for(const table of ['knowledge_nodes','knowledge_edges','knowledge_evidence','knowledge_verification_queue','preferences','ai_memories','question_answers']) {
      assert.equal((await db.query<Record<string, unknown>>(`select * from public.${table} where user_id=$1`,[USER_A])).rows.length,0,table);
    }
  });
});

describe('atomic learning', () => {
  async function decision(label='Ramen') {
    const {rows}=await asUser(db,USER_A,async tx=>{
      const {rows:state}=await tx.query<{memory_generation:number}>(`select memory_generation from public.profiles where id=$1`,[USER_A]);
      return tx.query<{id:string}>(`select public.create_comparison('food','Dinner','{}',null,$1,$2) as id`,[JSON.stringify([{label,score:0.6,breakdown:{}},{label:'Alternative',score:0.5,breakdown:{}}]),state[0].memory_generation]);
    });
    const id=rows[0].id;
    const {rows:options}=await asUser(db,USER_A,tx=>tx.query<{id:string}>(`select id from public.decision_options where decision_id=$1 and label=$2`,[id,label]));
    await asUser(db,USER_A,tx=>tx.query<Record<string, unknown>>(`select public.commit_choice_and_learn($1,$2,$3)`,[id,options[0].id,`learned.food.${label.toLowerCase()}`]));
    return {id,option:options[0].id,key:`learned.food.${label.toLowerCase()}`};
  }
  it('commits a choice and learns once on identical retry',async()=>{
    const d=await decision();
    await asUser(db,USER_A,tx=>tx.query<Record<string, unknown>>(`select public.commit_choice_and_learn($1,$2,$3)`,[d.id,d.option,d.key]));
    assert.equal((await db.query<Record<string, unknown>>(`select * from public.knowledge_evidence where source_decision_id=$1 and kind='decision'`,[d.id])).rows.length,1);
  });
  it('saves a reflection and its evidence once, and rejects conflicting retries',async()=>{
    const d=await decision('Pasta');
    const save=(rating=5)=>asUser(db,USER_A,tx=>tx.query<{saved:boolean}>(`select * from public.submit_decision_reflection($1,$2,true,false,true,true,'Great',$3)`,[d.id,rating,d.key]));
    assert.equal((await save()).rows[0].saved,true);
    assert.equal((await save()).rows[0].saved,false);
    await assert.rejects(save(1),/already has a reflection/);
    assert.equal((await db.query<Record<string, unknown>>(`select * from public.knowledge_evidence where source_decision_id=$1 and kind='reflection'`,[d.id])).rows.length,1);
    assert.equal((await db.query<Record<string, unknown>>(`select status from public.decisions where id=$1`,[d.id])).rows[0].status,'reflected');
  });
  it('neutral feedback does not append a positive reflection signal',async()=>{
    const d=await decision('Salad');
    await asUser(db,USER_A,tx=>tx.query<Record<string, unknown>>(`select * from public.submit_decision_reflection($1,3,null,null,null,null,null,$2)`,[d.id,d.key]));
    assert.equal((await db.query<Record<string, unknown>>(`select * from public.knowledge_evidence where source_decision_id=$1 and kind='reflection'`,[d.id])).rows.length,0);
  });
  it('rolls back a reflection if its learning write fails',async()=>{
    const d=await decision('Soup');
    await assert.rejects(asUser(db,USER_A,tx=>tx.query<Record<string, unknown>>(`select * from public.submit_decision_reflection($1,5,true,false,true,true,null,'learned.food.INVALID')`,[d.id])),/Invalid knowledge key/);
    assert.equal((await db.query<Record<string, unknown>>(`select * from public.decision_reflections where decision_id=$1`,[d.id])).rows.length,0);
    assert.equal((await db.query<Record<string, unknown>>(`select status from public.decisions where id=$1`,[d.id])).rows[0].status,'decided');
  });
  it('confirms an avoidance without reversing its polarity, once per check',async()=>{
    const id=(await record('food.avoid','dislike')).rows[0].id;
    const { rows }=await db.query<{id:string}>(`insert into public.knowledge_verification_queue(user_id,node_id,prompt) values($1,$2,'Avoid Sushi?') returning id`,[USER_A,id]);
    await asUser(db,USER_A,tx=>tx.query<Record<string, unknown>>(`select public.answer_knowledge_verification($1,'still_true')`,[rows[0].id]));
    await asUser(db,USER_A,tx=>tx.query<Record<string, unknown>>(`select public.answer_knowledge_verification($1,'still_true')`,[rows[0].id]));
    assert.equal((await db.query<Record<string, unknown>>(`select polarity,evidence_count from public.knowledge_nodes where id=$1`,[id])).rows[0].polarity,'dislike');
    assert.equal((await db.query<Record<string, unknown>>(`select * from public.knowledge_evidence where node_id=$1`,[id])).rows.length,2);
  });
  it('timestamps a post-reset choice after the reset even in an older transaction',async()=>{
    await asUser(db,USER_A,async tx=>{
      await tx.exec('select public.erase_learned_memory()');
      const {rows:state}=await tx.query<{memory_generation:number}>(`select memory_generation from public.profiles where id=$1`,[USER_A]);
      const {rows:decisions}=await tx.query<{id:string}>(`select public.create_comparison('food','After reset','{}',null,'[{"label":"Fresh","score":0.6,"breakdown":{}},{"label":"Other","score":0.5,"breakdown":{}}]',$1) as id`,[state[0].memory_generation]);
      const {rows:options}=await tx.query<{id:string}>(`select id from public.decision_options where decision_id=$1 and label='Fresh'`,[decisions[0].id]);
      await tx.query(`select public.commit_choice_and_learn($1,$2,'learned.food.fresh')`,[decisions[0].id,options[0].id]);
      const {rows}=await tx.query<{eligible:boolean}>(`select d.decided_at>p.memory_reset_at as eligible from public.decisions d join public.profiles p on p.id=d.user_id where d.id=$1`,[decisions[0].id]);
      assert.equal(rows[0].eligible,true);
    });
  });
  it('records a question answer once without asserting dislike of the other side',async()=>{
    const { rows }=await db.query<{id:string,maps_to_key_b:string}>(`select id,maps_to_key_b from public.questions where maps_to_key_a='cuisine.italian' limit 1`);
    assert.ok(rows.length);
    for(let i=0;i<2;i++) await asUser(db,USER_A,tx=>tx.query<Record<string, unknown>>(`select public.answer_discover_question($1,'a')`,[rows[0].id]));
    assert.equal((await db.query<Record<string, unknown>>(`select * from public.knowledge_evidence where source_question_id=$1`,[rows[0].id])).rows.length,1);
  });
  it('validates onboarding keys on the server and rolls back an invalid batch',async()=>{
    await db.exec(`update public.profiles set onboarded_at=null where id='${USER_B}'`);
    const {rows}=await db.query<{id:string}>(`select id from public.questions where is_onboarding limit 1`);
    const answers=JSON.stringify([{questionId:rows[0].id,answer:'a',prefKey:'food.forged'},{questionId:'ffffffff-ffff-4fff-8fff-ffffffffffff',answer:'a'}]);
    await assert.rejects(asUser(db,USER_B,tx=>tx.query<Record<string, unknown>>(`select public.complete_onboarding('{"fullName":"Test","age":"16"}',$1,0)`,[answers])),/Invalid onboarding question/);
    assert.equal((await db.query<Record<string, unknown>>(`select * from public.question_answers where user_id=$1`,[USER_B])).rows.length,0);
    assert.equal((await db.query<Record<string, unknown>>(`select onboarded_at from public.profiles where id=$1`,[USER_B])).rows[0].onboarded_at,null);
  });
});


describe('circle vote privacy',()=>{
  it('returns aggregate totals while hiding other voters from members and outsiders',async()=>{
    const {rows:groups}=await db.query<{id:string}>(`insert into public.decision_groups(owner_id,name) values($1,'Dinner group') returning id`,[USER_A]);
    const group=groups[0].id;
    await db.query(`insert into public.decision_group_members(group_id,user_id,role) values($1,$2,'owner'),($1,$3,'member')`,[group,USER_A,USER_B]);
    const {rows:polls}=await db.query<{id:string}>(`insert into public.group_polls(group_id,created_by,question) values($1,$2,'Dinner?') returning id`,[group,USER_A]);
    const poll=polls[0].id;
    const {rows:options}=await db.query<{id:string}>(`insert into public.group_poll_options(poll_id,label) values($1,'Sushi'),($1,'Pizza') returning id`,[poll]);
    for(const user of [USER_A,USER_B]) await asUser(db,user,tx=>tx.query(`select public.cast_circle_vote($1,$2)`,[poll,options[0].id]));
    const {rows:visible}=await asUser(db,USER_B,tx=>tx.query<{user_id:string}>(`select * from public.group_poll_votes where poll_id=$1`,[poll]));
    assert.equal(visible.length,1);assert.equal(visible[0].user_id,USER_B);
    const {rows:counts}=await asUser(db,USER_B,tx=>tx.query<{votes:number}>(`select * from public.circle_vote_counts($1)`,[group]));
    assert.equal(counts.reduce((sum,r)=>sum+Number(r.votes),0),2);
    assert.ok(counts.every(r=>!('user_id' in r)));
    await db.query(`delete from public.decision_group_members where group_id=$1 and user_id=$2`,[group,USER_B]);
    assert.equal((await asUser(db,USER_B,tx=>tx.query(`select * from public.circle_vote_counts($1)`,[group]))).rows.length,0);
  });
  it('blocks foreign node links even under service-level table access',async()=>{
    const {rows:nodes}=await db.query<{id:string}>(`insert into public.knowledge_nodes(user_id,key) values($1,'food.owner-a'),($2,'food.owner-b') returning id`,[USER_A,USER_B]);
    await assert.rejects(db.query(`insert into public.knowledge_edges(user_id,from_node_id,to_node_id,relation) values($1,$2,$3,'supports')`,[USER_A,nodes[0].id,nodes[1].id]),/Invalid knowledge edge owner/);
  });
});


it('upgrades existing learned nodes and forgotten state without losing evidence',async()=>{
  const upgrade=await createTestDatabase(async legacy=>{
    await legacy.query("select set_config('request.jwt.claim.sub',$1,false)",[USER_A]);
    await legacy.exec(`select public.record_knowledge_signal('learned.legacy','Legacy choice','food','like','reflected',0.6::real,'manual');
      select public.record_knowledge_signal('food.old-forgotten','Old','food','like','explicit',0.5::real,'manual');
      select public.forget_knowledge_key('food.old-forgotten');`);
  });
  try {
    const {rows}=await upgrade.query<{slug:string}>(`select c.slug from public.preferences p join public.preference_categories c on c.id=p.category_id where p.key='learned.legacy'`);
    assert.equal(rows[0].slug,'food');
    assert.equal((await upgrade.query(`select * from public.knowledge_evidence where user_id=$1`,[USER_A])).rows.length,2);
    assert.equal((await upgrade.query(`select * from public.forgotten_knowledge_keys where user_id=$1 and key='food.old-forgotten'`,[USER_A])).rows.length,1);
  } finally { await upgrade.close(); }
});
