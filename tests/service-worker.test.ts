import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe,it } from 'node:test';
import assert from 'node:assert/strict';
function worker(){
  const handlers: Record<string,(event:any)=>void>={};const deleted:string[]=[];const puts:string[]=[];
  const context=vm.createContext({URL,
    self:{location:{origin:'https://nudge.test'},addEventListener:(name:string,fn:any)=>handlers[name]=fn,clients:{claim:async()=>{}},skipWaiting:async()=>{}},
    caches:{keys:async()=>['nudge-v1','nudge-public-v2','nudge-public-v3','unrelated'],delete:async(k:string)=>{deleted.push(k)},open:async()=>({addAll:async()=>{},put:async(r:any)=>puts.push(r.url)}),match:async(url:any)=>url==='/offline.html'?{offline:true}:undefined},
    fetch:async()=>{throw new Error('offline')},
  });
  vm.runInContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),context);
  return {handlers,deleted,puts};
}
describe('private cache protection',()=>{
  it('purges old Nudge caches without removing unrelated application caches',async()=>{
    const w=worker();let pending!:Promise<void>;w.handlers.activate({waitUntil:(p:Promise<void>)=>pending=p});await pending;
    assert.deepEqual(w.deleted,['nudge-v1','nudge-public-v2']);
  });
  it('never intercepts/caches exports, RSC or private API responses',()=>{
    const w=worker();for(const path of ['/api/export','/ask?_rsc=private','/auth/callback?code=secret']){
      let intercepted=false;w.handlers.fetch({request:{method:'GET',mode:'cors',url:`https://nudge.test${path}`},respondWith:()=>{intercepted=true}});
      assert.equal(intercepted,false,path);
    }assert.deepEqual(w.puts,[]);
  });
  it('returns only a neutral offline document for private page navigation',async()=>{
    const w=worker();let response!:Promise<any>;
    w.handlers.fetch({request:{method:'GET',mode:'navigate',url:'https://nudge.test/dashboard'},respondWith:(p:Promise<any>)=>response=p});
    assert.equal((await response).offline,true);assert.deepEqual(w.puts,[]);
  });
});
