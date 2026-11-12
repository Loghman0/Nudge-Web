import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../src/lib/types/database';
import type {AiProvider} from '../src/lib/services/ai/provider';
import {understandDecision} from '../src/lib/services/decision-intake';
import {draftUnderstanding,groundUnderstanding} from '../src/lib/services/decision-understanding';
import {domainScope,preferencesForDomain,sameDecisionDomain} from '../src/lib/services/decision-domain';
import {decodeUnderstanding} from '../src/lib/services/ai/language-tasks';
import {parseComparisonInput} from '../src/lib/services/comparison-input';
import type {Preference} from '../src/lib/types';
import {POLICY_VERSION} from '../src/lib/legal/config';

const text='Should I go mining, or should I cut trees?';
const interpretation={options:['go mining','cut trees'],category:'hobbies',domain:'',goal:'',
  question:'Is this a game, work or another setting? What is your goal?',unfamiliarTerms:['mining']};
function harness(enabled=true,quota=true) {
  let requests=0;
  const state={ai_enabled:enabled,memory_generation:0,terms_version:POLICY_VERSION};
  const db={from:()=>({select:()=>({eq:()=>({single:async()=>({data:{...state},error:null})})})}),
    rpc:async(name:string,args:unknown)=>{requests++;assert.equal(name,'reserve_ai_request');assert.deepEqual(args,{p_action:'interpret'});return {data:quota,error:null};}};
  return {db:db as unknown as SupabaseClient<Database>,count:()=>requests,state};
}
describe('decision interpretation and context isolation',()=>{
  it('discards in-flight AI drafts after consent, terms or memory generation changes',async()=>{
    for(const change of ['off','terms','reset'] as const){
      const h=harness();const provider={understandDecision:async()=>{
        if(change==='off')h.state.ai_enabled=false;
        if(change==='terms')h.state.terms_version='old';
        if(change==='reset')h.state.memory_generation++;
        return {...interpretation,domain:'Minecraft'};
      }} as unknown as AiProvider;
      const draft=await understandDecision(h.db,'privacy-'+change,text,undefined,provider);
      assert.equal(draft.source,'manual');assert.equal(draft.domain,'');assert.match(draft.notice,/discarded/);
      assert.equal(h.count(),1);
    }
  });
  it('does not turn word fragments or generated factual premises into a clarification',()=>{
    const grounded=groundUnderstanding(decodeUnderstanding(JSON.stringify({...interpretation,options:['car','tripod'],domain:'Rust',goal:'trust',
      question:'Since mining doubles diamonds, which biome?',unfamiliarTerms:['car','Rust']})),'I trust the guide. Should I choose a camera or a tripod?');
    assert.deepEqual(grounded.options,['tripod']);assert.equal(grounded.domain,'');
    assert.deepEqual(grounded.unfamiliarTerms,[]);assert.ok(!grounded.question.includes('diamonds'));
    assert.match(grounded.question,/setting/);
  });
  it('does not assume the meaning of ambiguous activities or replace them with starter options',()=>{
    const draft=draftUnderstanding(text);
    assert.equal(draft.domain,'');assert.equal(draft.goal,'');
    assert.deepEqual(draft.options,['go mining','cut trees']);
    assert.equal(draftUnderstanding('What should I do next?').options.length,0);
    assert.equal(draftUnderstanding('Rust or Go?').domain,'');
  });
  it('preserves explicitly written alternatives when grounded AI output loses them',async()=>{
    const question='Should I repair a camera or organize a cupboard?';
    const h=harness();
    const provider={understandDecision:async()=>({...interpretation,options:['camera repair','cupboard organization']})} as unknown as AiProvider;
    const draft=await understandDecision(h.db,'verbatim-fallback',question,undefined,provider);
    assert.deepEqual(draft.options,['repair a camera','organize a cupboard']);
    assert.equal(draft.domain,'');assert.equal(draft.source,'manual');
    assert.match(draft.notice,/original options/);
  });
  it('keeps explicit setting and trailing goal text out of manual option slots',()=>{
    const draft=draftUnderstanding('In Minecraft Java Edition, should I go mining or cut trees? My goal is to gather building supplies.');
    assert.deepEqual(draft.options,['go mining','cut trees']);
    assert.equal(draft.domain,'');assert.equal(draft.goal,'');
  });
  it('extracts only supplied alternatives and keeps explicit slots authoritative',()=>{
    const draft=decodeUnderstanding(JSON.stringify({...interpretation,options:['go mining','invented activity']}));
    assert.deepEqual(groundUnderstanding(draft,text).options,['go mining']);
    assert.deepEqual(groundUnderstanding(draft,text,['伐採','採掘']).options,['伐採','採掘']);
    const invented=groundUnderstanding({...draft,domain:'Minecraft',goal:'Find diamonds',unfamiliarTerms:['mining','unmentioned jargon']},text);
    assert.equal(invented.domain,'');assert.equal(invented.goal,'');assert.deepEqual(invented.unfamiliarTerms,['mining']);
    assert.equal(groundUnderstanding({...draft,domain:'Minecraft'},text+' In Minecraft.').domain,'Minecraft');
    assert.throws(()=>decodeUnderstanding(JSON.stringify({...interpretation,domain:'x'.repeat(101)})));
    assert.throws(()=>decodeUnderstanding(JSON.stringify({...interpretation,options:[null]})));
    assert.throws(()=>decodeUnderstanding(JSON.stringify({...interpretation,unfamiliarTerms:{}})));
  });
  it('keeps optional AI off without consent and keeps the manual path when quota is exhausted',async()=>{
    let calls=0;const provider={understandDecision:async()=>{calls++;return interpretation;}} as unknown as AiProvider;
    const off=harness(false);
    assert.equal((await understandDecision(off.db,'off',text,undefined,provider)).source,'manual');
    assert.equal(off.count(),0);assert.equal(calls,0);
    const limited=harness(true,false);
    assert.match((await understandDecision(limited.db,'limited',text,undefined,provider)).notice,/limit/);
    assert.equal(limited.count(),1);assert.equal(calls,0);
  });
  it('validates AI drafts, propagates cancellation, and never saves model-invented facts or memories',async()=>{
    const h=harness();let calls=0;
    const provider={understandDecision:async(input:string,options:{signal:AbortSignal})=>{
      calls++;assert.equal(input,text);assert.equal(options.signal.aborted,false);
      return {...interpretation,options:['go mining','cut trees','build a factory']};
    }} as unknown as AiProvider;
    const draft=await understandDecision(h.db,'valid',text,undefined,provider);
    assert.equal(draft.source,'ai');assert.deepEqual(draft.options,['go mining','cut trees']);
    assert.equal(draft.domain,'');assert.match(draft.notice,/Check and edit/);
    assert.equal(h.count(),1);assert.equal(calls,1);
    const broken={understandDecision:async()=>({category:'made-up'})} as unknown as AiProvider;
    const manual=await understandDecision(h.db,'broken',text,undefined,broken);
    assert.equal(manual.source,'manual');assert.match(manual.notice,/could not interpret/);
  });
  it('bounds and allowlists user-confirmed meaning including Unicode and option-specific details',()=>{
    const parsed=parseComparisonInput(['採掘','伐採'],'次の行動',{domain:'  My Game  V2 ',goal:' Gather supplies ',
      meaningConfirmed:true,optionDetails:{'採掘':'A term defined by the user, not invented by a model.'}});
    assert.equal(parsed.context?.domain,'my game v2');assert.equal(parsed.context?.goal,'Gather supplies');
    for(const context of [{domain:42},{domain:'x'.repeat(101)},{meaningConfirmed:'yes'},{optionDetails:{forged:'data'}},
      {optionDetails:{'採掘':'x'.repeat(501)}}])assert.ok(parseComparisonInput(['採掘','伐採'],'',context).error);
  });
  it('keeps identically named choices in different settings from contaminating each other',()=>{
    const pref=(key:string)=>({key,value:'Mining'} as Preference);
    const gameKey='learned.hobbies.scope.'+domainScope('My Game V2')+'.mining';
    const workKey='learned.hobbies.scope.'+domainScope('Real-world work')+'.mining';
    const prefs=[pref('hobby.mining'),pref(gameKey),pref(workKey)];
    assert.deepEqual(preferencesForDomain(prefs,'my game v2').map(p=>p.key),[gameKey]);
    assert.deepEqual(preferencesForDomain(prefs,'Everyday life').map(p=>p.key),['hobby.mining']);
    assert.equal(sameDecisionDomain({domain:'  My Game V2 '},'my game v2'),true);
    assert.equal(sameDecisionDomain({domain:'my game v2'},'real-world work'),false);
    assert.equal(sameDecisionDomain({},'everyday life'),true);
  });
});
