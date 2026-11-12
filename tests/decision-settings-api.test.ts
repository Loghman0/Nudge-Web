import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../src/lib/types/database';
import {createDecisionSettingsHandler} from '../src/lib/api/v1/decision-settings-route';
import {createFoundationHandler} from '../src/lib/api/v1/foundation-route';
const id='00000000-0000-4000-8000-000000000001',owner='00000000-0000-4000-8000-000000000002';
const setting={id,name:'Minecraft',domain:'minecraft survival 1.21',category:'hobbies',goal:'Gather materials',aliases:[{term:'mine',meaning:'Mine for iron'}],memory_generation:3,created_at:'2026-11-08T00:00:00Z',updated_at:'2026-11-08T00:00:00Z'};
const draft={id:null,name:' Materials ',domain:' Minecraft Survival 1.21 ',category:'hobbies',goal:' Gather materials ',aliases:[{term:' mine ',meaning:' Mine for iron '}],generation:3};
function request(method:string,value?:unknown,query=''){return new Request('https://nudge.test/api/v1/decision-settings'+query,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer fixture'},...(value===undefined?{}:{body:JSON.stringify(value)})});}
function fixture(options:{generation?:number;error?:{code?:string;message:string};denied?:boolean;rpcData?:unknown}={}){
 const calls:{name:string;args:unknown}[]=[];
 const db={rpc:async(name:string,args:unknown)=>{calls.push({name,args});return {data:options.rpcData??(name==='get_comparison_settings_state'?{generation:options.generation??3,settings:options.generation===4?[]:[setting]}:name==='save_comparison_setting'?id:null),error:options.error??null};}} as unknown as SupabaseClient<Database>;
 const auth=async()=>options.denied?{ok:false as const,status:401 as const,code:'unauthenticated' as const,message:'Not signed in.'}:{ok:true as const,client:db,userId:owner};
 return {calls,handler:createDecisionSettingsHandler(auth)};
}
describe('native saved comparison settings adapter',()=>{
 it('returns the current owner-scoped RPC state and verifies generation before applying',async()=>{
  const h=fixture(),list=await h.handler(request('GET'));assert.equal(list.status,200);assert.match(list.headers.get('cache-control')??'',/private.*no-store/);
  assert.equal((await list.json()).state.settings[0].id,id);assert.deepEqual(h.calls,[{name:'get_comparison_settings_state',args:undefined}]);
  const found=await h.handler(request('GET',undefined,`?id=${id}&generation=3`));assert.equal(found.status,200);assert.equal((await found.json()).setting.domain,setting.domain);
  const stale=fixture({generation:4});assert.equal((await stale.handler(request('GET',undefined,`?id=${id}&generation=3`))).status,409);
 });
 it('canonicalizes explicit fields using the existing web parser and preserves generation',async()=>{
  const h=fixture(),saved=await h.handler(request('POST',draft));assert.equal(saved.status,200);assert.deepEqual(await saved.json(),{saved:true,id});
  assert.deepEqual(h.calls,[{name:'save_comparison_setting',args:{p_id:null,p_name:'Materials',p_domain:'minecraft survival 1.21',p_category:'hobbies',p_goal:'Gather materials',p_aliases:[{term:'mine',meaning:'Mine for iron'}],p_generation:3}}]);
 });
 it('rejects caller identity, unknown fields, duplicate terms and malformed apply queries before write',async()=>{
  for(const input of [{...draft,user_id:owner},{...draft,values:{mine:3}},{...draft,generation:-1},{...draft,aliases:[{term:'Mine stone',meaning:'One'},{term:' Mine  stone ',meaning:'Other'}]}]){
   const h=fixture();assert.equal((await h.handler(request('POST',input))).status,400);assert.equal(h.calls.length,0);
  }
  for(const query of [`?id=${id}`,`?id=${id}&generation=-1`,`?id=${id}&generation=3&generation=4`,`?user_id=${owner}`]){const h=fixture();assert.equal((await h.handler(request('GET',undefined,query))).status,400);assert.equal(h.calls.length,0);}
 });
 it('only sends an owner-bound id and observed generation for delete, with no guessed idempotency',async()=>{
  const h=fixture();assert.equal((await h.handler(request('DELETE',{id,generation:3}))).status,200);assert.deepEqual(h.calls,[{name:'delete_comparison_setting',args:{p_id:id,p_generation:3}}]);
  const invalid=fixture();assert.equal((await invalid.handler(request('DELETE',{id,generation:3,userId:owner}))).status,400);assert.equal(invalid.calls.length,0);
 });
 it('checks auth before RPC and sanitizes uncertain/generation/limit errors',async()=>{
  const denied=fixture({denied:true});assert.equal((await denied.handler(request('GET'))).status,401);assert.equal(denied.calls.length,0);
  for(const [error,status] of [[{message:'Your memory changed'},409],[{code:'23505',message:'private constraint'},409],[{message:'Private database connection'},503]] as const){const h=fixture({error});const response=await h.handler(request('POST',draft));assert.equal(response.status,status);assert.doesNotMatch(JSON.stringify(await response.json()),/Private database|private constraint/);}
 });
 it('rejects streamed oversized JSON and a malformed state rather than exposing partial results',async()=>{
  const h=fixture();assert.equal((await h.handler(request('POST',{...draft,name:'é'.repeat(40000)}))).status,413);assert.equal(h.calls.length,0);
  const malformed=fixture({rpcData:{generation:3,settings:[{...setting,memory_generation:2}]}});assert.equal((await malformed.handler(request('GET'))).status,503);
 });
});
function foundationFixture(options:{generation?:number;writeError?:string;questions?:number;denied?:boolean}={}){
 const rows=Array.from({length:options.questions??6},(_,i)=>({id:`00000000-0000-4000-8000-${String(i+10).padStart(12,'0')}`,prompt:'Everyday choice '+i,option_a:'A',option_b:'B',context:{starterRationale:'Situation only.'}}));
 const calls:{name:string;args:unknown}[]=[];const filters:unknown[][]=[];
 function from(table:string){const result={data:table==='profiles'?{onboarded_at:null,memory_generation:3}:table==='questions'?rows:[],error:null};const chain={select:()=>chain,eq:(...args:unknown[])=>{filters.push([table,...args]);return chain;},order:()=>chain,limit:()=>Promise.resolve(result),single:()=>Promise.resolve(result),in:()=>Promise.resolve(result)};return chain;}
 const db={from,rpc:async(name:string,args:unknown)=>{calls.push({name,args});return {data:options.generation??3,error:options.writeError?{message:options.writeError}:null};}} as unknown as SupabaseClient<Database>;
 const auth=async()=>options.denied?{ok:false as const,status:401 as const,code:'unauthenticated' as const,message:'Not signed in.'}:{ok:true as const,client:db,userId:owner};
 return {handler:createFoundationHandler(auth),rows,calls,filters};
}
describe('optional legacy foundation adapter',()=>{
 it('reads only the active foundation edition and owner answers/milestones without writing',async()=>{
  const h=foundationFixture(),response=await h.handler(request('GET'));assert.equal(response.status,200);const result=await response.json();assert.equal(result.available,true);assert.equal(result.questions.length,6);assert.equal(result.completed,false);assert.equal(result.questions[0].saved,null);assert.equal(h.calls.length,0);
  assert.ok(h.filters.some(row=>row.join('|')==='questions|context->>foundationEdition|1'));assert.ok(h.filters.some(row=>row.join('|')===`question_answers|user_id|${owner}`));
 });
 it('saves only reviewed catalog answers and does not erase existing profile basics',async()=>{
  const h=foundationFixture(),input={expectedGeneration:3,answers:[{questionId:h.rows[0].id,answer:'a'},{questionId:h.rows[1].id,answer:'skip'}]};
  const response=await h.handler(request('POST',input));assert.equal(response.status,200);assert.deepEqual(await response.json(),{saved:true,generation:3});assert.deepEqual(h.calls,[{name:'complete_onboarding',args:{p_profile:{},p_answers:input.answers,p_expected_generation:3}}]);
 });
 it('rejects unknown/foreign starter ids, duplicates and extra account fields without write',async()=>{
  for(const kind of ['foreign','duplicate','account']){const h=foundationFixture(),answer={questionId:h.rows[0].id,answer:'a'};const input=kind==='foreign'?{expectedGeneration:3,answers:[{...answer,questionId:id}]}:kind==='duplicate'?{expectedGeneration:3,answers:[answer,answer]}:{expectedGeneration:3,answers:[answer],fullName:'Overwrite'};
   assert.equal((await h.handler(request('POST',input))).status,kind==='foreign'?409:400);assert.equal(h.calls.length,0);
  }
 });
 it('does not mark setup complete when catalog is missing and maps stale generations',async()=>{
  const missing=foundationFixture({questions:5}),read=await missing.handler(request('GET'));assert.equal((await read.json()).available,false);assert.equal((await missing.handler(request('POST',{expectedGeneration:3,answers:[]}))).status,409);assert.equal(missing.calls.length,0);
  const stale=foundationFixture({writeError:'Memory changed. Please reload onboarding'});assert.equal((await stale.handler(request('POST',{expectedGeneration:2,answers:[]}))).status,409);
  const denied=foundationFixture({denied:true});assert.equal((await denied.handler(request('GET'))).status,401);assert.equal(denied.filters.length,0);
 });
});
