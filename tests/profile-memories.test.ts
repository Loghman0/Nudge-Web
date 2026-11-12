import { describe,it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/types/database';
import type { AiProvider } from '../src/lib/services/ai/provider';
import { queryProfileMemories } from '../src/lib/services/profile-memories';
import { extractProfileMemories,confirmProfileMemoryReview } from '../src/lib/services/profile-memory-intake';
import { parseMemoryReview } from '../src/lib/services/profile-memory-review';
import { POLICY_VERSION } from '../src/lib/legal/config';

describe('profile extracted-memory queries',()=>{
  it('uses verified owner scope, literal search, stable ordering and a one-row lookahead',async()=>{
    const calls:unknown[][]=[];
    const rows=Array.from({length:21},(_,i)=>({id:String(i),content:`Memory ${i}`,kind:'fact',confidence:.8,created_at:'2026-10-15T00:00:00Z'}));
    const chain={select:(...v:unknown[])=>{calls.push(['select',...v]);return chain;},eq:(...v:unknown[])=>{calls.push(['eq',...v]);return chain;},ilike:(...v:unknown[])=>{calls.push(['ilike',...v]);return chain;},order:(...v:unknown[])=>{calls.push(['order',...v]);return chain;},range:async(...v:unknown[])=>{calls.push(['range',...v]);return {data:rows,error:null};}};
    const db={from:(table:string)=>{assert.equal(table,'ai_memories');return chain;}} as unknown as SupabaseClient<Database>;
    const page=await queryProfileMemories(db,'verified-owner','50%_\\',20);
    assert.equal(page.memories.length,20);assert.equal(page.hasMore,true);
    assert.deepEqual(calls.filter(c=>c[0]==='eq'),[['eq','user_id','verified-owner']]);
    assert.deepEqual(calls.filter(c=>c[0]==='order'),[['order','created_at',{ascending:false}],['order','id',{ascending:true}]]);
    assert.deepEqual(calls.find(c=>c[0]==='range'),['range',20,40]);
    assert.deepEqual(calls.find(c=>c[0]==='ilike'),['ilike','content','%50\\%\\_\\\\%']);
  });
  it('rejects malformed bounds before issuing a query',async()=>{
    const db={from:()=>{throw new Error('Must not query');}} as unknown as SupabaseClient<Database>;
    for(const offset of [-1,NaN,Infinity,1.5,1_000_001])assert.ok((await queryProfileMemories(db,'owner','',offset)).error);
    assert.ok((await queryProfileMemories(db,'owner','x'.repeat(81))).error);
  });
});

function intakeHarness({enabled=true,quota=true,saved=1,generation=7,afterGeneration=generation,afterEnabled=enabled,terms=POLICY_VERSION,saveError=false,saveCode}:{enabled?:boolean;quota?:boolean;saved?:number;generation?:number;afterGeneration?:number;afterEnabled?:boolean;terms?:string;saveError?:boolean;saveCode?:string}={}){
  const calls:unknown[][]=[];let extracted=0;
  const db={from:(table:string)=>({select:(columns:string)=>({eq:(field:string,id:string)=>({single:async()=>{calls.push(['profile',table,columns,field,id]);return {data:{ai_enabled:extracted?afterEnabled:enabled,memory_generation:extracted?afterGeneration:generation,terms_version:terms},error:null};}})})}),
    rpc:async(name:string,args:unknown)=>{calls.push([name,args]);return {data:name==='reserve_ai_request'?quota:saved,error:name==='save_reviewed_memories'&&(saveError||saveCode)?{code:saveCode,message:'PRIVATE DATABASE ERROR'}:null};}
  } as unknown as SupabaseClient<Database>;
  const provider={extractMemories:async(text:string,options?:{signal?:AbortSignal})=>{extracted++;calls.push(['extract',text]);assert.equal(options?.signal?.aborted,false);return [{kind:'goal',content:'Walk more',confidence:.8,user_id:'forged'}];}} as unknown as AiProvider;
  return {db,provider,calls,extracted:()=>extracted};
}
describe('explicit optional profile notes',()=>{
  it('sends explicit text after consent/quota and returns a temporary generation-bound draft without saving',async()=>{
    const h=intakeHarness();assert.deepEqual(await extractProfileMemories(h.db,'owner','  I want to walk more.  ',h.provider),{draft:{generation:7,suggestions:[{kind:'goal',content:'Walk more'}]}});
    assert.equal(h.extracted(),1);
    const reserve=h.calls.findIndex(c=>c[0]==='reserve_ai_request'),extract=h.calls.findIndex(c=>c[0]==='extract');assert.ok(reserve>=0&&reserve<extract);
    assert.deepEqual(h.calls.find(c=>c[0]==='extract'),['extract','I want to walk more.']);
    assert.ok(!h.calls.some(c=>c[0]==='save_ai_memories'||c[0]==='save_reviewed_memories'));
  });
  it('never invokes the provider when consent is off, quota fails, provider is absent or input is invalid',async()=>{
    for(const configuration of [{enabled:false},{quota:false}]){const h=intakeHarness(configuration);assert.ok((await extractProfileMemories(h.db,'owner','I walk daily.',h.provider)).error);assert.equal(h.extracted(),0);}
    const h=intakeHarness();assert.ok((await extractProfileMemories(h.db,'owner','I walk daily.',null)).error);
    for(const text of [null,{},'', 'x'.repeat(2001)])assert.ok((await extractProfileMemories(h.db,'owner',text,h.provider)).error);
    assert.equal(h.extracted(),0);
  });
  it('discards suggestions when privacy changes during the provider request',async()=>{
    for(const settings of [{afterGeneration:8},{afterEnabled:false}]){
      const h=intakeHarness(settings),result=await extractProfileMemories(h.db,'owner','I walk daily.',h.provider);
      assert.equal(result.stale,true);assert.match(result.error!,/Nothing was saved/);assert.equal(result.draft,undefined);
      assert.ok(!h.calls.some(c=>c[0]==='save_reviewed_memories'));
    }
  });
  it('handles provider failures and malformed output without issuing a save',async()=>{
    for(const extractMemories of [async()=>{throw new Error('offline');},async()=>[{kind:'admin',content:'Injected',confidence:1}]]){
      const h=intakeHarness();const provider={extractMemories} as unknown as AiProvider;
      const result=await extractProfileMemories(h.db,'owner','I walk daily.',provider);
      assert.ok(result.error);assert.doesNotMatch(result.error!,/offline|Injected/);
      assert.ok(!h.calls.some(c=>c[0]==='save_ai_memories'));
    }
  });
});

const review={requestId:'00000000-0000-4000-8000-000000000001',generation:7,reviewed:true,memories:[{kind:'habit',content:'  Walk twice a week  '}]} as const;
describe('reviewed profile-memory confirmation',()=>{
  it('saves only selected edited user statements with a stable request and generation, without a provider request',async()=>{
    const h=intakeHarness(),result=await confirmProfileMemoryReview(h.db,'verified-owner',review);
    assert.deepEqual(result,{saved:1});assert.equal(h.extracted(),0);
    assert.deepEqual(h.calls.find(c=>c[0]==='save_reviewed_memories'),['save_reviewed_memories',{p_request_id:review.requestId,p_memories:[{kind:'habit',content:'Walk twice a week'}],p_generation:7}]);
    assert.ok(!h.calls.some(c=>c[0]==='reserve_ai_request'||c[0]==='extract'||c[0]==='save_ai_memories'));
    assert.ok(h.calls.filter(c=>c[0]==='profile').every(c=>c[4]==='verified-owner'));
  });
  it('requires explicit review, a request UUID, a valid generation, bounded fields and nonempty selection',async()=>{
    const invalid=[{...review,reviewed:false},{...review,requestId:'bad'},{...review,generation:NaN},{...review,memories:[]},{...review,memories:Array(7).fill(review.memories[0])},
      {...review,memories:[{kind:'diagnosis',content:'Unsupported'}]},{...review,memories:[{kind:'fact',content:'x'.repeat(301)}]},
      {...review,memories:[{kind:'fact',content:'',confidence:.95}]},{...review,user_id:'forged'},
      {...review,memories:[{kind:'fact',content:'Same thing'},{kind:'fact',content:' same  THING '}]}];
    for(const raw of invalid){
      assert.ok(parseMemoryReview(raw).error);const h=intakeHarness();assert.ok((await confirmProfileMemoryReview(h.db,'owner',raw)).error);assert.equal(h.calls.length,0);
    }
  });
  it('refuses old drafts after generation, consent or terms change before saving',async()=>{
    for(const settings of [{generation:8},{enabled:false},{terms:'old'}]){
      const h=intakeHarness(settings),result=await confirmProfileMemoryReview(h.db,'owner',review);
      assert.equal(result.stale,true);assert.equal(result.saved,undefined);assert.ok(!h.calls.some(c=>c[0]==='save_reviewed_memories'));assert.equal(h.extracted(),0);
    }
  });
  it('handles an atomic generation race or save failure without leaking database errors or claiming success',async()=>{
    const stale=intakeHarness({saved:0}),result=await confirmProfileMemoryReview(stale.db,'owner',review);
    assert.equal(result.stale,true);assert.equal(result.saved,undefined);
    for(const code of ['PT409','40001']){
      const race=intakeHarness({saveCode:code}),atomic=await confirmProfileMemoryReview(race.db,'owner',review);
      assert.equal(atomic.stale,true);assert.equal(atomic.saved,undefined);assert.doesNotMatch(atomic.error!,/PRIVATE DATABASE ERROR/);
      assert.equal(race.calls.filter(call=>call[0]==='save_reviewed_memories').length,1);
      assert.equal(race.extracted(),0);
    }
    const failed=intakeHarness({saveError:true}),error=await confirmProfileMemoryReview(failed.db,'owner',review);
    assert.ok(error.error);assert.doesNotMatch(error.error!,/PRIVATE DATABASE ERROR/);assert.equal(error.saved,undefined);
  });
});
