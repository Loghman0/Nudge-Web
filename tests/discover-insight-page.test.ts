import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const requireNative=createRequire(import.meta.url);
function page(file:string,signedIn=true){
 const calls:unknown[][]=[],patterns:unknown[][]=[],checks=()=>null;
 const modules:Record<string,unknown>={
  '@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:signedIn?{id:'owner'}:null}})}})},
  '@/lib/discover/loaders':{readVerifications:async(...args:unknown[])=>{calls.push(args);return [{id:'owned-check'}];},readEarlierPattern:async(...args:unknown[])=>{patterns.push(args);return {prefKey:'learned.food.soup',label:'Soup',evidence:3};}},
  '../discover-checks-client':{DiscoverChecksClient:checks},
  'next/navigation':{redirect:(path:string)=>{throw new Error('redirect:'+path);}},
 };
 const source=readFileSync(new URL('../src/app/(app)/discover/'+file,import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports:Record<string,any>={};vm.runInNewContext(compiled,{exports,require:(name:string)=>modules[name]??requireNative(name)});
 return {render:()=>exports.default(),calls,patterns,checks};
}
test('Legacy Discover links lead to the same Today question flow',async()=>{
 const h=page('page.tsx');assert.throws(h.render,/redirect:\/dashboard/);assert.equal(h.calls.length,0);
});
test('Earlier preference checks require authentication before personal reads',async()=>{
 const h=page('checks/page.tsx',false);await assert.rejects(h.render,/redirect:\/login/);assert.equal(h.calls.length,0);assert.equal(h.patterns.length,0);
});
test('Earlier checks retain an owner-scoped bounded review without competing question queues',async()=>{
 const h=page('checks/page.tsx');const tree=await h.render();assert.equal(h.calls.length,1);assert.equal(h.calls[0][1],'owner');assert.equal(h.calls[0][2],20);
 assert.equal(h.patterns.length,1);assert.equal(h.patterns[0][1],'owner');
 const children=[tree.props.children].flat(),check=children.find((child:any)=>child?.type===h.checks);assert.deepEqual(check.props.insight,{prefKey:'learned.food.soup',label:'Soup',evidence:3});assert.deepEqual(check.props.verifications,[{id:'owned-check'}]);
});
