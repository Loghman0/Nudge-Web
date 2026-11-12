import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createTestDatabase,asUser,USER_A,USER_B} from './helpers/database';
import {resolveCriterionSources} from '../src/lib/services/criterion-provenance';
import {assessCriteria,type ComparisonCriterion} from '../src/lib/services/comparison-criteria';
import {buildComparisonSnapshot,parseComparisonSnapshot} from '../src/lib/services/comparison-snapshot';
import {deriveDiscoveryObservations} from '../src/lib/discovery/insights';

const sample={questionId:'time-free-day',questionVersion:1,response:{kind:'choice' as const,optionId:'a'}};
const suggestionId=deriveDiscoveryObservations([sample])[0].id;
const criterion=(generation=0):ComparisonCriterion=>({id:'time',label:'Room in the schedule',unit:'hours',weight:3,direction:'higher',low:0,high:10,values:{A:{value:8},B:{value:2}},discoverySuggestion:{id:suggestionId,generation}});
function sourceState(){return {generation:0,today:'2026-11-05',feedback:[],exposures:[],settings:{},answers:[{id:randomUUID(),question_id:sample.questionId,question_version:1,response:sample.response,revision:0,active:true,answered_at:new Date().toISOString()}]};}
test('Accepted criteria recompute current owner sources and reject stale, excluded, unrelated or forged references',async()=>{
 const state=sourceState();const client={rpc:async()=>({data:state,error:null})} as never;
 // Use the catalog-owned label rather than inventing a mapping in the fixture.
 const c={...criterion(),label:deriveDiscoveryObservations([sample])[0].criterion!.label};
 const sources=await resolveCriterionSources(client,[c],{domain:'Everyday life',category:'travel'},0);
 assert.deepEqual(sources[0].answers,[{answerId:state.answers[0].id,answerRevision:0,questionId:sample.questionId,questionVersion:1}]);
 assert.doesNotMatch(JSON.stringify(sources),/response|statement|choice|optionId/);
 for(const [changed,context] of [[{...c,discoverySuggestion:{id:suggestionId,generation:1}},{domain:'travel'}],[{...c,label:'Invented label'},{domain:'travel'}],[c,{domain:'Minecraft'}]] as const)await assert.rejects(resolveCriterionSources(client,[changed],context,0),/changed/);
 state.answers[0].active=false;await assert.rejects(resolveCriterionSources(client,[c],{domain:'travel'},0),/changed/);
});
test('Private criterion provenance validates owners and versions and retracts after feedback or source deletion',async()=>{
 const db=await createTestDatabase();
 try{
  const dir=new URL('../supabase/migrations/',import.meta.url);
  for(const file of (await readdir(dir)).filter(f=>/^0001[0-8]_.*sql$/.test(f)).sort())await db.exec(await readFile(new URL(file,dir),'utf8'));
  const save=async(user:string)=>(await asUser(db,user,tx=>tx.query<{v:{answerIds:string[]}}>("select save_discovery_answers($1,0,$2,'preview') v",[randomUUID(),JSON.stringify([sample])]))).rows[0].v.answerIds[0];
  const ownerAnswer=await save(USER_A),otherAnswer=await save(USER_B);
  const c={...criterion(),label:deriveDiscoveryObservations([sample])[0].criterion!.label};delete c.discoverySuggestion;
  function fixture(answerId=ownerAnswer){
   const assessment=assessCriteria([c],['A','B']),run=randomUUID(),at=Date.now();
   const options=assessment.options.map(o=>({label:o.label,tags:[],score:o.low,breakdown:{criteriaLow:o.low,criteriaHigh:o.high,coverage:o.coverage}}));
   const snapshot=buildComparisonSnapshot({scoringRunId:run,asOf:at,config:{configCategory:'default',version:1,weights:{preferenceMatch:.55,historySuccess:.3,novelty:.15}},ranked:options,preferences:[],history:[],confidence:'low',coldStart:false,evidenceState:'insufficient',criteriaAssessment:assessment,criterionSources:[{criterionId:c.id,suggestionId,generation:0,answers:[{answerId,answerRevision:0,questionId:sample.questionId,questionVersion:1}]}]});
   const context={domain:'Everyday life',comparisonBasis:'criteria',criteria:[c],criteriaConfirmed:true,criteriaVersion:1,discovery_criteria_used:true,meaningConfirmed:true,engine_version:2,scoring_run_id:run,scored_at:snapshot.scoredAt,engine_config:snapshot.engineConfig,confidence:'low',cold_start:false,evidence_state:'insufficient'};
   return {snapshot,context,options};
  }
  const create=async(f=fixture())=>(await asUser(db,USER_A,tx=>tx.query<{id:string}>('select create_comparison_with_evidence($1,$2,\'travel\',\'Source test\',$3,null,$4,0,$5) id',[randomUUID(),JSON.stringify({fixture:randomUUID()}),JSON.stringify(f.context),JSON.stringify(f.options),JSON.stringify(f.snapshot)]))).rows[0].id;
  assert.ok(parseComparisonSnapshot(fixture().snapshot));
  await assert.rejects(create(fixture(otherAnswer)),/Source answer changed|unavailable/);
  const bad=fixture();bad.snapshot.criterionSources![0].answers[0].answerRevision=1;await assert.rejects(create(bad),/Source answer changed/);
  const raw=fixture();Object.assign(raw.snapshot.criterionSources![0],{rawAnswer:'Do not store this'});assert.equal(parseComparisonSnapshot(raw.snapshot),null);await assert.rejects(create(raw),/Invalid criterion source/);
  const id=await create();
  const read=async()=>(await asUser(db,USER_A,tx=>tx.query('select * from read_my_comparison_evidence($1)',[id]))).rows;
  assert.equal((await read()).length,1);
  assert.equal((await asUser(db,USER_B,tx=>tx.query('select * from read_my_comparison_evidence($1)',[id]))).rows.length,0);
  await asUser(db,USER_A,tx=>tx.query('select save_discovery_feedback($1,0,$2,\'not_me\')',[randomUUID(),suggestionId]));
  assert.equal((await read()).length,0,'Negative feedback withdraws its private source snapshot');
  await assert.rejects(create(),/excluded from suggestions/);
  await asUser(db,USER_A,tx=>tx.query('select save_discovery_feedback($1,0,$2,\'fits\')',[randomUUID(),suggestionId]));
  const second=await create();
  await asUser(db,USER_A,tx=>tx.query('select edit_discovery_answer($1,0,$2,0,null,null,true)',[randomUUID(),ownerAnswer]));
  assert.equal((await asUser(db,USER_A,tx=>tx.query('select * from read_my_comparison_evidence($1)',[second]))).rows.length,0);
  assert.equal((await db.query<{n:number}>('select count(*)::int n from decisions where user_id=$1',[USER_A])).rows[0].n,2,'Withdrawing sources preserves the decisions');
 }finally{await db.close();}
});
