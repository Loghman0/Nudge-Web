import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {assessCriteria,parseCriteria,criteriaForOptions,type ComparisonCriterion} from '../src/lib/services/comparison-criteria';
import {parseComparisonInput} from '../src/lib/services/comparison-input';
import {DecideClient} from '../src/app/(app)/ask/decide-client';

const labels=['Walk','Bus'];
const time:ComparisonCriterion={id:'time',label:'Travel time',unit:'minutes',weight:3,direction:'lower',low:0,high:60,values:{Walk:{value:30},Bus:{value:15,sourceUrl:'https://example.invalid/timetable',note:'Synthetic fixture, not real timetable data'}}};
const context=(rows:ComparisonCriterion[]=[time])=>({comparisonBasis:'criteria' as const,criteria:rows,criteriaConfirmed:true,criteriaVersion:1 as const});
describe('explicit criteria and missing factual inputs',()=>{
  it('uses supplied ranges, reversed costs and weights without personal memory',()=>{
    const benefit:ComparisonCriterion={...time,id:'exercise',label:'Exercise',unit:'minutes',weight:1,direction:'higher',values:{Walk:{value:30},Bus:{value:0}}};
    const result=assessCriteria([time,benefit],labels);
    assert.equal(result.leader,'Bus');assert.equal(result.outcome,'winner');
    assert.equal(result.options.find(o=>o.label==='Walk')!.low,.5);
    assert.equal(result.options.find(o=>o.label==='Bus')!.low,.5625);
  });
  it('keeps blank values unknown and accepts measured zero as evidence',()=>{
    const row={...time,values:{Walk:{value:0},Bus:{value:null}}};
    const result=assessCriteria([row],labels);
    assert.equal(result.leader,null);assert.equal(result.outcome,'uncertain');
    assert.deepEqual(result.options.map(o=>[o.low,o.high,o.coverage]),[[1,1,1],[0,1,0]]);
    assert.match(result.options[1].reasons[0],/unknown/);
  });
  it('abstains on ties, reversals of input order and overlapping incomplete ranges',()=>{
    const equal={...time,values:{Walk:{value:20},Bus:{value:20}}};
    for(const order of [labels,[...labels].reverse()])assert.equal(assessCriteria([equal],order).outcome,'tie');
    const missing={...time,values:{Walk:{value:null},Bus:{value:null}}};
    assert.equal(assessCriteria([missing],labels).outcome,'uncertain');
    assert.deepEqual(assessCriteria([equal],labels).options.map(o=>o.label),labels);
    assert.equal(assessCriteria([{...time,values:{A:{value:10},B:{value:10},C:{value:20}}}],['A','B','C']).outcome,'tie');
  });
  it('can establish a leader despite small unknown weights, with uncertainty still visible',()=>{
    const known={...time,weight:5,values:{Walk:{value:0},Bus:{value:60}}};
    const unknown={...time,id:'other',weight:1,values:{Walk:{value:null},Bus:{value:null}}};
    const result=assessCriteria([known,unknown],labels);
    assert.equal(result.leader,'Walk');assert.equal(result.options[0].coverage,1-1/6);
    assert.equal(result.options[0].high,1);
  });
  it('rejects malformed ranges, weights, cells, versions and excess criteria',()=>{
    for(const patch of [{low:60,high:60},{low:NaN},{high:Infinity},{weight:0},{weight:1.1},{direction:'guess'},{label:''},{values:{Walk:{value:61}}},{values:{Walk:{value:''}}},{values:{Walk:{value:null,note:'x'.repeat(501)}}},{values:{Foreign:{value:3}}}])assert.ok(parseCriteria(context([{...time,...patch} as ComparisonCriterion]),labels).error,JSON.stringify(patch));
    for(const raw of [{...context(),criteriaVersion:2},{...context(),criteriaConfirmed:'yes'},context([]),context(Array(6).fill(time)),context([time,time])])assert.ok(parseCriteria(raw,labels).error);
  });
  it('accepts HTTPS references but never treats URLs or notes as measured values',()=>{
    for(const sourceUrl of ['javascript:alert(1)','http://example.com','https://user:pass@example.com','file:///tmp/fact'])assert.ok(parseCriteria(context([{...time,values:{Walk:{value:30,sourceUrl}}}]),labels).error);
    const parsed=parseCriteria(context([{...time,values:{Walk:{value:null,sourceUrl:'https://example.invalid',note:'Claim still unverified'}}}]),labels);
    assert.equal(parsed.value!.criteria![0].values.Walk.value,null);
    assert.equal(assessCriteria(parsed.value!.criteria!,labels).outcome,'uncertain');
  });
  it('allowlists server input, preserves Unicode and never carries a removed option into a copy',()=>{
    const parsed=parseComparisonInput(labels,'', {...context(),admin:true});
    assert.ok(parsed.context);assert.equal('admin' in parsed.context,false);
    const revised=criteriaForOptions([time],['Bus','採掘']);
    assert.deepEqual(Object.keys(revised[0].values),['Bus','採掘']);assert.equal(revised[0].values['採掘'].value,null);
    assert.ok(parseCriteria({...context(revised),criteriaConfirmed:false},['Bus','採掘']).value);
    assert.deepEqual(parseCriteria({},labels),{value:{}});
  });
  it('handles labels colliding with JavaScript object prototypes as ordinary unknown options',()=>{
    const parsed=parseCriteria(context([{...time,values:{}}]),['constructor','__proto__']);
    assert.ok(parsed.value);assert.equal(parsed.value.criteria![0].values['constructor'].value,null);
    assert.equal(Object.getPrototypeOf(parsed.value.criteria![0].values),Object.prototype,'React Server Components require plain records');
    assert.deepEqual(parsed.value,JSON.parse(JSON.stringify(parsed.value)),'The sanitized input must survive a server-to-client round trip');
    assert.equal(Object.hasOwn(parsed.value.criteria![0].values,'__proto__'),true);
    assert.equal(assessCriteria(parsed.value.criteria!,['constructor','__proto__']).outcome,'uncertain');
  });
  it('restores the criteria editor on copy and requires a fresh confirmation',()=>{
    const html=renderToStaticMarkup(createElement(DecideClient,{initialOptions:labels,seed:{options:labels,title:'Synthetic comparison',context:context()}}));
    assert.ok(html.includes('Your comparison criteria'));assert.ok(html.includes('value="30"'));assert.ok(html.includes('Source links and notes are saved'));
    assert.ok(!html.includes('checked=""'));
  });
  it('renders ranges and source provenance without journal rankings or false winners',()=>{
    const criteria=[{...time,values:{Walk:{value:30},Bus:{value:null,sourceUrl:'https://example.invalid/reference'}}}];
    const assessment=assessCriteria(criteria,labels);
    const html=renderToStaticMarkup(createElement(DecideClient,{initialOptions:[],initialResult:{decisionId:'00000000-0000-4000-8000-000000000001',title:'Synthetic criteria',category:'travel',status:'open',confidence:'low',coldStart:false,criteriaInput:context(criteria),criteriaAssessment:assessment,
      options:assessment.options.map(o=>({id:o.label,label:o.label,score:o.low,breakdown:{},warning:false,reasons:o.reasons}))}}));
    for(const text of ['0–100','Unknown values or overlapping ranges','unverified','Add as unknown','Copy and edit criteria'])assert.ok(html.includes(text),text);
    assert.ok(!html.includes('equal chances'));assert.ok(!html.includes('Roll the dice'));
    assert.ok(!html.includes('Leaning'));assert.ok(!html.includes('relative fit / 100'));assert.ok(!html.includes('Refresh with current memory'));
  });
});
