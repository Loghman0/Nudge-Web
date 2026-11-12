import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {catalogRunnerConfig,createCatalogRunner} from '../scripts/lib/catalog-ai-runner.mjs';
import {generationBriefs} from '../scripts/discovery-pipeline.mjs';
import {createGenerationPackage,executeGenerationPackage} from '../scripts/lib/discovery-generation.mjs';

const env={NUDGE_CATALOG_AI_ENABLED:'true',NUDGE_CATALOG_AI_MODEL:'lightning',NUDGE_CATALOG_AI_DAILY_USD:'0.1',NUDGE_CATALOG_AI_DAILY_REQUESTS:'3',NUDGE_CATALOG_AI_MINUTE_REQUESTS:'2',NVIDIA_API_KEY:'synthetic-key-not-a-real-credential',
 NUDGE_AI_USER_DAILY_USD:'1',NUDGE_AI_GLOBAL_DAILY_USD:'2',NUDGE_AI_MODEL_PRICES_JSON:JSON.stringify([{provider:'nvidia:lightning',model:'nvidia/nemotron-3.5-lightning-30b-a3b',inputUsdPerMillion:'1',outputUsdPerMillion:'1',maxAttemptUsd:'0.1',maxInputBytes:10000,maxOutputTokens:1024}])};
const descriptor={provider:'nvidia:lightning',model:'nvidia/nemotron-3.5-lightning-30b-a3b',inputBytes:100,outputTokenLimit:1024};
const result=(usage={inputTokens:100,outputTokens:200,totalTokens:300})=>({...descriptor,status:'succeeded' as const,httpStatus:200,usage});
async function fixture(fn:(root:string)=>Promise<void>){const root=await mkdtemp(path.join(tmpdir(),'nudge-catalog-ledger-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}

test('Catalog runner requires its own opt-in, explicit prices, limits and model key',()=>{
 for(const change of [{NUDGE_CATALOG_AI_ENABLED:'false'},{NUDGE_CATALOG_AI_DAILY_USD:''},{NUDGE_CATALOG_AI_DAILY_REQUESTS:'0'},{NUDGE_CATALOG_AI_MINUTE_REQUESTS:'4'},{NUDGE_CATALOG_AI_MODEL:'unknown'},{NUDGE_AI_MODEL_PRICES_JSON:''},{NVIDIA_API_KEY:''}])assert.throws(()=>catalogRunnerConfig({...env,...change}));
 assert.equal(catalogRunnerConfig(env).provider,'nvidia:lightning');
});
test('Reservations survive reopening; another process cannot spend while settlement is uncertain',async()=>fixture(async root=>{
 const first=createCatalogRunner({root,env});assert.equal(await first.reserveJob('a'.repeat(24)),true);
 const id=await first.accounting.reserve(descriptor);assert.ok(id);first.close();
 const reopened=createCatalogRunner({root,env});
 try{
  assert.equal(reopened.report().chargedMicrosToday,100000);assert.equal(reopened.report().unsettledAttempts,1);
  assert.equal(await reopened.reserveJob('b'.repeat(24)),false);
  await assert.rejects(reopened.accounting.finish(id,{...result(),model:'unrelated'}));
  assert.equal(reopened.report().unsettledAttempts,1);
  await reopened.accounting.finish(id,result());
  assert.equal(reopened.report().chargedMicrosToday,300);
  assert.equal(await reopened.reserveJob('a'.repeat(24)),false,'Same synthetic job cannot be charged twice across packages');
  assert.equal(await reopened.reserveJob('b'.repeat(24)),true);
  assert.equal(await reopened.accounting.reserve(descriptor),null,'Second full reservation does not fit the remaining budget');
 }finally{reopened.close();}
}));
test('Unknown usage retains cost and the request cap applies even to explicitly zero-rated models',async()=>fixture(async root=>{
 const zeroEnv={...env,NUDGE_CATALOG_AI_DAILY_USD:'1',NUDGE_AI_MODEL_PRICES_JSON:JSON.stringify([{provider:descriptor.provider,model:descriptor.model,inputUsdPerMillion:'0',outputUsdPerMillion:'0',maxAttemptUsd:'0.1',maxInputBytes:10000,maxOutputTokens:1024}])};
 let timestamp=Date.UTC(2026,10,6,12);const runner=createCatalogRunner({root,env:zeroEnv,now:()=>timestamp});
 try{
  assert.equal(await runner.reserveJob('1'.repeat(24)),true);const a=await runner.accounting.reserve(descriptor);
  await runner.accounting.finish(a,result({inputTokens:null,outputTokens:null,totalTokens:null} as any));
  assert.equal(runner.report().chargedMicrosToday,100000);
  assert.equal(await runner.reserveJob('2'.repeat(24)),true);const b=await runner.accounting.reserve(descriptor);await runner.accounting.finish(b,result());
  assert.equal(await runner.reserveJob('3'.repeat(24)),false,'Minute cap');timestamp+=60001;
  assert.equal(await runner.reserveJob('3'.repeat(24)),true);const c=await runner.accounting.reserve(descriptor);await runner.accounting.finish(c,result());
  assert.equal(await runner.reserveJob('4'.repeat(24)),false,'Daily request cap still applies with zero rates');
  timestamp+=86400000;assert.equal(await runner.reserveJob('4'.repeat(24)),true);
 }finally{runner.close();}
}));
test('Closed accounting fails before HTTP; the complete runner sends only synthetic briefs and exports no secrets',async()=>fixture(async root=>{
 const bank=[{id:'seed',domain:'creativity',subdomain:'starting',prompt:'A familiar seed question about a small craft'}];
 const [brief]=[...generationBriefs([{id:'creativity',subdomains:['starting'],optional:false}],1)];
 const directory=path.join(root,'jobs');await createGenerationPackage(directory,[brief],bank);let calls=0;
 const runner=createCatalogRunner({root,env,fetcher:async(url:any,options:any)=>{
  calls++;assert.equal(url,'https://integrate.api.nvidia.com/v1/chat/completions');assert.equal(options.redirect,'error');
  const request=JSON.parse(options.body);assert.equal(request.messages.length,1);assert.equal(request.messages[0].content,brief.prompt);
  const ledger=new DatabaseSync(path.join(root,'.local/catalog-ai-ledger.sqlite'),{readOnly:true});
  try{assert.equal(ledger.prepare("SELECT COUNT(*) n FROM catalog_attempts WHERE status='pending'").get()!.n,1);}finally{ledger.close();}
  return Response.json({choices:[{message:{content:JSON.stringify({id:'creative-small-window',version:1,familyId:'creative-small-window',domain:'creativity',subdomain:'starting',prompt:'An afternoon opens up. Which small creative project appeals?',format:'choice',choices:[{id:'a',label:'Sketching an imaginary garden'},{id:'b',label:'Making a tune from kitchen sounds'}],purpose:'playful',depth:0,sensitivity:'ordinary',estimatedSeconds:20,status:'draft',source:'generated',signals:[],allowedResponses:['depends','neither','skip']})}}],usage:{prompt_tokens:100,completion_tokens:200,total_tokens:300}});
 }});
 try{
  const outputs=await executeGenerationPackage(directory,bank,{...runner,limit:1});assert.equal(outputs[0].status,'draft');assert.equal(calls,1);assert.equal(runner.report().unsettledAttempts,0);
  assert.equal((await readFile(path.join(directory,brief.jobId+'.json'),'utf8')).includes(env.NVIDIA_API_KEY),false);
 }finally{runner.close();}
 const secondDirectory=path.join(root,'closed');await createGenerationPackage(secondDirectory,[brief],bank);
 const outputs=await executeGenerationPackage(secondDirectory,bank,{...runner,limit:1});assert.equal(outputs[0].status,'accounting_blocked');assert.equal(calls,1);
}));
