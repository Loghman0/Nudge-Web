import { describe,it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { recordKnowledgeSignal } from '../src/lib/services/knowledge';
import * as discoverLoaders from '../src/lib/discover/loaders';

const plain=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const initialPattern={id:'00000000-0000-4000-8000-000000000001',key:'learned.food.soup',value:'Soup',category_slug:'food',polarity:'like',source:'inferred',status:'active',evidence_count:3,metadata:{}};
function harness(options:{signedIn?:boolean;pattern?:Record<string,unknown>|null;generation?:number|null;readError?:boolean;rpcError?:boolean;signalResult?:string|null}={}){
  const source=readFileSync(new URL('../src/app/(app)/discover/actions.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const queries:{table:string;operations:unknown[][]}[]=[],calls:{name:string;args:Record<string,unknown>}[]=[],invalidations:string[]=[];let creates=0;
  const client={auth:{getUser:async()=>({data:{user:options.signedIn===false?null:{id:'verified-owner'}}})},
    from:(table:string)=>{
      const query={table,operations:[] as unknown[][]};queries.push(query);
      const data=table==='knowledge_nodes'?(options.pattern===undefined?initialPattern:options.pattern):options.generation===null?null:{memory_generation:options.generation??7};
      const result={data,error:options.readError?{message:'Private database diagnostics'}:null};
      const chain:Record<string,any>={then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>Promise.resolve(result).then(resolve,reject)};
      for(const method of ['select','eq','maybeSingle','single'])chain[method]=(...args:unknown[])=>{query.operations.push([method,...args]);return chain;};
      return chain;
    },
    rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args:plain(args)});return {data:name==='record_knowledge_signal'?(options.signalResult===undefined?initialPattern.id:options.signalResult):null,error:options.rpcError?{message:'Private database diagnostics'}:null};},
  };
  const modules:Record<string,unknown>={
    'next/cache':{revalidatePath:(path:string)=>invalidations.push(path)},
    '@/lib/supabase/server':{createClient:async()=>{creates++;return client;}},
    '@/lib/services/knowledge':{recordKnowledgeSignal},'@/lib/discover/types':{discoverTopic:()=>null},
    '@/lib/discover/loaders':discoverLoaders,
  };
  const exports:Record<string,any>={};
  vm.runInNewContext(compiled,{exports,require:(name:string)=>{assert.ok(Object.hasOwn(modules,name),name);return modules[name];},console:{error:()=>{}}});
  return {action:exports.confirmInsight,calls,queries,invalidations,creates:()=>creates};
}

describe('owned Discover pattern confirmation',()=>{
  it('clears a rejected inferred like through neutral correction, never an invented dislike signal',async()=>{
    const h=harness();assert.deepEqual(plain(await h.action(initialPattern.key,false)),{});
    assert.deepEqual(h.calls,[{name:'correct_knowledge_node',args:{p_node_id:initialPattern.id,p_polarity:'neutral',p_note:'I did not confirm this inferred preference in Discover.'}}]);
    assert.deepEqual(h.invalidations,['/discover','/discover/checks','/profile','/dashboard']);
  });
  it('confirms the current owner node using its real label/category and captured privacy generation',async()=>{
    const h=harness();assert.deepEqual(plain(await h.action(initialPattern.key,true)),{});
    assert.deepEqual(h.calls,[{name:'record_knowledge_signal',args:{p_key:initialPattern.key,p_value:'Soup',p_category_slug:'food',p_polarity:'like',p_source:'explicit',p_weight:.5,p_kind:'confirmation',p_source_decision_id:null,p_source_question_id:null,p_verified:true,p_detail:{confirmed:true},p_expected_generation:7}}]);
    for(const query of h.queries)assert.ok(query.operations.some(op=>JSON.stringify(op)===JSON.stringify(['eq',query.table==='profiles'?'id':'user_id','verified-owner'])));
    const node=h.queries.find(query=>query.table==='knowledge_nodes')!;
    for(const op of [['eq','key',initialPattern.key],['eq','status','active']])assert.ok(node.operations.some(value=>JSON.stringify(value)===JSON.stringify(op)));
  });
  it('rejects forged or malformed confirmations before creating a database client',async()=>{
    const h=harness();
    for(const [key,answer] of [[null,false],['',true],['food.soup',null],['food.soup','false'],['food.soup',0],['food.soup',{}],['other owner',true],['a'.repeat(257),true]]){
      assert.match((await h.action(key,answer)).error,/valid pattern/);
    }
    assert.equal(h.creates(),0);assert.deepEqual(h.calls,[]);assert.deepEqual(h.queries,[]);
  });
  it('requires verified authentication before reading or mutating patterns',async()=>{
    const h=harness({signedIn:false});assert.match((await h.action(initialPattern.key,false)).error,/sign in/i);
    assert.deepEqual(h.queries,[]);assert.deepEqual(h.calls,[]);assert.deepEqual(h.invalidations,[]);
  });
  it('does not create unknown patterns or overwrite forgotten, scoped, low-evidence or explicitly corrected nodes',async()=>{
    for(const pattern of [null,{...initialPattern,status:'forgotten'},{...initialPattern,source:'explicit'},
      {...initialPattern,source:'ai_extracted'},{...initialPattern,source:'imported'},
      {...initialPattern,polarity:'dislike'},{...initialPattern,polarity:'neutral'},{...initialPattern,evidence_count:1},
      {...initialPattern,key:'learned.food.scope.game.soup'},{...initialPattern,metadata:{manual_polarity:'neutral'}}]){
      for(const answer of [false,true]){const h=harness({pattern});assert.match((await h.action(initialPattern.key,answer)).error,/changed|available/);assert.deepEqual(h.calls,[]);assert.deepEqual(h.invalidations,[]);}
    }
  });
  it('preserves server-owned categories for both supported pattern sources',async()=>{
    for(const source of ['inferred','reflected']){
      const h=harness({pattern:{...initialPattern,source,category_slug:'hobbies',value:'Chess'}});assert.deepEqual(plain(await h.action(initialPattern.key,true)),{});
      assert.equal(h.calls[0].args.p_category_slug,'hobbies');assert.equal(h.calls[0].args.p_value,'Chess');
    }
  });
  it('fails closed on missing generation or read errors without leaking diagnostics',async()=>{
    for(const options of [{generation:null},{generation:-1},{readError:true}]){
      const h=harness(options);const result=await h.action(initialPattern.key,false);assert.ok(result.error);assert.ok(!result.error.includes('Private'));assert.deepEqual(h.calls,[]);assert.deepEqual(h.invalidations,[]);
    }
  });
  it('keeps failed corrections and generation-rejected confirmations retryable without success invalidations',async()=>{
    const rejected=harness({signalResult:null});assert.match((await rejected.action(initialPattern.key,true)).error,/Reload Discover/);assert.deepEqual(rejected.invalidations,[]);assert.equal(rejected.calls.length,1);
    const failed=harness({rpcError:true});const result=await failed.action(initialPattern.key,false);assert.match(result.error,/Reload Discover/);assert.ok(!result.error.includes('Private'));assert.deepEqual(failed.invalidations,[]);assert.equal(failed.calls.length,1);
  });
});
