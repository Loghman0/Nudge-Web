import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDiscoveryHandler} from '../src/lib/api/v1/discovery-route';
import {loadDiscoveryProfile,discoveryLearningNeeds} from '../src/lib/services/discovery';
import {DISCOVERY_CATALOG,deriveDiscoveryObservations,selectDiscoveryQuestion} from '../src/lib/discovery';

const state=()=>({generation:0,today:'2026-11-04',answers:[],feedback:[],exposures:[],settings:{max_depth:2,written_answers:true,optional_topics:true},suppressedQuestionIds:[],capabilities:{writtenAnswers:false,optionalTopics:false}});
function fixture(raw:Record<string,unknown>){
 const writes:{name:string;args:Record<string,unknown>}[]=[];
 let reads=0;
 const client={rpc:async(name:string,args:Record<string,unknown>)=>{
  if(name==='read_discovery_state'){reads++;return {data:raw,error:null};}
  writes.push({name,args});return {data:{question_id:args.p_question_id,question_version:args.p_version,state:'served'},error:null};
 }};
 const handler=createDiscoveryHandler(async()=>({ok:true,userId:'owner',client:client as never}));
 const call=(path:string,body:Record<string,unknown>,method='POST')=>handler(new Request('https://nudge.test/api/v1/discovery/'+path,{method,headers:{'content-type':'application/json'},body:JSON.stringify({expectedGeneration:0,requestId:randomUUID(),...body})}),{params:Promise.resolve({path:path.split('/')})});
 return {client,writes,call,reads:()=>reads};
}

test('Discovery mood rejects unlisted values before reading or reserving and accepts optional context',async()=>{
 for(const mood of ['', 'Happy', 'depressed',42,true,[],{}]){
  const {call,writes,reads}=fixture(state());
  const response=await call('next',{mood});assert.equal(response.status,400);assert.equal(reads(),0);assert.equal(writes.length,0);
 }
 for(const mood of [undefined,null,'happy','excited','calm','sad','angry','anxious','tired','mixed']){
  const {call,writes}=fixture(state());const response=await call('next',{mood});assert.equal(response.status,200);
  assert.equal(writes.length,1);assert.deepEqual(Object.keys(writes[0].args).sort(),['p_request_id','p_generation','p_question_id','p_version','p_daily','p_change','p_reason'].sort(),'Mood stays out of stored reservation arguments');
  const result=await response.json();assert.equal('mood' in result,false);assert.equal(result.question.sensitivity,'ordinary');assert.notEqual(result.question.format,'text');
 }
});

test('Mood does not churn a reserved daily question; explicit change reserves another',async()=>{
 const q=DISCOVERY_CATALOG.find(q=>q.depth===0&&q.sensitivity==='ordinary'&&q.format==='choice')!;
 const raw={...state(),exposures:[{question_id:q.id,question_version:q.version,family_id:q.familyId,served_at:new Date().toISOString(),state:'served',daily:true,local_day:'2026-11-04'}]};
 for(const mood of ['happy','sad','angry','mixed',null]){
  const unchanged=fixture(raw);const response=await unchanged.call('next',{daily:true,mode:'light',mood});
  assert.equal(response.status,200);assert.equal((await response.json()).question.id,q.id);assert.equal(unchanged.writes.length,0);
  const changed=fixture(raw);const next=await changed.call('next',{daily:true,mode:'light',mood,change:true});
  assert.equal(next.status,200);assert.notEqual((await next.json()).question.id,q.id);assert.equal(changed.writes[0].args.p_change,true);
 }
});
test('Discovery rejects unavailable text, contextual writing and optional answers before a write',async()=>{
 const {call,writes}=fixture(state());
 const text=DISCOVERY_CATALOG.find(q=>q.format==='text')!;
 const optional=DISCOVERY_CATALOG.find(q=>q.sensitivity==='optional'&&q.format==='choice')!;
 for(const [q,response] of [[text,{kind:'text',text:'A small note'}],[optional,{kind:'choice',optionId:optional.choices![0].id}],[DISCOVERY_CATALOG[0],{kind:'depends',context:'A note'}]] as const){
  assert.equal((await call('answers',{answers:[{questionId:q.id,questionVersion:q.version,response}]})).status,400);
 }
 assert.equal((await call('settings',{mutedTopics:[],maxDepth:0,optionalTopics:false,writtenAnswers:true,metricsEnabled:false})).status,400);
 assert.equal(writes.length,0);
});
test('An unavailable reserved daily question is replaced rather than returned or trapping the user',async()=>{
 for(const reason of ['text','optional','muted','suppressed','depth']){
  const q=DISCOVERY_CATALOG.find(q=>reason==='text'?q.format==='text':reason==='optional'?q.sensitivity==='optional':reason==='depth'?q.depth>0:q.format==='choice'&&q.sensitivity==='ordinary'&&q.depth===0)!;
  const {call,writes}=fixture({...state(),settings:{...state().settings,muted_topics:reason==='muted'?[q.domain]:[]},suppressedQuestionIds:reason==='suppressed'?[q.id]:[],exposures:[{question_id:q.id,question_version:q.version,family_id:q.familyId,served_at:'2026-11-04T00:00:00Z',state:'served',daily:true,local_day:'2026-11-04'}]});
  const response=await call('next',{daily:true,mode:'light'});assert.equal(response.status,200,reason);
  const data=await response.json();assert.notEqual(data.question.id,q.id,reason);assert.equal(data.question.depth,0);assert.equal(data.question.sensitivity,'ordinary');assert.notEqual(data.question.format,'text');
  assert.equal(writes[0].args.p_change,true,reason);
 }
});
test('Readiness requires both database and server approval',async()=>{
 const before=process.env.NUDGE_DISCOVERY_WRITTEN_READY;
 try{process.env.NUDGE_DISCOVERY_WRITTEN_READY='true';const {client}=fixture(state());assert.equal((await loadDiscoveryProfile(client as never)).capabilities.writtenAnswers,false);}
 finally{if(before===undefined)delete process.env.NUDGE_DISCOVERY_WRITTEN_READY;else process.env.NUDGE_DISCOVERY_WRITTEN_READY=before;}
});
test('Profile shows the newest supporting answer first and excludes forgotten sources',async()=>{
 const row=(id:string,question_id:string,date:string)=>({id,question_id,question_version:1,response:{kind:'choice',optionId:'a'},revision:0,active:true,answered_at:date});
 const {client}=fixture({...state(),answers:[row('old','rest-break','2026-10-01T00:00:00Z'),row('new','time-free-day','2026-11-04T00:00:00Z'),row('forgotten','learning-puzzle','2026-11-04T10:00:00Z')],suppressedQuestionIds:['learning-puzzle']});
 const profile=await loadDiscoveryProfile(client as never);assert.deepEqual(profile.insights[0].evidenceIds,['new']);assert.ok(profile.insights.every(i=>!i.evidenceIds.includes('forgotten')));assert.equal(profile.counts.answers,2);
 const needs=discoveryLearningNeeds(profile);assert.ok(needs.length>0);assert.ok(profile.insights.every(i=>!needs.includes(i.attributeKey!)),'Known or explicitly corrected attributes do not invite repeated probing');
});
test('Light mode and forgotten question exclusions are hard selector boundaries',()=>{
 const pool=DISCOVERY_CATALOG.filter(q=>q.depth===0&&q.sensitivity==='ordinary'&&q.format!=='text');
 const result=selectDiscoveryQuestion({answers:[],mode:'light',maxDepth:2,allowText:true,allowedOptional:true,suppressedQuestionIds:pool.map(q=>q.id)});
 assert.ok(!result.question||result.question.depth===0);
 assert.ok(!result.question||!pool.some(q=>q.id===result.question!.id));
});
test('A tied first rank does not turn compatible priorities into contradictory evidence',()=>{
 const q=DISCOVERY_CATALOG.find(q=>q.format==='ranking'&&q.ranking?.allowTies&&q.signals?.length)!;
 assert.ok(q,'The reviewed bank must include a ranking with source mappings.');
 const observations=deriveDiscoveryObservations([{id:'tied',questionId:q.id,questionVersion:q.version,response:{kind:'ranking',groups:[q.choices!.slice(0,2).map(c=>c.id)]}}]);
 assert.ok(observations.every(o=>o.state!=='mixed'));
});
