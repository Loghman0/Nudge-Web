import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {decisionScopeError} from '../src/lib/services/decision-scope';
import {isRequestId,parseComparisonInput} from '../src/lib/services/comparison-input';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
describe('ordinary decision scope',()=>{
 it('routes explicit crisis, treatment, allergy, essential-money and legal commitments away from rankings',()=>{
  for(const input of ['Should I stop medication or double my dose?','Take insulin or skip it?','I have chest pain, should I wait?','I am allergic to peanuts, eat them or not?','Invest all my savings in crypto or pay rent?','Gamble with rent money or borrow money?','Sign a settlement or waive my rights?','Meet my violent partner or go home?','Should I hurt myself?']){
   assert.ok(decisionScopeError(input),input);
  }
 });
 it('keeps ordinary choices and professional appointment scheduling usable',()=>{
  for(const input of ['Pizza or sushi?','Gym or a walk?','Buy a book or wait?','Save for a holiday or buy a phone?','Book a doctor appointment on Monday or Tuesday?','Take the course or ask for feedback?','Call my partner or write a message?']){
   assert.equal(decisionScopeError(input),null,input);
  }
 });
 it('the refresh action checks additional options and the saved question before scoring or writing',async()=>{
  const source=readFileSync(new URL('../src/lib/services/comparison-service.ts',import.meta.url),'utf8');
  const start=source.indexOf('export async function refreshSavedComparison');
  const body=stripTypeScriptTypes(source.slice(start,source.indexOf('function comparisonWriteConflict',start))).replace('export async function','async function');
  let clients=0;let loaded=0;let question='Dinner';let savedContext={};let expectedOutcome:string|undefined;
  const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:{question,category:'food',context:savedContext,expected_outcome:expectedOutcome,comparison_revision:1,status:'open',decision_options:[{id:'a',label:'Soup',rank:1},{id:'b',label:'Pizza',rank:2}]},error:null})};
  const context=vm.createContext({isRequestId,decisionScopeError,createClient:async()=>{
   return {auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from:()=>{clients++;return chain;}};
  },loadMemory:async()=>{loaded++;throw new Error('Scoring must not start');}});
  vm.runInContext(body+'\nglobalThis.run=async (...args)=>refreshSavedComparison(await createClient(), "owner", ...args);',context);
  const id='00000000-0000-4000-8000-000000000001';
  assert.match((await context.run(id,{})).error,/invalid/);assert.equal(clients,0);
  assert.match((await context.run(id,'Take insulin')).error,/Medication/);assert.equal(loaded,0);
  question='Should I double my medication?';
  assert.match((await context.run(id)).error,/Medication/);assert.equal(loaded,0);
  question='Dinner';
  for(const detail of [{domain:'Take insulin'}, {goal:'Should I double my medication?'}, {optionDetails:{Soup:'Take insulin'}}]){
   savedContext=detail;
   assert.match((await context.run(id)).error,/Medication/);assert.equal(loaded,0);
  }
  savedContext={};expectedOutcome='Take insulin';
  assert.match((await context.run(id)).error,/Medication/);assert.equal(loaded,0);
 });
 it('checks confirmed setting, goal and option details before creating a comparison',async()=>{
  const source=readFileSync(new URL('../src/lib/services/comparison-service.ts',import.meta.url),'utf8');
  const start=source.indexOf('export async function createComparison');
  const body=stripTypeScriptTypes(source.slice(start,source.indexOf('export async function loadSavedComparison',start))).replace('export async function','async function');
  const context=vm.createContext({parseComparisonInput,isRequestId,decisionScopeError,createClient:async()=>{throw new Error('Must reject before loading or writing memory');}});
  vm.runInContext(body+'\nglobalThis.run=(...args)=>createComparison({}, "owner", ...args);',context);
  for(const detail of [{domain:'Take insulin'}, {domain:'Everyday life',goal:'Take insulin'}, {domain:'Everyday life',optionDetails:{Soup:'Double my dose'}}]){
   const result=await context.run(['Soup','Pizza'],'Dinner',{...detail,meaningConfirmed:true});
   assert.match(result.error,/Medication/);
  }
 });
 it('keeps the old explanation action free of provider, quota and database work',async()=>{
  const source=readFileSync(new URL('../src/app/(app)/ask/actions.ts',import.meta.url),'utf8');
  const body=stripTypeScriptTypes(source.slice(source.indexOf('export async function explainDecision'))).replace('export async function','async function');
  const context=vm.createContext({getAi:()=>{throw new Error('Must not call AI');},createClient:()=>{throw new Error('Must not load memory');}});
  vm.runInContext(body+'\nglobalThis.run=explainDecision;',context);
  assert.equal(await context.run('00000000-0000-4000-8000-000000000001'),null);
 });
});
