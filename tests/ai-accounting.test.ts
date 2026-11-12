import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/types/database';
import { usdToMicros, readAiAccountingConfig, ratedCostMicros } from '../src/lib/services/ai/accounting-config';
import { createAiAccounting, getAccountedAi } from '../src/lib/services/ai/accounting';
import { exportAiUsage } from '../src/lib/services/ai/export-usage';
import type { AiAttemptResult, AiProvider } from '../src/lib/services/ai/provider';
import { createOpenAiCompatibleProvider } from '../src/lib/services/ai/openai-compatible';
import { POLICY_VERSION } from '../src/lib/legal/config';

const price={provider:'custom',model:'synthetic-model',inputUsdPerMillion:'1.25',outputUsdPerMillion:'2.5',maxAttemptUsd:'0.02',maxInputBytes:4000,maxOutputTokens:600};
const env={NUDGE_AI_USER_DAILY_USD:'0.1',NUDGE_AI_GLOBAL_DAILY_USD:'1',NUDGE_AI_MODEL_PRICES_JSON:JSON.stringify([price])};
const config=readAiAccountingConfig(env)!;
const descriptor={provider:'custom',model:'synthetic-model',inputBytes:400,outputTokenLimit:600};
const result:AiAttemptResult={...descriptor,status:'succeeded',httpStatus:200,usage:{inputTokens:120,outputTokens:50,totalTokens:170}};
function ledger(reserved=true,finished=true){
  const calls:{name:string;args:Record<string,unknown>}[]=[];
  return {calls,client:{rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return {data:name==='reserve_ai_usage_attempt'?[{reserved,reason:'synthetic'}]:finished,error:null};}} as unknown as SupabaseClient<Database>};
}
describe('server AI accounting policy',()=>{
  it('refuses free development endpoint configuration in public mode before account or provider access',async()=>{
    const client={from:()=>assert.fail('Must stop before reading account data')} as unknown as SupabaseClient<Database>;
    const dependencies={env:{...env,NUDGE_AI_DEVELOPMENT_FREE:'true',NUDGE_PUBLIC_LAUNCH:'true'},
      get provider():AiProvider{throw new Error('Must stop before resolving a provider');},ledger:ledger().client};
    assert.equal(await getAccountedAi(client,'owner','extract',dependencies),null);
  });
  it('requires explicit decimal prices and ceilings without guessing rates or rounding budgets up',()=>{
    assert.equal(usdToMicros('0.000001'),1);assert.equal(usdToMicros('1.250001'),1250001);
    for(const bad of [1.25,'1e2','-1','0.0000001',' 1','NaN'])assert.equal(usdToMicros(bad),null);
    assert.equal(readAiAccountingConfig({}),null);
    for(const row of [{...price,inputUsdPerMillion:'unknown'},{...price,maxAttemptUsd:'0.000001'},{...price,maxInputBytes:0}])
      assert.equal(readAiAccountingConfig({...env,NUDGE_AI_MODEL_PRICES_JSON:JSON.stringify([row])}),null);
    assert.equal(readAiAccountingConfig({...env,NUDGE_AI_MODEL_PRICES_JSON:JSON.stringify([price,price])}),null);
    assert.equal(ratedCostMicros(1,0,config.models[0]),2,'round fractional microdollars up');
    assert.equal(ratedCostMicros(-1,0,config.models[0]),null);
  });
  it('reserves before an attempt and settles reported tokens at the captured rates without journal text',async()=>{
    const db=ledger();const accounting=createAiAccounting(db.client,'owner',7,'interpret',config);
    const id=await accounting.reserve(descriptor);assert.ok(id);
    await accounting.finish(id!,result);
    assert.deepEqual(db.calls.map(c=>c.name),['reserve_ai_usage_attempt','finish_ai_usage_attempt']);
    assert.equal(db.calls[0].args.p_memory_generation,7);assert.equal(db.calls[0].args.p_max_cost_micros,20000);
    assert.equal(db.calls[1].args.p_actual_cost_micros,275);
    assert.deepEqual(Object.keys(db.calls[1].args).sort(),['p_actual_cost_micros','p_input_tokens','p_outcome','p_output_tokens','p_request_id','p_user_id']);
    assert.match(String(id),/^[a-f0-9-]{36}$/);
  });
  it('keeps unknown usage and uncertain cache pricing as liabilities',async()=>{
    const db=ledger();const accounting=createAiAccounting(db.client,'owner',1,'extract',config);
    for(const usage of [{inputTokens:null,outputTokens:null,totalTokens:null},{inputTokens:20,outputTokens:10,totalTokens:30,costMayDiffer:true}]){
      const id=await accounting.reserve(descriptor);await accounting.finish(id!,{...result,status:'aborted',usage});
      assert.equal(db.calls.at(-1)!.args.p_actual_cost_micros,null);assert.equal(db.calls.at(-1)!.args.p_outcome,'failed');
    }
  });
  it('denies unknown models, oversize payloads, underquoted attempts and unavailable budgets',async()=>{
    const db=ledger();const accounting=createAiAccounting(db.client,'owner',1,'recap',config);
    for(const attempt of [{...descriptor,model:'other'},{...descriptor,inputBytes:4001},{...descriptor,outputTokenLimit:601}])assert.equal(await accounting.reserve(attempt),null);
    assert.equal(db.calls.length,0);
    const limited=ledger(false);assert.equal(await createAiAccounting(limited.client,'owner',1,'recap',config).reserve(descriptor),null);
    const underquoted={...config,models:[{...config.models[0],maxAttemptMicros:1}]};
    assert.equal(await createAiAccounting(db.client,'owner',1,'recap',underquoted).reserve(descriptor),null);assert.equal(db.calls.length,0);
  });
  it('refuses unverified settlement and failed acknowledgements',async()=>{
    const db=ledger(true,false);const accounting=createAiAccounting(db.client,'owner',1,'recap',config);
    await assert.rejects(accounting.finish('invented',result),/verified/);
    const id=await accounting.reserve(descriptor);
    await assert.rejects(accounting.finish(id!,{...result,model:'other'}),/verified/);
    await assert.rejects(accounting.finish(id!,result),/completed/);
  });
  it('binds every task to one verified owner and overrides caller-supplied accounting',async()=>{
    const db=ledger();let seen:unknown;
    const provider={name:'synthetic',extractMemories:async(_text:string,options:unknown)=>{seen=options;return [];}} as unknown as AiProvider;
    const client={from:()=>({select:()=>({eq:()=>({single:async()=>({data:{ai_enabled:true,memory_generation:9,terms_version:POLICY_VERSION},error:null})})})})} as unknown as SupabaseClient<Database>;
    const bound=await getAccountedAi(client,'owner','extract',{provider,ledger:db.client,env});assert.ok(bound);
    const forged={reserve:async()=>null,finish:async()=>{}};
    const signal=new AbortController().signal;await bound!.extractMemories('synthetic',{signal,accounting:forged});
    assert.equal((seen as {signal:AbortSignal}).signal,signal);assert.notEqual((seen as {accounting:unknown}).accounting,forged);
    assert.equal(await getAccountedAi(client,'owner','extract',{provider,ledger:db.client,env:{}}),null);
  });
  it('rejects withdrawn consent, reset memory or changed terms after a metered recap without returning output or retrying',async()=>{
    const originalFetch=globalThis.fetch;
    try{
      for(const changed of [{ai_enabled:false},{memory_generation:8},{terms_version:'outdated'},{readError:true},{throwRead:true}]){
        const db=ledger();let profileReads=0,wireCalls=0;
        const client={from:(table:string)=>{
          assert.equal(table,'profiles');return {select:()=>({eq:(field:string,id:string)=>{
            assert.equal(field,'id');assert.equal(id,'verified-owner');
            return {single:async()=>{
              profileReads++;
              if(profileReads>1){
                assert.equal(db.calls.at(-1)?.name,'finish_ai_usage_attempt','Wire usage must settle before a stale response is discarded.');
                if('throwRead' in changed)throw new Error('PRIVATE ACCOUNT TRANSPORT FAILURE');
                if('readError' in changed)return {data:null,error:{message:'PRIVATE ACCOUNT FAILURE'}};
              }
              return {data:{ai_enabled:true,memory_generation:7,terms_version:POLICY_VERSION,...(profileReads>1?changed:{})},error:null};
            }};
          }})};
        }} as unknown as SupabaseClient<Database>;
        globalThis.fetch=async()=>{wireCalls++;return Response.json({choices:[{message:{content:'PRIVATE SYNTHETIC RECAP CONTENT'}}],usage:{prompt_tokens:120,completion_tokens:50,total_tokens:170}});};
        const provider=createOpenAiCompatibleProvider({name:'custom',baseUrl:'https://synthetic.invalid/v1',apiKey:'synthetic',model:'synthetic-model',maxTokens:600});
        const bound=await getAccountedAi(client,'verified-owner','recap',{provider,ledger:db.client,env});assert.ok(bound);
        await assert.rejects(bound!.summarizeMonth({windowDays:30,totalDecisions:1,topCategories:[],bestRated:[],regretted:[],averageRating:null}),error=>{
          assert.ok(error instanceof Error);assert.match(error.message,/response was discarded/);assert.doesNotMatch(error.message,/PRIVATE/);return true;
        });
        assert.equal(wireCalls,1);assert.equal(profileReads,2);
        assert.deepEqual(db.calls.map(call=>call.name),['reserve_ai_usage_attempt','finish_ai_usage_attempt']);
        assert.equal(db.calls[0].args.p_user_id,'verified-owner');assert.equal(db.calls[0].args.p_memory_generation,7);
        assert.equal(db.calls[1].args.p_input_tokens,120);assert.equal(db.calls[1].args.p_output_tokens,50);assert.equal(db.calls[1].args.p_actual_cost_micros,275);
      }
    }finally{globalThis.fetch=originalFetch;}
  });
  it('returns a recap only after rechecking the same current owner generation, consent and terms',async()=>{
    let reads=0,calls=0;
    const client={from:()=>({select:()=>({eq:(field:string,id:string)=>{
      assert.equal(field,'id');assert.equal(id,'verified-owner');return {single:async()=>{reads++;return {data:{ai_enabled:true,memory_generation:7,terms_version:POLICY_VERSION},error:null};}};
    }})})} as unknown as SupabaseClient<Database>;
    const provider={name:'synthetic',summarizeMonth:async()=>{calls++;return 'A bounded synthetic recap.';}} as unknown as AiProvider;
    const bound=await getAccountedAi(client,'verified-owner','recap',{provider,ledger:ledger().client,env});assert.ok(bound);
    assert.equal(await bound!.summarizeMonth({windowDays:30,totalDecisions:0,topCategories:[],bestRated:[],regretted:[],averageRating:null}),'A bounded synthetic recap.');
    assert.equal(calls,1);assert.equal(reads,2);
  });
  it('rejects missing initial consent, terms or valid generation before invoking a provider',async()=>{
    let calls=0;
    const provider={name:'synthetic',summarizeMonth:async()=>{calls++;return 'Must not be returned';}} as unknown as AiProvider;
    for(const changed of [{ai_enabled:false},{terms_version:'old'},{memory_generation:-1},{memory_generation:1.5},{terms_version:null}]){
      const client={from:()=>({select:()=>({eq:()=>({single:async()=>({data:{ai_enabled:true,memory_generation:7,terms_version:POLICY_VERSION,...changed},error:null})})})})} as unknown as SupabaseClient<Database>;
      assert.equal(await getAccountedAi(client,'owner','recap',{provider,ledger:ledger().client,env}),null);
    }
    assert.equal(calls,0);
  });
});

describe('private AI usage export',()=>{
  it('paginates small hosted row caps and labels a pending migration explicitly',async()=>{
    const offsets:number[]=[];const rows=Array.from({length:5},(_,n)=>({request_id:String(n)}));
    const db={rpc:()=>({range:async(from:number)=>{offsets.push(from);return {data:rows.slice(from,from+2),error:null};}})} as unknown as SupabaseClient<Database>;
    const exported=await exportAiUsage(db);assert.equal(exported.available,true);assert.equal(exported.records.length,5);assert.deepEqual(offsets,[0,2,4,5]);
    const pending={rpc:()=>({range:async()=>({data:null,error:{code:'PGRST202'}})})} as unknown as SupabaseClient<Database>;
    assert.deepEqual(await exportAiUsage(pending),{available:false,records:[]});
  });
  it('fails a complete export on later database errors instead of hiding them as no usage',async()=>{
    const db={rpc:()=>({range:async(from:number)=>from===0?{data:[{}],error:null}:{data:null,error:{code:'failed'}}})} as unknown as SupabaseClient<Database>;
    await assert.rejects(exportAiUsage(db),/export dataset/);
  });
});
