import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {parseComparisonInput,isRequestId} from '../src/lib/services/comparison-input';
import {guessDecisionCategory} from '../src/lib/services/comparison-category';
describe('comparison action input boundary',()=>{
 it('rejects malformed and unbounded serialized values',()=>{
  for(const options of [null,{},[null],['A',{}],Array(9).fill('A'),['A','x'.repeat(81)]])assert.ok(parseComparisonInput(options,'',{}).error);
  for(const context of [null,[],{category:'constructor'},{mood:{}},{expectedOutcome:'x'.repeat(301)}])assert.ok(parseComparisonInput(['A','B'],'',context).error);
  assert.ok(parseComparisonInput(['A','B'],{},{}).error);
 });
 it('returns a bounded allowlisted intent and distinct trimmed options',()=>{
  assert.deepEqual(parseComparisonInput([' Soup ','Pizza',' '],' Dinner ',{category:'food',mood:' Relaxed ',admin:true}),{options:['Soup','Pizza'],title:'Dinner',context:{mood:'Relaxed',category:'food'}});
  assert.ok(parseComparisonInput(['Soup',' soup '],'',{}).error);
 });
 it('rejects duplicate names before keyed details or criteria can be discarded',()=>{
  for(const options of [['Tea','Tea','Coffee'],['Tea','tea','Coffee'],['Tea',' Tea ','Coffee'],['Tea','tea']]){
   const optionDetails=Object.fromEntries(options.map(label=>[label.trim(),'A separate definition for '+label]));
   for(const extra of [{},{comparisonBasis:'criteria',criteria:[]}])
    assert.equal(parseComparisonInput(options,'',{optionDetails,...extra}).error,'Each option needs a different name. Rename or remove duplicate options.');
  }
 });
 it('accepts only UUID request identifiers',()=>{
  assert.equal(isRequestId('00000000-0000-4000-8000-000000000001'),true);
  for(const value of [null,'a','00000000-0000-0000-0000-000000000000',{}])assert.equal(isRequestId(value),false);
 });
 it('strictly bounds a transient applied-setting privacy marker',()=>{
  const marker={id:'00000000-0000-4000-8000-000000000001',generation:2};
  assert.deepEqual(parseComparisonInput(['A','B'],'',{appliedSetting:marker}).context?.appliedSetting,marker);
  for(const appliedSetting of [null,[],{}, {...marker,generation:'2'},{...marker,generation:-1},{...marker,generation:2.5},{...marker,id:'invalid'},{...marker,notes:'private'}])
    assert.ok(parseComparisonInput(['A','B'],'',{appliedSetting}).error);
 });
 it('does not classify substrings as food or entertainment and recognizes financial tradeoffs',()=>{
  assert.equal(guessDecisionCategory(['team meeting','finish task']),'work');
  assert.equal(guessDecisionCategory(['shower','rest']),'other');
  assert.equal(guessDecisionCategory(['Should I rent or buy?']),'finance');
  assert.equal(guessDecisionCategory(['Tea','Coffee']),'food');
 });
});
