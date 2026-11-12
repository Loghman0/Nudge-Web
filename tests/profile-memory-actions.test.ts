import { describe,it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function harness({signedIn=true,stale=false}={}){
  const source=readFileSync(new URL('../src/app/(app)/profile/actions.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const calls:unknown[][]=[],invalidations:string[]=[];
  const client={auth:{getUser:async()=>({data:{user:signedIn?{id:'verified-owner'}:null}})}};
  const provider={name:'accounted-provider'};
  const modules:Record<string,unknown>={
    'next/cache':{revalidatePath:(path:string)=>invalidations.push(path)},
    '@/lib/supabase/server':{createClient:async()=>client},
    '@/lib/services/profile-memories':{queryProfileMemories:()=>{throw new Error('Not used');}},
    '@/lib/services/profile-memory-intake':{
      extractProfileMemories:async(...args:unknown[])=>{calls.push(['extract',...args]);return {draft:{generation:7,suggestions:[{kind:'goal',content:'Walk more'}]}};},
      confirmProfileMemoryReview:async(...args:unknown[])=>{calls.push(['confirm',...args]);return stale?{stale:true,error:'Your memory changed'}:{saved:1};},
    },
    '@/lib/services/ai/accounting':{getAccountedAi:async(...args:unknown[])=>{calls.push(['accounting',...args]);return provider;}},
  };
  const exports:Record<string,any>={};
  vm.runInNewContext(compiled,{exports,require:(name:string)=>{assert.ok(Object.hasOwn(modules,name),name);return modules[name];}});
  return {actions:exports,calls,invalidations,client,provider};
}
describe('verified profile memory action boundaries',()=>{
  it('binds explicit draft extraction to the verified caller and accounted provider without route revalidation or saving',async()=>{
    const h=harness(),result=await h.actions.addProfileNotes('Explicit notes');
    assert.ok(result.draft);assert.equal(result.saved,undefined);
    assert.deepEqual(h.calls,[['accounting',h.client,'verified-owner','extract'],['extract',h.client,'verified-owner','Explicit notes',h.provider]]);
    assert.deepEqual(h.invalidations,[]);
  });
  it('confirms for the verified caller without accounting/provider work and refreshes memory display only after success',async()=>{
    const input={requestId:'00000000-0000-4000-8000-000000000001',generation:7,reviewed:true,memories:[{kind:'goal',content:'Walk more'}]};
    const h=harness();assert.deepEqual(await h.actions.confirmProfileMemories(input),{saved:1});
    assert.deepEqual(h.calls,[['confirm',h.client,'verified-owner',input]]);assert.deepEqual(h.invalidations,['/profile','/dashboard']);
    const stale=harness({stale:true});assert.equal((await stale.actions.confirmProfileMemories(input)).stale,true);assert.deepEqual(stale.invalidations,[]);
  });
  it('does no extraction, confirmation, provider or invalidation work for signed-out sessions',async()=>{
    const h=harness({signedIn:false});
    assert.match((await h.actions.addProfileNotes('Explicit notes')).error,/Not signed in/);
    assert.match((await h.actions.confirmProfileMemories({})).error,/Not signed in/);
    assert.deepEqual(h.calls,[]);assert.deepEqual(h.invalidations,[]);
  });
});
