import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/types/database';
import { createComparisonPostHandler, createComparisonRefreshPostHandler, COMPARISON_CREATE_MAX_BYTES } from '../src/lib/api/v1/comparison-route';
import { createApiAuthenticator } from '../src/lib/api/v1/auth';
import { createComparison, loadSavedComparison, refreshSavedComparison, type CompareResult, type ComparisonErrorCode } from '../src/lib/services/comparison-service';
import { draftUnderstanding } from '../src/lib/services/decision-understanding';

const id='00000000-0000-4000-8000-000000000001',requestId='00000000-0000-4000-8000-000000000002';
const url='https://nudge.test/api/v1/decisions';
const payload={requestId,options:['Pasta','Curry'],title:'Dinner',context:{domain:'Everyday life',meaningConfirmed:true,category:'food'}};
const saved:CompareResult={decisionId:id,title:'Dinner',category:'food',confidence:'low',coldStart:true,status:'open',revision:1,options:[]};
function request(raw:unknown=payload,extra:Record<string,string>={}) {
  return new Request(url,{method:'POST',headers:{origin:'https://nudge.test','content-type':'application/json',...extra},body:JSON.stringify(raw)});
}
function fixture(options:{user?:boolean;requireTerms?:boolean;terms?:string;result?:CompareResult;throws?:boolean}={}) {
  const calls:unknown[][]=[];let cookies=0;const tokens:unknown[]=[];
  const profile={select:()=>profile,eq:()=>profile,maybeSingle:async()=>({data:{terms_version:options.terms??'current'},error:null})};
  const client={auth:{getUser:async(token?:string)=>{tokens.push(token);return{data:{user:options.user===false?null:{id:'verified-owner'}},error:null};}},from:()=>profile} as unknown as SupabaseClient<Database>;
  const authenticate=createApiAuthenticator({cookieClient:async()=>{cookies++;return client;},bearerClient:()=>client},{requireCurrentTerms:options.requireTerms??false,policyVersion:'current'});
  const execute=async(...args:unknown[])=>{calls.push(args);if(options.throws)throw new Error('Private database secret');return options.result??saved;};
  return {client,calls,tokens,get cookies(){return cookies;},post:createComparisonPostHandler({authenticate,create:execute}),refresh:createComparisonRefreshPostHandler({authenticate,refresh:execute})};
}
async function body(response:Response) {
  assert.match(response.headers.get('cache-control')??'',/private.*no-store/);assert.equal(response.headers.get('pragma'),'no-cache');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('access-control-allow-origin'),null);
  const value=await response.json();assert.equal(value.apiVersion,'1');assert.doesNotMatch(JSON.stringify(value),/Private database/);return value;
}

describe('confirmed comparison creation API',()=>{
  it('transports a reviewed discovery suggestion reference without allowing forged provenance fields',async()=>{
    const criterion={id:'time',label:'Room in the schedule',unit:'hours',weight:3,direction:'higher',low:0,high:10,values:{Pasta:{value:8},Curry:{value:2}},discoverySuggestion:{id:'reviewed-source',generation:2}};
    const context={...payload.context,comparisonBasis:'criteria',criteriaConfirmed:true,criteriaVersion:1,criteria:[criterion]};
    const h=fixture();assert.equal((await h.post(request({...payload,context}))).status,200);
    assert.deepEqual((h.calls[0][4] as typeof context).criteria[0].discoverySuggestion,criterion.discoverySuggestion);
    for(const reference of [{id:'reviewed-source',generation:2,userId:'forged'},{id:'reviewed-source',generation:-1},{id:'reviewed-source',generation:2,sourceIds:['forged']}]){
      const denied=fixture();assert.equal((await denied.post(request({...payload,context:{...context,criteria:[{...criterion,discoverySuggestion:reference}]}}))).status,400);assert.equal(denied.calls.length,0);
    }
  });
  it('uses the verified session, stable request identity and canonical confirmed inputs without accepting scoring fields',async()=>{
    const h=fixture();const response=await h.post(request({...payload,options:[' Pasta ','Curry'],title:' Dinner '}));
    assert.equal(response.status,200);assert.deepEqual((await body(response)).data.comparison,saved);
    assert.equal(h.calls[0][0],h.client);assert.equal(h.calls[0][1],'verified-owner');
    assert.deepEqual(h.calls[0].slice(2),[['Pasta','Curry'],'Dinner',{category:'food',domain:'everyday life',meaningConfirmed:true},requestId]);
    assert.equal((await h.post(request())).status,200);assert.equal(h.calls[1][5],requestId);
  });
  it('rejects forged identities, unknown nested data, invalid options and unconfirmed settings or criteria before saving',async()=>{
    const malformed=[null,[],{}, {...payload,requestId:'not-a-uuid'}, {...payload,user_id:'foreign'}, {...payload,requestIntent:{}},
      {...payload,context:{...payload.context,confidence:'high'}},{...payload,context:{...payload.context,meaningConfirmed:false}},
      {...payload,context:{...payload.context,domain:''}},{...payload,options:['Only one']},
      {...payload,context:{...payload.context,comparisonBasis:'criteria',criteriaConfirmed:false,criteria:[]}},
      {...payload,context:{...payload.context,criteria:[{id:'x',values:{Pasta:{value:1,invented:true}}}]}}];
    for(const raw of malformed){const h=fixture(),response=await h.post(request(raw));assert.equal(response.status,400);await body(response);assert.equal(h.calls.length,0);}
  });
  it('bounds actual streamed UTF-8 bytes and hides parsing diagnostics',async()=>{
    const cases:[Request,number][]=[
      [request(payload,{'content-type':'text/plain'}),415],
      [request(payload,{'content-length':String(COMPARISON_CREATE_MAX_BYTES+1)}),413],
      [request({...payload,title:'é'.repeat(COMPARISON_CREATE_MAX_BYTES/2+1)},{'content-length':'1'}),413],
      [new Request(url,{method:'POST',headers:{origin:'https://nudge.test','content-type':'application/json'},body:'{'}),400],
    ];
    for(const [raw,status]of cases){const h=fixture(),response=await h.post(raw);assert.equal(response.status,status);await body(response);assert.equal(h.calls.length,0);}
  });
  it('enforces same-origin cookies, bearer precedence and current terms on comparison writes',async()=>{
    for(const origin of [null,'https://foreign.test','null']){
      const h=fixture(),raw=request();if(origin===null)raw.headers.delete('origin');else raw.headers.set('origin',origin);
      assert.equal((await h.post(raw)).status,403);assert.equal(h.cookies,0);assert.equal(h.calls.length,0);
    }
    const native=fixture(),raw=request(payload,{authorization:'Bearer native-token'});raw.headers.delete('origin');
    assert.equal((await native.post(raw)).status,200);assert.equal(native.cookies,0);assert.deepEqual(native.tokens,['native-token']);
    const invalid=fixture();assert.equal((await invalid.post(request(payload,{authorization:'Bearer a b'}))).status,401);assert.equal(invalid.cookies,0);
    const old=fixture({requireTerms:true,terms:'old'}),denied=await old.post(request());assert.equal(denied.status,403);assert.equal((await body(denied)).error.code,'needs_terms');assert.equal(old.calls.length,0);
  });
  it('distinguishes safe conflicts and unconfirmed completion without exposing thrown diagnostics',async()=>{
    for(const [code,status]of [['invalid_input',400],['needs_confirmation',400],['forbidden',403],['conflict',409],['not_found',404],['unavailable',503]] as const){
      const h=fixture({result:{...saved,error:'Safe failure',errorCode:code}}),response=await h.post(request());assert.equal(response.status,status);assert.equal((await body(response)).error.code,code);
    }
    const h=fixture({throws:true}),response=await h.post(request());assert.equal(response.status,503);assert.match((await body(response)).error.message,/same requestId/);
  });
});

describe('revision-bound comparison refresh API',()=>{
  it('binds the URL, verified owner and observed revision while leaving new criterion values unknown',async()=>{
    const h=fixture(),response=await h.refresh(request({revision:1,extraLabel:'Bike'}),{params:Promise.resolve({id})});
    assert.equal(response.status,200);await body(response);assert.deepEqual(h.calls[0],[h.client,'verified-owner',id,'Bike',1]);
  });
  it('rejects missing revisions, caller identifiers and oversize extra options before service work',async()=>{
    for(const raw of [null,{}, {revision:'1'},{revision:-1},{revision:1.5},{revision:1,user_id:'foreign'},{revision:1,extraLabel:''},{revision:1,extraLabel:'x'.repeat(81)}]){
      const h=fixture(),response=await h.refresh(request(raw),{params:Promise.resolve({id})});assert.equal(response.status,400);await body(response);assert.equal(h.calls.length,0);
    }
    const invalid=fixture();assert.equal((await invalid.refresh(request({revision:1}),{params:Promise.resolve({id:'bad'})})).status,400);assert.equal(invalid.calls.length,0);
    const large=fixture(),response=await large.refresh(request({revision:1,extraLabel:'é'.repeat(520)},{'content-length':'1'}),{params:Promise.resolve({id})});assert.equal(response.status,413);assert.equal(large.calls.length,0);
  });
});

describe('shared comparison service guards',()=>{
  it('keeps missing confirmation and invalid stored identities free of database or provider work',async()=>{
    const db={from:()=>{throw new Error('Must not read');},rpc:()=>{throw new Error('Must not write');}} as unknown as SupabaseClient<Database>;
    assert.equal((await createComparison(db,'owner',['Pasta','Curry'],'Dinner',{})).errorCode,'needs_confirmation');
    assert.equal((await createComparison(db,'owner',['Pasta','Curry'],'Dinner',{domain:'Take insulin',meaningConfirmed:true})).errorCode,'forbidden');
    assert.equal(await loadSavedComparison(db,'owner','bad-id'),null);
  });
  it('rejects stale revisions, foreign/missing decisions and closed records before scoring or writes',async()=>{
    for(const [row,code]of [[null,'not_found'],[{status:'decided',comparison_revision:1},'conflict'],[{status:'open',comparison_revision:2},'conflict']] as const){
      const filters:unknown[][]=[];let writes=0;
      const chain={select:()=>chain,eq:(...args:unknown[])=>{filters.push(args);return chain;},maybeSingle:async()=>({data:row,error:null})};
      const db={from:()=>chain,rpc:async()=>{writes++;throw new Error('Must not write');}} as unknown as SupabaseClient<Database>;
      const result=await refreshSavedComparison(db,'verified-owner',id,undefined,1);assert.equal(result.errorCode,code);assert.equal(writes,0);assert.deepEqual(filters,[['id',id],['user_id','verified-owner']]);
    }
  });
  it('validates refresh IDs and observed revisions before accessing records',async()=>{
    const db={from:()=>{throw new Error('Must not read');}} as unknown as SupabaseClient<Database>;
    for(const revision of [-1,1.5,NaN])assert.equal((await refreshSavedComparison(db,'owner',id,undefined,revision)).errorCode,'invalid_input');
  });
});

describe('production comparison API wiring',()=>{
  it('transports literal option-keyed details and criteria as bounded JSON without losing prototype-like keys',async()=>{
    const source=readFileSync(new URL('../src/app/(app)/ask/actions.ts',import.meta.url),'utf8');
    const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const context=JSON.parse('{"domain":"Synthetic world","optionDetails":{"__proto__":"Literal task"},"criteria":[{"values":{"__proto__":{"value":20}}}]}');
    let reads=0;
    const modules:Record<string,unknown>={
      '@/lib/supabase/server':{createClient:async()=>{reads++;return {auth:{getUser:async()=>({data:{user:{id:'owner'}}})}};}},
      '@/lib/services/comparison-service':{createComparison:async(_db:unknown,_owner:string,_options:unknown,_title:unknown,received:unknown)=>{
        assert.deepEqual(JSON.parse(JSON.stringify(received)),context);return {...saved,criteriaInput:received};
      }},
    };
    const exports:Record<string,any>={};vm.runInNewContext(code,{exports,TextEncoder,require:(name:string)=>modules[name]??{}});
    for(const invalid of ['{','x'.repeat(512*1024+1)]){
      const result=JSON.parse(await exports.compareOptionsTransport(['constructor','__proto__'],'',invalid));
      assert.equal(result.errorCode,'invalid_input');assert.equal(reads,0);
    }
    const result=JSON.parse(await exports.compareOptionsTransport(['constructor','__proto__'],'',JSON.stringify(context)));
    assert.equal(result.criteriaInput.optionDetails.__proto__,'Literal task');
    assert.equal(result.criteriaInput.criteria[0].values.__proto__.value,20);
    assert.equal(Object.getPrototypeOf(result.criteriaInput.optionDetails),Object.prototype);
  });
  it('opens typed-option context review even when optional AI configuration throws',async()=>{
    const source=readFileSync(new URL('../src/app/(app)/ask/actions.ts',import.meta.url),'utf8');
    const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const client={auth:{getUser:async()=>({data:{user:{id:'owner'}}})}};
    const modules:Record<string,unknown>={
      '@/lib/supabase/server':{createClient:async()=>client},
      '@/lib/services/ai/accounting':{getAccountedAi:async()=>{throw new Error('Optional provider unavailable');}},
      '@/lib/services/decision-understanding':{draftUnderstanding},
      '@/lib/services/comparison-service':{createComparison:async(db:unknown,owner:string,labels:string[],title:string,_context:unknown,_requestId:unknown,_intent:unknown,clarify:(text:string,labels:string[])=>unknown)=>{
        assert.equal(db,client);assert.equal(owner,'owner');return {clarification:await clarify(title,labels)};
      }},
    };
    const exports:Record<string,any>={};vm.runInNewContext(code,{exports,require:(name:string)=>modules[name]??{}});
    const result=await exports.compareOptions(['Blue room','Moon run'],'');
    assert.deepEqual(result.clarification.options,['Blue room','Moon run']);
    assert.equal(result.clarification.domain,'');assert.equal(result.clarification.source,'manual');
  });
  it('uses read-only auth only for GET and normal write auth for both POST routes',()=>{
    for(const [path,expected]of [['../src/app/api/v1/decisions/route.ts',[[true],[]]],['../src/app/api/v1/decisions/[id]/comparison/route.ts',[[]]]] as const){
      const source=readFileSync(new URL(path,import.meta.url),'utf8'),calls:unknown[][]=[];
      const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
      const authenticate=()=>{};const modules:Record<string,unknown>={
        '@/lib/api/v1/server-auth':{serverApiAuthenticator:(...args:unknown[])=>{calls.push(args);return authenticate;}},
        '@/lib/api/v1/journal-route':{createJournalGetHandler:(auth:unknown)=>auth},
        '@/lib/api/v1/comparison-route':{createComparisonPostHandler:({authenticate:auth}:{authenticate:unknown})=>auth,createComparisonRefreshPostHandler:({authenticate:auth}:{authenticate:unknown})=>auth},
      };const exports:Record<string,unknown>={};vm.runInNewContext(code,{exports,require:(name:string)=>modules[name]});
      assert.deepEqual(calls,expected);assert.equal(exports.POST,authenticate);assert.equal(exports.dynamic,'force-dynamic');
    }
  });
});
