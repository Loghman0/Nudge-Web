import {it} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../src/lib/types/database';
import type {MonthlySummaryInput} from '../src/lib/services/ai/provider';
import {generateOwnerRecap} from '../src/lib/services/monthly-recap';
import {POLICY_VERSION} from '../src/lib/legal/config';
const now=Date.parse('2026-11-10T12:00:00Z');
function fixture(options:{count?:number;off?:boolean;queryError?:boolean;reserve?:boolean;allowed?:boolean;changeAt?:number;output?:unknown;timeout?:boolean}={}){
 let reads=0,reservations=0,providerCalls=0;const queries:{table:string;operations:[string,...unknown[]][]}[]=[],inputs:MonthlySummaryInput[]=[];
 const rows=Array.from({length:options.count??3},(_,i)=>({user_id:'owner',id:String(i).padStart(5,'0'),question:`Question ${i}`,category:i%2?'work':'food',status:'decided',decided_at:new Date(now-i*1000).toISOString(),selected_option_id:'selected',decision_options:[{id:'selected',label:'My choice'}],decision_reflections:i===0?{rating:5,has_regrets:null}:i===1?[{rating:3,has_regrets:true}]:null}));
 const all=[...rows,{...rows[0],user_id:'other',question:'Private other owner'},{...rows[0],decided_at:new Date(now+1).toISOString(),question:'Future'}];
 const db={from(table:string){const operations:[string,...unknown[]][]=[],query={table,operations};queries.push(query);
  const q:any={};for(const method of ['select','eq','gte','lte','in','order','limit'])q[method]=(...args:unknown[])=>{operations.push([method,...args]);return q;};
  q.single=async()=>{reads++;return {error:null,data:{ai_enabled:!options.off,memory_generation:options.changeAt&&reads>=options.changeAt?2:1,terms_version:POLICY_VERSION}};};
  q.then=(resolve:(v:unknown)=>unknown)=>{let selected=[...all];for(const [method,key,value] of operations){if(method==='eq')selected=selected.filter(row=>(row as any)[key as string]===value);if(method==='gte')selected=selected.filter(row=>(row as any)[key as string]>=String(value));if(method==='lte')selected=selected.filter(row=>(row as any)[key as string]<=String(value));if(method==='in')selected=selected.filter(row=>(value as string[]).includes((row as any)[key as string]));if(method==='limit')selected=selected.slice(0,key as number);}return Promise.resolve(resolve({error:options.queryError?{code:'failure'}:null,data:selected}));};return q;
 }} as unknown as SupabaseClient<Database>;
 const dependencies={now:()=>now,deadlineMs:5,allowed:()=>options.allowed!==false,reserve:async()=>{reservations++;return options.reserve!==false;},provider:async()=>({summarizeMonth:async(input:MonthlySummaryInput)=>{providerCalls++;inputs.push(input);if(options.timeout)return new Promise<string>(()=>{});return (options.output===undefined?' A bounded recap. ':options.output) as string;}})};
 return {db,dependencies,queries,inputs,get counts(){return {reads,reservations,providerCalls};}};
}
it('scopes and bounds the rolling window, normalizes object/array/null relations, and sends no raw reflection notes',async()=>{
 const h=fixture(),result=await generateOwnerRecap(h.db,'owner',h.dependencies);assert.equal(result.text,'A bounded recap.');assert.equal(result.sampleSize,3);assert.equal(result.sampled,false);assert.equal(result.asOf,new Date(now).toISOString());assert.equal(Date.parse(result.asOf!)-Date.parse(result.windowStart!),30*86400000);
 const q=h.queries.find(q=>q.table==='decisions')!;assert.ok(q.operations.some(op=>op[0]==='eq'&&op[1]==='user_id'&&op[2]==='owner'));assert.deepEqual(q.operations.filter(op=>op[0]==='order'),[['order','decided_at',{ascending:false}],['order','id']]);assert.ok(q.operations.some(op=>op[0]==='limit'&&op[1]===101));
 assert.equal(h.inputs[0].totalDecisions,3);assert.equal(h.inputs[0].averageRating,4);assert.equal(h.inputs[0].bestRated.length,1);assert.deepEqual(h.inputs[0].regretted,[{question:'Question 1',chosen:'My choice'}]);assert.ok(!JSON.stringify(h.inputs).includes('Private other owner'));assert.ok(!JSON.stringify(h.inputs).includes('Future'));assert.equal(h.counts.reservations,1);assert.equal(h.counts.providerCalls,1);
});
it('marks newest100 as a sample only when the 101st row exists',async()=>{
 for(const count of [100,101,105]){const h=fixture({count}),result=await generateOwnerRecap(h.db,'owner',h.dependencies);assert.equal(result.sampleSize,100);assert.equal(result.sampled,count>100);assert.equal(h.inputs[0].totalDecisions,100);assert.equal(h.inputs[0].sampled,count>100);}
});
it('does not reserve or generate without consent, enough data, or successful backing reads',async()=>{
 for(const [options,reason] of [[{off:true},'off'],[{count:2},'no_data'],[{queryError:true},'failed']] as const){const h=fixture(options);assert.equal((await generateOwnerRecap(h.db,'owner',h.dependencies)).reason,reason);assert.equal(h.counts.reservations,0);assert.equal(h.counts.providerCalls,0);}
});
it('blocks instance/durable capacity and discards privacy changes before or after the provider',async()=>{
 for(const options of [{allowed:false},{reserve:false}]){const h=fixture(options);assert.equal((await generateOwnerRecap(h.db,'owner',h.dependencies)).reason,'capacity');assert.equal(h.counts.providerCalls,0);}
 for(const changeAt of [2,3,4]){const h=fixture({changeAt});assert.equal((await generateOwnerRecap(h.db,'owner',h.dependencies)).reason,'changed');assert.equal(h.counts.providerCalls,changeAt===4?1:0);}
});
it('fails closed on unavailable provider, blank/oversized/non-string output and deadline',async()=>{
 const off=fixture();assert.equal((await generateOwnerRecap(off.db,'owner',{...off.dependencies,provider:async()=>null})).reason,'unavailable');assert.equal(off.counts.reservations,0);
 for(const output of ['', 'x'.repeat(6001),{}]){const h=fixture({output});assert.equal((await generateOwnerRecap(h.db,'owner',h.dependencies)).reason,'failed');}
 const slow=fixture({timeout:true});assert.equal((await generateOwnerRecap(slow.db,'owner',slow.dependencies)).reason,'timed_out');assert.equal(slow.counts.providerCalls,1);
});
