import { describe,it } from 'node:test';
import assert from 'node:assert/strict';
import { isSameChoice,normalize } from '../src/lib/services/similarity';
import { preferencesForCategory } from '../src/lib/services/categories';
import { rankCandidates,reinforcementDelta,extractNamedOptions,tagsForNamedOption,reasonsFor } from '../src/lib/services/decision-engine';
import { firstRelated } from '../src/lib/services/relations';
import { toKeySegment } from '../src/lib/services/knowledge';
import { collectPages } from '../src/lib/services/pagination';
import { checkRateLimit } from '../src/lib/services/rate-limit';
import type { Preference } from '../src/lib/types';

describe('recommendation regressions',()=>{
  const pref=(key:string,overrides:Partial<Preference>={}):Preference=>({id:key,user_id:'u',key,value:'sushi',polarity:'like',strength:0.8,source:'reflected',evidence_count:3,...overrides});
  it('keeps learned preferences in their category including legacy graph metadata',()=>{
    const all=[pref('learned.food.sushi'),pref('learned.sushi',{category_slug:'food'}),pref('learned.health.sushi',{category_slug:'health'}),pref('diet.vegan'),pref('work.focus')];
    assert.deepEqual(preferencesForCategory(all,'food').map(p=>p.key),['learned.food.sushi','learned.sushi','diet.vegan']);
  });
  it('does not bias an option upward for a neutral preference',()=>{
    const [result]=rankCandidates([{label:'Sushi',tags:['food.sushi']}],[pref('food.sushi',{polarity:'neutral'})],[]);
    assert.equal(result.breakdown.preferenceMatch,0.5);
    assert.ok(!reasonsFor(result,[pref('food.sushi',{polarity:'neutral'})],[]).some(reason=>reason.includes('taste')));
  });
  it('matches whole preference phrases without reversing negation or dietary qualifiers',()=>{
    const tea=[pref('drink.tea',{value:'tea'})];
    for(const label of ['Steak','team lunch','steam rice','teapot','No tea','not tea','without tea','avoid tea','tea-free']) {
      assert.deepEqual(tagsForNamedOption(label,tea),[],label);
    }
    for(const label of ['Tea','green tea','iced tea','tea without sugar']) assert.deepEqual(tagsForNamedOption(label,tea),['drink.tea'],label);
    assert.deepEqual(tagsForNamedOption('sugar-free drink',[pref('food.sugar',{value:'sugar'})]),[]);
    assert.deepEqual(tagsForNamedOption('decaf coffee',[pref('drink.coffee',{value:'coffee'})]),[]);
    assert.deepEqual(tagsForNamedOption('vegan burger',[pref('food.burger',{value:'burger'})]),[]);
    assert.deepEqual(tagsForNamedOption('Hamburger',[pref('food.burger',{value:'burger'})]),['food.burger']);
    assert.deepEqual(tagsForNamedOption('çay',[pref('drink.cay',{value:'çay'})]),['drink.cay']);
    assert.deepEqual(tagsForNamedOption('No tea',[pref('drink.no-tea',{value:'No tea'})]),['drink.no-tea']);
  });
  it('preserves negation and meaningful variants',()=>{
    for(const [a,b] of [['Buy now','Do not buy now'],['Rent','Different'],['Black coffee','Decaf coffee'],['Vegan burger','Burger'],['Pizza','No pizza']]) assert.equal(isSameChoice(a,b),false,`${a}/${b}`);
    assert.equal(isSameChoice('Sushi','that sushi place'),true);
  });
  it('preserves non-English text and keeps distinct Unicode key identities',()=>{
    assert.equal(normalize('çay'),'cay');assert.equal(normalize('東京'),'東京');
    assert.notEqual(toKeySegment('東京'),toKeySegment('大阪'));
    assert.match(toKeySegment('東京'),/^[a-z0-9-]+$/);
    assert.notEqual(toKeySegment('a'.repeat(80)+'x'),toKeySegment('a'.repeat(80)+'y'));
  });
  it('can replay time-dependent scores with an explicit scoring timestamp',()=>{
    const history=[{decision:{id:'d',question:'Dinner',decided_at:'2026-10-01T00:00:00Z'},selectedLabel:'Sushi',reflection:null}];
    const candidates=[{label:'Sushi',tags:[]}];const at=Date.parse('2026-10-02T00:00:00Z');
    const a=rankCandidates(candidates,[],history,undefined,at);const b=rankCandidates(candidates,[],history,undefined,at);
    assert.deepEqual(a,b);assert.notEqual(a[0].score,rankCandidates(candidates,[],history,undefined,at+7*86400000)[0].score);
  });
  it('uses negative counterfactual feedback consistently',()=>{
    const feedback={decision_id:'d',rating:5,would_repeat:true,has_regrets:false,would_recommend:true,would_choose_again:false,notes:null};
    assert.ok(reinforcementDelta(feedback)<0);
    const [score]=rankCandidates([{label:'Sushi',tags:[]}],[],[{decision:{id:'d',question:'Dinner',decided_at:new Date().toISOString()},selectedLabel:'Sushi',reflection:feedback}]);
    assert.equal(score.breakdown.historySuccess,0.1);
  });
  it('parses more than two alternatives and normalizes to-one joins',()=>{
    assert.deepEqual(extractNamedOptions('pizza or sushi or ramen'),['pizza','sushi','ramen']);
    const reflection={rating:5};assert.equal(firstRelated(reflection)?.rating,5);assert.equal(firstRelated([reflection])?.rating,5);assert.equal(firstRelated([]),null);
  });
});

describe('export pagination',()=>{
  it('exports beyond a smaller deployment row cap without losing rows',async()=>{
    const source=Array.from({length:1105},(_,i)=>({id:i}));const offsets:number[]=[];
    const actual=await collectPages((a,b)=>{offsets.push(a);return Promise.resolve({data:source.slice(a,Math.min(b+1,a+75)),error:null});});
    assert.deepEqual(actual,source);assert.equal(offsets[1],75);
  });
  it('rejects a failed later page instead of returning a partial export',async()=>{
    await assert.rejects(collectPages(a=>Promise.resolve(a===0?{data:[1],error:null}:{data:null,error:new Error('database down')})),/export dataset/);
  });
});

it('does not clear hourly limits when a short-window sweep runs',()=>{
  const real=Date.now;const start=real();const user=`long-${start}`;
  try {
    Date.now=()=>start;assert.equal(checkRateLimit(user,'hourly',1,3600000).allowed,true);
    Date.now=()=>start+11*60000;checkRateLimit('short','explain',30,600000);
    assert.equal(checkRateLimit(user,'hourly',1,3600000).allowed,false);
  } finally { Date.now=real; }
});
