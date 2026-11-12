import {before,after,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase,asUser,USER_A,USER_B} from './helpers/database';

describe('private comparison evidence and explicit saved settings',()=>{
  let db:PGlite;
  const category='hobbies';
  const weights={preferenceMatch:.55,historySuccess:.3,novelty:.15};
  const options=[{label:'Mining',score:.411111111,breakdown:{preferenceMatch:.5,historySuccess:.5,novelty:.2}},
    {label:'Woodcutting',score:.6,breakdown:{preferenceMatch:.7,historySuccess:.4,novelty:.3}}];
  before(async()=>{
    db=await createTestDatabase();
    await db.exec(await readFile(new URL('../supabase/migrations/00010_ai_usage_ledger.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/00011_comparison_evidence_and_settings.sql',import.meta.url),'utf8'));
  });
  after(async()=>{await db?.close();});
  async function generation(user=USER_A){return (await db.query<{generation:number}>('select memory_generation generation from public.profiles where id=$1',[user])).rows[0].generation;}
  function fixture(){
    const run=randomUUID(),at='2026-10-24T12:00:00.000Z';
    const config={category,version:1,weights:{...weights}};
    const context={domain:'test world v1',meaningConfirmed:true,goal:'Test materials',scoring_run_id:run,scored_at:at,
      confidence:'medium',cold_start:false,evidence_state:'personal_fit',engine_config:config,engine_version:2};
    const evidence={version:1,scoringRunId:run,scoredAt:at,basis:'journal',engineVersion:2,engineConfig:config,
      confidence:'medium',coldStart:false,evidenceState:'personal_fit',options:options.map(o=>({...o,breakdown:{...o.breakdown},reasons:['Recorded relative fit.'],warning:false,
        sourceCounts:{preferences:0,decisions:0,reflections:0},sourceIds:{preferenceIds:[] as string[],decisionIds:[] as string[]}}))};
    return {request:randomUUID(),context,evidence};
  }
  async function create(f=fixture(),user=USER_A,captured?:number){
    const g=captured??await generation(user);
    const id=(await asUser(db,user,tx=>tx.query<{id:string}>(`select public.create_comparison_with_evidence($1,$2::jsonb,'hobbies','Gather materials',$3::jsonb,null,$4::jsonb,$5,$6::jsonb) id`,
      [f.request,JSON.stringify({options:options.map(o=>o.label)}),JSON.stringify(f.context),JSON.stringify(options),g,JSON.stringify(f.evidence)]))).rows[0].id;
    return {id,f,g};
  }
  async function read(id:string,user=USER_A){return (await asUser(db,user,tx=>tx.query<{decision_id:string;comparison_revision:number;scoring_run_id:string;memory_generation:number;snapshot:ReturnType<typeof fixture>['evidence']}>('select * from public.read_my_comparison_evidence($1)',[id]))).rows;}
  async function saveSetting(name:string,domain='test world v1',aliases:unknown=[{term:'mine',meaning:'The mining action in this world'}],user=USER_A,captured?:number,id:string|null=null){
    return (await asUser(db,user,tx=>tx.query<{id:string}>(`select public.save_comparison_setting($1,$2,$3,'hobbies','Gather materials',$4::jsonb,$5) id`,
      [id,name,domain,JSON.stringify(aliases),captured??0]))).rows[0].id;
  }

  it('denies anonymous RPCs, direct structural writes and cross-owner reads',async()=>{
    for(const signature of ['public.create_comparison_with_evidence(uuid,jsonb,public.decision_category,text,jsonb,text,jsonb,integer,jsonb)',
      'public.rerank_comparison_with_evidence(uuid,integer,jsonb,jsonb,integer,jsonb)','public.read_my_comparison_evidence(uuid)',
      'public.export_my_comparison_evidence(integer)','public.list_comparison_settings()','public.read_my_comparison_setting(uuid)',
      'public.get_comparison_settings_state()','public.save_comparison_setting(uuid,text,text,public.decision_category,text,jsonb,integer)','public.delete_comparison_setting(uuid,integer)']){
      assert.deepEqual((await db.query(`select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') owner`,[signature])).rows[0],{anon:false,owner:true});
    }
    for(const table of ['nudge_private.comparison_evidence','nudge_private.comparison_settings']){
      assert.deepEqual((await db.query(`select relrowsecurity rls,has_table_privilege('authenticated',oid,'select') readable,
        has_table_privilege('authenticated',oid,'insert,update,delete') writable,has_table_privilege('service_role',oid,'insert,update,delete') service_writable from pg_class where oid=$1::regclass`,[table])).rows[0],
      {rls:true,readable:false,writable:false,service_writable:false});
    }
    const c=await create();assert.deepEqual(await read(c.id,USER_B),[]);
    await assert.rejects(asUser(db,USER_A,tx=>tx.exec('select * from nudge_private.comparison_evidence')),/permission denied/);
    await assert.rejects(asUser(db,USER_A,tx=>tx.exec(`select nudge_private.validate_comparison_evidence('{}',gen_random_uuid(),0)`)),/permission denied/);
    await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');await tx.exec('select public.get_comparison_settings_state()');}),/permission denied/);
  });

  it('commits exact evidence atomically and preserves the original snapshot on transport retry',async()=>{
    const c=await create();const first=await read(c.id);
    assert.equal(first.length,1);assert.equal(first[0].comparison_revision,0);
    assert.deepEqual(first[0].snapshot,c.f.evidence);assert.equal(first[0].scoring_run_id,c.f.context.scoring_run_id);
    assert.equal(first[0].memory_generation,c.g);
    assert.equal(Math.fround((await db.query<{score:number}>('select score from decision_options where decision_id=$1 and rank=1',[c.id])).rows[0].score),Math.fround(options[0].score));
    const retry=fixture();retry.request=c.f.request;
    assert.equal((await create(retry)).id,c.id);assert.deepEqual(await read(c.id),first);
    await assert.rejects(asUser(db,USER_A,tx=>tx.query(`select public.create_comparison_with_evidence($1,'{"options":["different"]}','hobbies','Title',$2::jsonb,null,$3::jsonb,$4,$5::jsonb)`,
      [c.f.request,JSON.stringify(c.f.context),JSON.stringify(options),c.g,JSON.stringify(c.f.evidence)])),/different options/);
    const before=(await db.query('select count(*) count from decisions')).rows;
    const invalid=fixture();invalid.evidence.scoringRunId=randomUUID();
    await assert.rejects(create(invalid),/does not match/);
    assert.deepEqual((await db.query('select count(*) count from decisions')).rows,before,'invalid evidence rolls back the comparison request and journal insert');
  });

  it('rejects raw fields, oversized reasons, mismatched options and foreign source identities',async()=>{
    for(const change of [
      (f:ReturnType<typeof fixture>)=>Object.assign(f.evidence,{notes:'Raw private note'}),
      (f:ReturnType<typeof fixture>)=>{f.evidence.options[0].reasons=['x'.repeat(501)];},
      (f:ReturnType<typeof fixture>)=>{f.evidence.options[0].score=.9;},
      (f:ReturnType<typeof fixture>)=>{f.evidence.options[0].breakdown.preferenceMatch=.9;},
      (f:ReturnType<typeof fixture>)=>{f.evidence.options[0].sourceIds.decisionIds=[randomUUID()];f.evidence.options[0].sourceCounts.decisions=1;},
      (f:ReturnType<typeof fixture>)=>{Object.assign(f.evidence.options[0].sourceCounts,{rawNotes:'No'});},
      (f:ReturnType<typeof fixture>)=>{f.evidence.engineConfig.weights.novelty=2;},
    ]){
      const f=fixture();change(f);await assert.rejects(create(f),/Invalid|does not match|do not match/);
    }
    const foreign=await create(fixture(),USER_B);const f=fixture();f.evidence.options[0].sourceIds.decisionIds=[foreign.id];f.evidence.options[0].sourceCounts.decisions=1;
    await assert.rejects(create(f),/source owner/);
  });

  it('keeps each revision immutable and validates rerank retries without duplicating evidence',async()=>{
    const c=await create();const next=fixture();
    const saved=(await db.query<{id:string;label:string}>('select id,label from decision_options where decision_id=$1 order by rank',[c.id])).rows;
    const reranked=options.map((o,i)=>({...o,id:saved[i].id}));
    const rerank=(revision=0,f=next)=>asUser(db,USER_A,tx=>tx.query('select public.rerank_comparison_with_evidence($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb)',
      [c.id,revision,JSON.stringify(reranked),JSON.stringify(f.context),c.g,JSON.stringify(f.evidence)]));
    await rerank();await rerank();
    const revisions=await read(c.id);assert.deepEqual(revisions.map(r=>r.comparison_revision),[0,1]);
    assert.deepEqual(revisions[0].snapshot,c.f.evidence);assert.deepEqual(revisions[1].snapshot,next.evidence);
    await assert.rejects(rerank(0,fixture()),/changed/);
    const otherGeneration=await generation(USER_B);
    await assert.rejects(asUser(db,USER_B,tx=>tx.query('select public.rerank_comparison_with_evidence($1,1,$2::jsonb,$3::jsonb,$4,$5::jsonb)',
      [c.id,JSON.stringify(reranked),JSON.stringify(next.context),otherGeneration,JSON.stringify(next.evidence)])),/not found/);
    const bad=fixture();bad.evidence.options[0].score=.9;await assert.rejects(rerank(1,bad),/do not match/);
    assert.equal((await db.query<{revision:number}>('select comparison_revision revision from decisions where id=$1',[c.id])).rows[0].revision,1);
    assert.equal((await read(c.id)).length,2);
  });

  it('accepts bounded criteria evidence with no personal sources and rejects mixed provenance',async()=>{
    const f=fixture();const g=await generation();
    const criterionOptions=options.map((o,i)=>({label:o.label,score:i===0?.7:.3,breakdown:{criteriaLow:i===0?.7:.3,criteriaHigh:i===0?.8:.4,coverage:1}}));
    const context={...f.context,comparisonBasis:'criteria'};
    const evidence={...f.evidence,basis:'criteria',options:criterionOptions.map(o=>({...o,reasons:['Confirmed criterion range.'],warning:false,
      sourceCounts:{preferences:0,decisions:0,reflections:0},sourceIds:{preferenceIds:[],decisionIds:[]}}))};
    const attempt=(snapshot:unknown,request=randomUUID())=>asUser(db,USER_A,tx=>tx.query<{id:string}>(`select create_comparison_with_evidence($1,'{"basis":"criteria"}','hobbies','Criteria evidence',$2::jsonb,null,$3::jsonb,$4,$5::jsonb) id`,
      [request,JSON.stringify(context),JSON.stringify(criterionOptions),g,JSON.stringify(snapshot)]));
    const id=(await attempt(evidence)).rows[0].id;assert.equal((await read(id))[0].snapshot.basis,'criteria');
    const invalid=structuredClone(evidence);invalid.scoringRunId=randomUUID();
    await assert.rejects(attempt({...invalid,scoringRunId:f.evidence.scoringRunId,options:invalid.options.map(o=>({...o,warning:true}))}),/cannot use personal sources/);
  });

  it('retains legacy comparisons without inventing an evidence snapshot on later retries',async()=>{
    const f=fixture(),g=await generation();
    const id=(await asUser(db,USER_A,tx=>tx.query<{id:string}>(`select create_comparison_once($1,$2::jsonb,'hobbies','Legacy comparison',$3::jsonb,null,$4::jsonb,$5) id`,
      [f.request,JSON.stringify({options:options.map(o=>o.label)}),JSON.stringify(f.context),JSON.stringify(options),g]))).rows[0].id;
    assert.equal((await create(f)).id,id);assert.deepEqual(await read(id),[]);
  });

  it('saves only explicit aliases in their normalized setting with owner checks and bounded input',async()=>{
    const g=await generation();const id=await saveSetting('Materials','  Test  World V1 ',[{term:'  Mine  Stone ',meaning:'  The local action  '}],USER_A,g);
    const state=(await asUser(db,USER_A,tx=>tx.query<{state:{generation:number;settings:{id:string;domain:string;aliases:unknown}[]}}>('select get_comparison_settings_state() state'))).rows[0].state;
    const setting=state.settings.find(s=>s.id===id)!;assert.equal(state.generation,g);assert.equal(setting.domain,'test world v1');
    assert.deepEqual(setting.aliases,[{term:'Mine Stone',meaning:'The local action'}]);
    assert.equal((await asUser(db,USER_B,tx=>tx.query('select * from read_my_comparison_setting($1)',[id]))).rows.length,0);
    await assert.rejects(saveSetting('Foreign edit','test world v1',[],USER_B,await generation(USER_B),id),/no longer exists/);
    await asUser(db,USER_B,tx=>tx.query('select delete_comparison_setting($1,$2)',[id,0]));
    assert.equal((await asUser(db,USER_A,tx=>tx.query('select * from read_my_comparison_setting($1)',[id]))).rows.length,1);
    const other=await saveSetting('Materials','another world',[],USER_A,g);assert.notEqual(other,id);
    await assert.rejects(saveSetting('materials','test world v1',[],USER_A,g),/duplicate key/);
    for(const aliases of [[{term:'Mine',meaning:'a'},{term:' mine ',meaning:'b'}],Array.from({length:13},(_,i)=>({term:String(i),meaning:'a'})),
      [{term:'a',meaning:'x'.repeat(501)}],[{term:'a',meaning:'x',notes:'private'}]])await assert.rejects(saveSetting(randomUUID(),'test world v1',aliases,USER_A,g),/distinct|Invalid/);
    await assert.rejects(saveSetting('x'.repeat(81),'test world v1',[],USER_A,g),/Invalid/);
    await asUser(db,USER_A,tx=>tx.query('select delete_comparison_setting($1,$2)',[other,g]));
  });

  it('serializes the twenty-setting cap per owner while retaining independent settings in each domain',async()=>{
    await db.exec('delete from nudge_private.comparison_settings');const g=await generation();
    for(let i=0;i<20;i++)await saveSetting('Preset '+i,'world '+i,[],USER_A,g);
    await assert.rejects(saveSetting('Preset 21','another world',[],USER_A,g),/up to 20/);
    assert.equal((await asUser(db,USER_A,tx=>tx.query('select * from list_comparison_settings()'))).rows.length,20);
    assert.ok(await saveSetting('Independent','other',[],USER_B,await generation(USER_B)));
  });

  it('purges derived snapshots and settings at every privacy generation change and rejects stale resurrection',async()=>{
    await db.query("update profiles set terms_version='2026-10-12',ai_enabled=true where id=$1",[USER_A]);
    for(const operation of ['forget','correct','erase','ai_withdrawal']){
      await db.exec('delete from nudge_private.comparison_settings');
      const c=await create();const id=await saveSetting('Before '+operation,'test world v1',[],USER_A,c.g);
      const node=(await asUser(db,USER_A,tx=>tx.query<{id:string}>(`select record_knowledge_signal($1,$2,'hobbies','like','explicit',0.5::real,'manual') id`,['hobby.privacy.'+operation,'Synthetic preference '+operation]))).rows[0].id;
      if(operation==='forget')await asUser(db,USER_A,tx=>tx.query('select forget_knowledge_key($1)',['hobby.privacy.'+operation]));
      if(operation==='correct')await asUser(db,USER_A,tx=>tx.query("select correct_knowledge_node($1,'dislike','')",[node]));
      if(operation==='erase')await asUser(db,USER_A,tx=>tx.exec('select erase_learned_memory()'));
      if(operation==='ai_withdrawal')await asUser(db,USER_A,tx=>tx.exec('select set_ai_enabled(false)'));
      assert.ok(await generation()>c.g,operation);assert.deepEqual(await read(c.id),[]);
      const state=(await asUser(db,USER_A,tx=>tx.query<{state:{settings:unknown[]}}> ('select get_comparison_settings_state() state'))).rows[0].state;
      assert.deepEqual(state.settings,[]);assert.equal((await db.query('select id from decisions where id=$1',[c.id])).rows.length,1,'journal retained');
      await assert.rejects(saveSetting('Stale async create','test world v1',[],USER_A,c.g),/memory changed/);
      await assert.rejects(saveSetting('Stale async edit','test world v1',[],USER_A,c.g,id),/memory changed/);
      assert.equal((await create(c.f,USER_A,c.g)).id,c.id,'transport retry still returns its original journal entry');
      assert.deepEqual(await read(c.id),[],'transport retry never recreates purged evidence');
    }
  });

  it('exports evidence in stable pages and cascades owner or journal deletion',async()=>{
    const c=await create();
    await db.query(`with added as (insert into public.decisions(user_id,question) select $1,'Pagination fixture '||i from generate_series(1,105) i returning id)
      insert into nudge_private.comparison_evidence(user_id,decision_id,comparison_revision,scoring_run_id,memory_generation,snapshot)
      select $1,id,0,gen_random_uuid(),$2,$3::jsonb from added`,[USER_A,c.g,JSON.stringify(c.f.evidence)]);
    const page=async(offset:number)=>(await asUser(db,USER_A,tx=>tx.query<{decision_id:string}>('select * from export_my_comparison_evidence($1)',[offset]))).rows;
    const first=await page(0),second=await page(100);assert.equal(first.length,100);assert.ok(second.length>=6);
    assert.deepEqual(await page(0),first);assert.ok(first.every(a=>second.every(b=>a.decision_id!==b.decision_id)));
    await db.query('delete from public.decisions where id=$1',[c.id]);assert.deepEqual(await read(c.id),[]);
    const foreign=await create(fixture(),USER_B);await saveSetting('To delete','other',[],USER_B,await generation(USER_B));
    await db.query('delete from auth.users where id=$1',[USER_B]);
    assert.equal((await db.query('select * from nudge_private.comparison_evidence where decision_id=$1',[foreign.id])).rows.length,0);
    assert.equal((await db.query('select * from nudge_private.comparison_settings where user_id=$1',[USER_B])).rows.length,0);
  });
});
