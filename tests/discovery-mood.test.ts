import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DISCOVERY_CATALOG,DISCOVERY_MOODS,discoveryMood,discoveryMoodFit,moodDecisionPriorities,parseDiscoveryAnswers,selectDiscoveryQuestion} from '../src/lib/discovery';
import type {DiscoveryMood,DiscoveryQuestion,DiscoverySelectionInput} from '../src/lib/discovery/types';
import {assessCriteria} from '../src/lib/services/comparison-criteria';

const question=(id:string,patch:Partial<DiscoveryQuestion>={}):DiscoveryQuestion=>({
 ...DISCOVERY_CATALOG.find(q=>q.depth===0&&q.format==='choice'&&q.sensitivity==='ordinary')!,
 id,familyId:id,domain:'food',purpose:'evidence',estimatedSeconds:30,depth:0,format:'choice',sensitivity:'ordinary',signals:[],...patch,
});
const sequence=(...values:number[])=>{let index=0;return ()=>values[Math.min(index++,values.length-1)];};

test('Mood is optional, exact and separate from answers or inferred traits',()=>{
 assert.deepEqual(DISCOVERY_MOODS.map(m=>m.id),['happy','excited','calm','sad','angry','anxious','tired','mixed']);
 for(const mood of DISCOVERY_MOODS)assert.equal(discoveryMood(mood.id),mood.id);
 for(const value of [undefined,null,'','Happy','depressed','furious',1,true,{},[]])assert.equal(discoveryMood(value),null);
 const q=DISCOVERY_CATALOG[0];
 assert.ok(parseDiscoveryAnswers([{questionId:q.id,questionVersion:q.version,response:{kind:'skip'},mood:'sad'}]).error,'Session mood cannot become a saved answer field');
});

test('No mood, null and mixed preserve the prior selector result and random sequence',()=>{
 const pool=[question('a'),question('b',{purpose:'playful'})];
 for(const randomValues of [[.3,.3],[.1,0,.3]]){
  const original=selectDiscoveryQuestion({answers:[],random:sequence(...randomValues)},pool);
  for(const mood of [null,'mixed'] as const)assert.deepEqual(selectDiscoveryQuestion({answers:[],mood,random:sequence(...randomValues)},pool),original);
 }
});

test('Happy and excited prefer playful variety without changing depth permissions',()=>{
 const pool=[question('a-ordinary'),question('b-playful',{purpose:'playful',domain:'play'})];
 assert.equal(selectDiscoveryQuestion({answers:[],random:sequence(.3,.3)},pool).question?.id,'a-ordinary');
 for(const mood of ['happy','excited'] as const){
  const result=selectDiscoveryQuestion({answers:[],mood,random:sequence(.3,.3)},pool);
  assert.equal(result.question?.id,'b-playful');assert.equal(result.question?.depth,0);
 }
});

test('Lower-effort moods favor short concrete questions in ranking and exploration',()=>{
 const pool=[question('a-long',{format:'text',depth:1,estimatedSeconds:90}),question('b-short',{estimatedSeconds:15})];
 const input:DiscoverySelectionInput={answers:[],mode:'reflect',maxDepth:2,allowText:true};
 assert.equal(selectDiscoveryQuestion({...input,random:sequence(.3,.3)},pool).question?.id,'a-long');
 for(const mood of ['sad','angry','anxious','tired'] as const){
  assert.equal(selectDiscoveryQuestion({...input,mood,random:sequence(.3,.3)},pool).question?.id,'b-short',mood+' ranking');
  const explored=selectDiscoveryQuestion({...input,mood,random:sequence(.1,0,.3)},pool);
  assert.equal(explored.reason,'explore');assert.equal(explored.question?.id,'b-short',mood+' exploration');
 }
});

test('Calm only favors reflective formats within explicitly permitted pace and depth',()=>{
 const pool=[question('a-choice'),question('b-reflection',{depth:1,format:'scale'})];
 const input:DiscoverySelectionInput={answers:[],mood:'calm',maxDepth:2,random:sequence(.3,.3)};
 assert.equal(selectDiscoveryQuestion({...input,mode:'reflect'},pool).question?.id,'b-reflection');
 assert.equal(selectDiscoveryQuestion({...input,mode:'light',random:sequence(.3,.3)},pool).question?.id,'a-choice');
});

test('Sad visibly favors manageable self-knowledge topics while preserving broad discovery',()=>{
 const comfort=new Set(['rest','relationships','places','movement','food']);
 function sample(mood:DiscoveryMood|null){let matched=0;const domains=new Set<string>();for(let index=1;index<=600;index++){
  let seed=index;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const selected=selectDiscoveryQuestion({answers:[],mood,mode:'light',random}).question;
  assert.ok(selected);assert.equal(selected.depth,0);assert.equal(selected.sensitivity,'ordinary');
  domains.add(selected.domain);if(comfort.has(selected.domain))matched++;
 }return {share:matched/600,domains:domains.size};}
 const ordinary=sample(null),sad=sample('sad');
 assert.ok(sad.share>ordinary.share+.25,'Mood should visibly change the mix, not just the label');
 assert.ok(sad.share<.85,'Mood must leave room for other interests');assert.ok(sad.domains>=12);
});

test('Every mood keeps privacy, eligibility, topic, fatigue and novelty as hard boundaries',()=>{
 const pool=[
  question('muted',{domain:'work'}),question('wrong-topic',{domain:'rest'}),question('optional',{sensitivity:'optional'}),
  question('deep',{depth:2}),question('written',{format:'text'}),question('suppressed'),question('forgotten',{signals:[{attributeKey:'forgotten',value:'x',statement:'x',scope:'x',kind:'preference',strength:'direct'}]}),
  question('answered'),question('recent'),question('retired',{status:'retired'}),question('safe'),
 ];
 for(const {id:mood} of DISCOVERY_MOODS){
  for(const values of [[.3,.3],[.1,0,.3]]){
   const input:DiscoverySelectionInput={answers:[{questionId:'answered',questionVersion:1,response:{kind:'skip'}}],mood,mode:'light',maxDepth:2,topic:'food',mutedTopics:['work'],allowText:false,allowedOptional:false,suppressedQuestionIds:['suppressed'],forgottenAttributes:['forgotten'],exposures:[{questionId:'recent',familyId:'recent',servedAt:new Date().toISOString(),state:'served'}],random:sequence(...values)};
   assert.equal(selectDiscoveryQuestion(input,pool).question?.id,'safe',mood);
   assert.equal(selectDiscoveryQuestion({...input,sessionAnswers:3},pool).reason,'pause',mood+' fatigue');
   assert.equal(selectDiscoveryQuestion({...input,consecutiveSkips:2},pool).reason,'pause',mood+' skipped');
   assert.equal(selectDiscoveryQuestion({...input,mutedTopics:['food']},pool).reason,'exhausted',mood+' topic opt-out');
  }
 }
});

test('Comfort weights stay bounded and never depend on private answer text',()=>{
 for(const q of DISCOVERY_CATALOG)for(const {id:mood} of DISCOVERY_MOODS){const fit=discoveryMoodFit(q,mood);assert.ok(Number.isFinite(fit)&&fit>=0&&fit<=1,mood+' '+q.id);}
 const q=question('same'),copy={...q,prompt:'A different sentence',choices:[{id:'a',label:'Private wording'},{id:'b',label:'Other wording'}]};
 for(const {id:mood} of DISCOVERY_MOODS)assert.equal(discoveryMoodFit(q,mood),discoveryMoodFit(copy,mood));
});

test('Mood priorities are bounded optional labels with no measurements, evidence, weights or stored emotion',()=>{
 assert.deepEqual(moodDecisionPriorities(),[]);assert.deepEqual(moodDecisionPriorities(null),[]);
 assert.deepEqual(moodDecisionPriorities('Angry' as DiscoveryMood),[],'Human labels require an explicit known-enum conversion');
 for(const {id:mood} of DISCOVERY_MOODS){
  const priorities=moodDecisionPriorities(mood);
  assert.ok(priorities.length>=2&&priorities.length<=3);assert.equal(new Set(priorities.map(priority=>priority.id)).size,priorities.length);
  for(const priority of priorities){
   assert.deepEqual(Object.keys(priority).sort(),['direction','id','label']);
   assert.match(priority.id,/^[a-z]+$/);assert.ok(priority.label.trim()&&priority.label.length<=100);assert.ok(['higher','lower'].includes(priority.direction));
  }
  assert.ok(Object.isFrozen(priorities));assert.ok(priorities.every(priority=>Object.isFrozen(priority)));
  const before=JSON.stringify(priorities);assert.throws(()=>Object.assign(priorities[0],{weight:5}));assert.equal(JSON.stringify(moodDecisionPriorities(mood)),before);
 }
 const angry=moodDecisionPriorities('angry');
 assert.equal(angry.find(priority=>priority.id==='effort')?.direction,'lower');
 assert.equal(angry.find(priority=>priority.id==='flexibility')?.direction,'higher');
});

test('Approving a mood priority cannot produce an option winner until the user supplies evidence',()=>{
 const labels=['A','B'];
 for(const {id:mood} of DISCOVERY_MOODS){
  const approved=moodDecisionPriorities(mood).map(priority=>({id:priority.id,label:priority.label,direction:priority.direction,unit:'points',weight:3,low:0,high:10,values:{}}));
  const assessed=assessCriteria(approved,labels);
  assert.equal(assessed.outcome,'uncertain');assert.equal(assessed.leader,null);
  assert.ok(assessed.options.every(option=>option.coverage===0&&option.low===0&&option.high===1));
 }
});
