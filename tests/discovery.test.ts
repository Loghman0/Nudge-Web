import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DISCOVERY_CATALOG,PREVIEW_QUESTIONS,getDiscoveryQuestion,validateDiscoveryResponse,parseDiscoveryAnswers,deriveDiscoveryObservations,selectDiscoveryQuestion,DISCOVERY_DOMAINS} from '../src/lib/discovery';
import {parseGuestDraft} from '../src/lib/discovery/guest-draft';
import {suggestDecisionCriteria} from '../src/lib/services/decision-personalization';
import {createDiscoveryHandler} from '../src/lib/api/v1/discovery-route';
import type {DiscoveryAnswer} from '../src/lib/discovery/types';
const answer=(id=PREVIEW_QUESTIONS[0].id):DiscoveryAnswer=>({id:'answer-'+id,questionId:id,questionVersion:1,response:{kind:'choice',optionId:'a'},answeredAt:'2026-10-29T10:00:00Z'});
test('Discovery catalog covers 18 domains, six preview items and four response formats',()=>{
 assert.equal(DISCOVERY_CATALOG.length,208);assert.equal(PREVIEW_QUESTIONS.length,6);assert.equal(new Set(DISCOVERY_CATALOG.map(q=>q.id)).size,DISCOVERY_CATALOG.length);
 assert.deepEqual(new Set(DISCOVERY_CATALOG.map(q=>q.domain)),new Set(DISCOVERY_DOMAINS.map(d=>d.id)));
 assert.deepEqual(new Set(DISCOVERY_CATALOG.map(q=>q.format)),new Set(['choice','scale','ranking','text']));
 for(const q of DISCOVERY_CATALOG){assert.ok(q.review);assert.ok(q.allowedResponses.includes('skip'));assert.ok(q.prompt.length<280);assert.equal(q.status,'published');}
});
test('Typed answers reject injection, missing values, impossible ranks, and unselected scales',()=>{
 const q=PREVIEW_QUESTIONS[0];for(const r of [null,[],{}, {kind:'choice'}, {kind:'choice',optionId:'z'}, {kind:'choice',optionId:'a',weight:10}, {kind:'both',context:'no'}])assert.ok(validateDiscoveryResponse(q,r).error);
 const scale=DISCOVERY_CATALOG.find(q=>q.format==='scale')!;assert.ok(validateDiscoveryResponse(scale,{kind:'scale',value:NaN}).error);assert.ok(validateDiscoveryResponse(scale,{kind:'scale',value:scale.scale!.max+1}).error);
 const rank=DISCOVERY_CATALOG.find(q=>q.format==='ranking')!;assert.ok(validateDiscoveryResponse(rank,{kind:'ranking',groups:[['a'],['a']]}).error);
 assert.ok(parseDiscoveryAnswers([{...answer(),response:{kind:'skip'}}]).error,'Wire inputs exclude server-owned fields');
});
test('Neutral, skipped, playful and excluded answers never create traits',()=>{
 for(const kind of ['both','depends','neither','skip'] as const)assert.deepEqual(deriveDiscoveryObservations([{...answer(),response:{kind}}]),[]);
 assert.deepEqual(deriveDiscoveryObservations([{...answer(),useInProfile:false}]),[]);
 const q=DISCOVERY_CATALOG.find(q=>q.purpose==='playful')!;assert.deepEqual(deriveDiscoveryObservations([answer(q.id)]),[]);
 assert.equal(deriveDiscoveryObservations([answer(),answer()])[0].evidenceIds.length,1);
});
test('Selection honors topic, opt-outs, depth, novelty, fatigue and optional writing',()=>{
 const pool=DISCOVERY_CATALOG.filter(q=>q.domain==='food');const result=selectDiscoveryQuestion({answers:[],topic:'food',random:()=>.3});assert.equal(result.question?.domain,'food');
 assert.equal(selectDiscoveryQuestion({answers:[],topic:'food',mutedTopics:['food']}).reason,'exhausted');
 assert.equal(selectDiscoveryQuestion({answers:[],sessionAnswers:3}).reason,'pause');
 assert.equal(selectDiscoveryQuestion({answers:[],consecutiveSkips:2}).reason,'pause');
 assert.equal(selectDiscoveryQuestion({answers:[],topic:'childhood'}).reason,'exhausted');
 assert.equal(selectDiscoveryQuestion({answers:pool.map(q=>answer(q.id)),topic:'food'}).reason,'exhausted');
 for(let i=0;i<50;i++){const chosen=selectDiscoveryQuestion({answers:[]}).question!;assert.equal(chosen.depth,0);assert.equal(chosen.sensitivity,'ordinary');assert.notEqual(chosen.format,'text');}
});
test('Guest draft rejects expired, future, oversized and non-preview material',()=>{
 const now=Date.now(),draft={version:1,createdAt:now,requestId:'00000000-0000-4000-8000-000000000001',answers:[{questionId:PREVIEW_QUESTIONS[0].id,questionVersion:1,response:{kind:'choice',optionId:'a'}}]};
 assert.equal(parseGuestDraft(JSON.stringify(draft),now)?.answers.length,1);
 assert.equal(parseGuestDraft(JSON.stringify({...draft,createdAt:now-86400001}),now),null);assert.equal(parseGuestDraft(JSON.stringify({...draft,createdAt:now+1}),now),null);
 assert.equal(parseGuestDraft(JSON.stringify({...draft,answers:[{...draft.answers[0],questionId:'work-focus'}]}),now),null);
});
test('Decision suggestions are source-linked, scoped, stale-aware and never fill facts or weights',()=>{
 const observations=deriveDiscoveryObservations([answer('time-free-day'),answer('learning-puzzle')]);
 const suggestions=suggestDecisionCriteria(observations,{domain:'Everyday life',category:'travel'},new Date('2026-10-29'));
 assert.equal(suggestions.length,1);assert.equal(suggestions[0].requiresConfirmation,true);assert.equal('weight' in suggestions[0],false);assert.deepEqual(suggestions[0].evidenceIds,['answer-time-free-day']);
 assert.deepEqual(suggestDecisionCriteria(observations,{domain:'Minecraft',category:'travel'}),[]);
 assert.deepEqual(suggestDecisionCriteria(observations.map(o=>({...o,state:'mixed'})),{domain:'travel'}),[]);
 assert.deepEqual(suggestDecisionCriteria(observations,{domain:'travel'},new Date('2028-01-01')),[]);
});
test('Every new trade-off answer gives a priority in its own context, while Depends stays neutral',()=>{
 const cases=[['food-weeknight-tradeoff','food'],['food-lunch-tradeoff','food'],['study-short-session','study'],['study-space-tradeoff','study'],['rest-break-tradeoff','rest'],['rest-evening-tradeoff','rest'],['money-small-purchase-tradeoff','money'],['money-recurring-service-tradeoff','money']];
 for(const [id,domain] of cases){
  const question=getDiscoveryQuestion(id)!;
  for(const option of question.choices!){
   const observations=deriveDiscoveryObservations([{...answer(id),response:{kind:'choice',optionId:option.id}}]);
   const now=new Date('2026-10-29');
   const [priority,...others]=suggestDecisionCriteria(observations,{domain},now);
   assert.ok(priority,`${id} must yield a priority for ${option.id}`);
   assert.equal(priority.requiresConfirmation,true);
   assert.deepEqual(priority.questionIds,[id]);
   assert.equal(others.length,0);
   assert.deepEqual(suggestDecisionCriteria(observations,{domain:'Minecraft',category:'food'},now),[]);
  }
  assert.deepEqual(deriveDiscoveryObservations([{...answer(id),response:{kind:'depends'}}]),[]);
 }
});
test('Discovery route keeps authentication failures explicit and rejects malformed requests before writes',async()=>{
 const denied=createDiscoveryHandler(async()=>({ok:false,status:401,code:'unauthenticated',message:'Not signed in.'}));
 assert.equal((await denied(new Request('http://nudge/api/v1/discovery/profile'),{params:Promise.resolve({path:['profile']})})).status,401);
 const authenticated=createDiscoveryHandler(async()=>({ok:true,userId:'owner',client:{rpc:()=>{throw new Error('Unexpected write');}} as never}));
 for(const body of ['null','[]','{','{"expectedGeneration":-1}'])assert.equal((await authenticated(new Request('http://nudge/api/v1/discovery/claim',{method:'POST',headers:{'Content-Type':'application/json'},body}),{params:Promise.resolve({path:['claim']})})).status,400);
});
