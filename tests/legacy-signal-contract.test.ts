import {it} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTestDatabase,asUser,USER_A} from './helpers/database';

it('upgrades a hosted legacy overload without ambiguity or bypassing the guarded signal contract',async()=>{
  const db=await createTestDatabase(undefined,7);
  try{
    const definition=(await db.query<{definition:string}>(`select pg_get_functiondef('nudge_private.record_knowledge_signal(text,text,text,public.preference_polarity,text,real,text,uuid,uuid,boolean,jsonb)'::regprocedure) definition`)).rows[0].definition;
    await db.exec(definition.replace('FUNCTION nudge_private.record_knowledge_signal','FUNCTION public.record_knowledge_signal'));
    const question=(await asUser(db,USER_A,tx=>tx.query<{id:string;maps_to_key_a:string}>(`select id,maps_to_key_a from discover_next_question(null)`))).rows[0];
    assert.ok(question);
    await assert.rejects(asUser(db,USER_A,tx=>tx.query(`select answer_discover_question($1,'a')`,[question.id])),/not unique|ambiguous/i);
    assert.equal((await db.query('select * from question_answers')).rows.length,0,'failed answers must roll back');
    await db.exec(await readFile(new URL('../supabase/migrations/00008_legacy_signal_contract.sql',import.meta.url),'utf8'));
    assert.equal((await asUser(db,USER_A,tx=>tx.query<{saved:boolean}>(`select answer_discover_question($1,'a') saved`,[question.id]))).rows[0].saved,true);
    assert.equal((await asUser(db,USER_A,tx=>tx.query<{saved:boolean}>(`select answer_discover_question($1,'a') saved`,[question.id]))).rows[0].saved,false);
    assert.equal((await db.query('select * from question_answers')).rows.length,1);
    const node=(await db.query<{evidence_count:number;value:string;category_slug:string}>(`select evidence_count,value,category_slug from knowledge_nodes where user_id=$1 and key=$2`,[USER_A,question.maps_to_key_a])).rows[0];
    assert.equal(node.evidence_count,1);
    await asUser(db,USER_A,tx=>tx.query('select forget_knowledge_key($1)',[question.maps_to_key_a]));
    const replay=await asUser(db,USER_A,tx=>tx.query<{id:string|null}>(`select record_knowledge_signal($1,$2,$3,'like','explicit',0.5::real,'manual',null,null,true,'{}') id`,[question.maps_to_key_a,node.value,node.category_slug]));
    assert.equal(replay.rows[0].id,null,'legacy-shaped calls must still respect forgetting');
    await db.exec(await readFile(new URL('../sql/02_UPDATE_EXISTING.sql',import.meta.url),'utf8'));
    const verification=(await db.query<Record<string,boolean>>(await readFile(new URL('../sql/03_VERIFY_DATABASE.sql',import.meta.url),'utf8'))).rows[0];
    for(const [name,value] of Object.entries(verification))assert.equal(value,true,name);
  }finally{await db.close();}
});
