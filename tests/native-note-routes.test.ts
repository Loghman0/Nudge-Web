import {it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {parseMemoryReview} from '../src/lib/services/profile-memory-review';
import {parseNativePushIntent,isInstallationId} from '../src/lib/services/native-push-input';
const input={requestId:'00000000-0000-4000-8000-000000000001',generation:7,reviewed:true,memories:[{kind:'goal',content:'Walk more'}]};
function harness({signedIn=true,stale=false,unavailable=false,db={},fcmConfigured=false}={}){
 const source=readFileSync('src/lib/api/v1/tools-route.ts','utf8'),calls:unknown[][]=[],client=db,provider={name:'accounted'};
 const modules:Record<string,unknown>={
  '@/lib/discover/loaders':{},'@/lib/services/profile-memories':{},'@/lib/services/knowledge':{},'@/lib/services/poll-result':{},'@/lib/services/relations':{},'@/lib/services/native-timelines':{},
  '@/lib/services/profile-memory-review':{parseMemoryReview},
  '@/lib/services/native-push-input':{parseNativePushIntent,isInstallationId},
  '@/lib/services/fcm-sender':{readFcmConfiguration:()=>fcmConfigured?{}:null},
  '@/lib/services/monthly-recap':{generateOwnerRecap:async(...args:unknown[])=>{calls.push(['recap',...args]);return {text:null,reason:'off'};}},
  '@/lib/services/ai/accounting':{getAccountedAi:async(...args:unknown[])=>{calls.push(['accounting',...args]);return provider;}},
  '@/lib/services/profile-memory-intake':{
   extractProfileMemories:async(...args:unknown[])=>{calls.push(['extract',...args]);return unavailable?{error:'AI assistance is unavailable on this deployment.'}:{draft:{generation:7,suggestions:input.memories}};},
   confirmProfileMemoryReview:async(...args:unknown[])=>{calls.push(['confirm',...args]);return stale?{stale:true,error:'Your memory changed'}:{saved:1};},
  },
 };
 const exports:Record<string,any>={};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Response,TextDecoder,Uint8Array,require:(name:string)=>{assert.ok(Object.hasOwn(modules,name),name);return modules[name];}});
 const handler=exports.createToolsHandler(async()=>signedIn?{ok:true,userId:'verified-owner',client}:{ok:false,status:401,code:'unauthenticated',message:'Not signed in.'});
 const run=(path:string,value:unknown)=>handler(new Request('https://nudge.test/api/v1/tools/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}),{params:Promise.resolve({path:path.split('/')})}) as Promise<Response>;
 return {run,calls,client,provider};
}
it('extracts for the authenticated identity with the accounted provider and never confirms implicitly',async()=>{
 const h=harness(),res=await h.run('memories/extract',{text:'Explicit note'});assert.equal(res.status,200);assert.match(res.headers.get('Cache-Control')??'',/no-store/);assert.ok((await res.json()).draft);
 assert.deepEqual(h.calls,[['accounting',h.client,'verified-owner','extract'],['extract',h.client,'verified-owner','Explicit note',h.provider]]);
});
it('rejects caller identity injection, oversized text and unreviewed confirmations before provider or save',async()=>{
 for(const [path,value] of [['memories/extract',{text:'note',userId:'other'}],['memories/extract',{text:'x'.repeat(2001)}],['memories/confirm',{...input,reviewed:false}],['memories/confirm',{...input,userId:'other'}]] as const){const h=harness();assert.equal((await h.run(path,value)).status,400);assert.deepEqual(h.calls,[]);}
});
it('does no AI or memory work when authentication fails',async()=>{
 const h=harness({signedIn:false});assert.equal((await h.run('memories/extract',{text:'Explicit note'})).status,401);assert.equal((await h.run('memories/confirm',input)).status,401);assert.deepEqual(h.calls,[]);
});
it('confirms only the reviewed input for the verified owner, with no AI call',async()=>{
 const h=harness(),res=await h.run('memories/confirm',input);assert.equal(res.status,200);assert.deepEqual(await res.json(),{saved:1});assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),[['confirm',{},'verified-owner',input]]);
});
it('surfaces generation conflicts and unavailable AI without inventing success',async()=>{
 const h=harness({stale:true}),res=await h.run('memories/confirm',input);assert.equal(res.status,409);assert.equal((await res.json()).error.code,'changed');
 const off=harness({unavailable:true}),unavailable=await off.run('memories/extract',{text:'Explicit note'});assert.equal(unavailable.status,503);assert.equal((await unavailable.json()).error.code,'unavailable');
});
it('requires explicit recap confirmation and binds generation to the verified owner',async()=>{
 const h=harness();assert.equal((await h.run('outcomes/recap',{})).status,400);assert.equal((await h.run('outcomes/recap',{confirmed:true,userId:'other'})).status,400);assert.deepEqual(h.calls,[]);
 const res=await h.run('outcomes/recap',{confirmed:true});assert.equal(res.status,200);assert.deepEqual(await res.json(),{text:null,reason:'off'});assert.deepEqual(h.calls,[['recap',h.client,'verified-owner']]);
 const noAuth=harness({signedIn:false});assert.equal((await noAuth.run('outcomes/recap',{confirmed:true})).status,401);assert.deepEqual(noAuth.calls,[]);
});
it('rejects forged device identity fields and unavailable sender configuration before registration',async()=>{
 const body={installationId:'10000000-0000-4000-8000-000000000001',secret:'a'.repeat(64),epoch:1,settings:{enabled:true,token:'synthetic-device-token',timeZone:'UTC',quietStart:0,quietEnd:0}};
 const h=harness();assert.equal((await h.run('push/device',{...body,userId:'other'})).status,400);assert.equal((await h.run('push/device',body)).status,503);
 const calls:any[]=[];const live=harness({fcmConfigured:true,db:{rpc:async(name:string,args:unknown)=>{calls.push([name,args]);return {error:null,data:{saved:true,enabled:true,epoch:1}};}}});assert.equal((await live.run('push/device',body)).status,200);assert.equal(calls.length,1);assert.equal(calls[0][0],'set_native_push_device');assert.equal(calls[0][1].p_user_id,undefined);assert.equal(calls[0][1].p_epoch,1);
});
