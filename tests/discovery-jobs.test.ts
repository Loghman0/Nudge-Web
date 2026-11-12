import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generationBriefs} from '../scripts/discovery-pipeline.mjs';
import {createGenerationPackage,executeGenerationPackage,exportGenerationCandidates} from '../scripts/lib/discovery-generation.mjs';
import {run} from '../scripts/discovery-jobs.mjs';

const bank=[{id:'seed-question',domain:'creativity',subdomain:'starting',prompt:'A known seed question about trying a familiar craft'}];
const briefs=()=>[...generationBriefs([{id:'creativity',subdomains:['starting'],optional:false}],2)];
const candidate=(brief:any)=>({id:'creative-small-pause',version:1,familyId:'creative-small-pause',domain:brief.spec.domain,subdomain:brief.spec.subdomain,prompt:'A quiet afternoon opens up. Which small creative project appeals?',format:'choice',choices:[{id:'a',label:'Drawing a new shape'},{id:'b',label:'Putting together a tune'}],purpose:'playful',depth:0,sensitivity:'ordinary',estimatedSeconds:15,status:'draft',source:'generated',signals:[],allowedResponses:['depends','neither','skip']});
const env={NUDGE_AI_USER_DAILY_USD:'1',NUDGE_AI_GLOBAL_DAILY_USD:'2',NUDGE_AI_MODEL_PRICES_JSON:JSON.stringify([{provider:'test',model:'test-model',inputUsdPerMillion:'1',outputUsdPerMillion:'1',maxAttemptUsd:'0.1',maxInputBytes:10000,maxOutputTokens:1000}])};
const options=(send:()=>Promise<Response>)=>({env,limit:1,adapter:{provider:'test',model:'test-model',outputTokenLimit:500,send},accounting:{reserve:async()=> 'synthetic-reservation',finish:async()=>{}},reserveJob:async()=>true});
const record=(value:unknown):Record<string,unknown>=>{assert.ok(value&&typeof value==='object');return value as Record<string,unknown>;};
async function fixture(fn:(root:string,directory:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'nudge-discovery-jobs-'));try{await fn(root,join(root,'jobs'));}finally{await rm(root,{recursive:true,force:true});}}

test('Offline package accepts only exact synthetic briefs, bounds count and refuses overwritten jobs',async()=>fixture(async(root,directory)=>{
 const input=briefs();await createGenerationPackage(directory,input,bank);
 await assert.rejects(createGenerationPackage(directory,input,bank),/EEXIST/);
 for(const bad of [[{...input[0],prompt:'Use these private answers instead'}],[{...input[0],userId:'private-user'}],[input[0],input[0]],Array.from({length:101},()=>input[0])])await assert.rejects(createGenerationPackage(join(root,'bad'),bad,bank));
 await assert.rejects(access(join(root,'bad')));
}));
test('Every dispatch has a durable reservation before transport and exports drafts only',async()=>fixture(async(root,directory)=>{
 const input=briefs();await createGenerationPackage(directory,[input[0]],bank);let sends=0,settlements=0;
 const opts=options(async()=>{
  sends++;const journal=JSON.parse(await readFile(join(directory,input[0].jobId+'.json'),'utf8'));
  assert.equal(journal.status,'dispatching');assert.equal(journal.reservation.attemptId,'synthetic-reservation');
  return Response.json({choices:[{message:{content:JSON.stringify(candidate(input[0]))}}],usage:{prompt_tokens:100,completion_tokens:200,total_tokens:300}});
 });opts.accounting.finish=async()=>{settlements++;};
 const result=await executeGenerationPackage(directory,bank,opts);assert.equal(result[0].status,'draft');assert.equal(record(result[0].metering).configuredActualCostMicros,300);assert.equal(settlements,1);
 assert.deepEqual(await executeGenerationPackage(directory,bank,opts),[]);assert.equal(sends,1,'Completed jobs never resend');
 const output=join(root,'candidates.json');assert.equal(await exportGenerationCandidates(directory,bank,output),1);assert.equal(JSON.parse(await readFile(output,'utf8'))[0].status,'draft');
 await assert.rejects(exportGenerationCandidates(directory,bank,output),/EEXIST/);
}));
test('Missing rates or a refused durable rate/budget reservation sends no requests',async()=>fixture(async(root,directory)=>{
 const input=briefs();await createGenerationPackage(directory,input,bank);let sends=0;
 const opts=options(async()=>{sends++;throw new Error('should not send');});
 await assert.rejects(executeGenerationPackage(directory,bank,{...opts,env:{}}),/rates/);
 const result=await executeGenerationPackage(directory,bank,{...opts,reserveJob:async()=>false,limit:2});assert.equal(result.length,1);assert.equal(result[0].status,'accounting_blocked');assert.equal(sends,0);
 await assert.rejects(executeGenerationPackage(directory,bank,opts),/reconciliation/);assert.equal(sends,0);
 const other=join(root,'budget');await createGenerationPackage(other,input,bank);
 const refused=await executeGenerationPackage(other,bank,{...opts,accounting:{...opts.accounting,reserve:async()=>null}});assert.equal(refused[0].status,'accounting_blocked');assert.equal(sends,0);
}));
test('Failed settlement stops the batch, retains the reservation and blocks later resumes',async()=>fixture(async(root,directory)=>{
 const input=briefs();await createGenerationPackage(directory,input,bank);let sends=0;
 const opts=options(async()=>{sends++;return Response.json({choices:[{message:{content:JSON.stringify(candidate(input[0]))}}]});});
 opts.accounting.finish=async()=>{throw new Error('ledger unavailable');};
 const result=await executeGenerationPackage(directory,bank,{...opts,limit:2});assert.equal(sends,1);assert.equal(result.length,1);assert.equal(result[0].status,'accounting_blocked');assert.equal(record(result[0].reservation).attemptId,'synthetic-reservation');assert.equal(result[0].metering,null);
 await assert.rejects(executeGenerationPackage(directory,bank,opts),/reconciliation/);
 await assert.rejects(exportGenerationCandidates(directory,bank,join(root,'out.json')),/No completed/);
}));
test('Malformed model output is charged, while absent token counts and costs stay unknown',async()=>fixture(async(root,directory)=>{
 const input=briefs();await createGenerationPackage(directory,[input[0]],bank);let settled=0;
 const opts=options(async()=>Response.json({choices:[{message:{content:'This is not JSON'}}]}));opts.accounting.finish=async()=>{settled++;};
 const result=await executeGenerationPackage(directory,bank,opts);assert.equal(settled,1);assert.equal(result[0].status,'failed');assert.equal(record(result[0].metering).inputTokens,null);assert.equal(record(result[0].metering).configuredActualCostMicros,null);
 assert.equal('candidate' in result[0],false);
}));
test('Interrupted dispatch and changed catalog cannot be silently retried or exported',async()=>fixture(async(root,directory)=>{
 const input=briefs();await createGenerationPackage(directory,input,bank);
 await writeFile(join(directory,input[0].jobId+'.json'),JSON.stringify({status:'dispatching'}));
 const opts=options(async()=>{throw new Error('should not send');});
 await assert.rejects(executeGenerationPackage(directory,bank,opts),/reconciliation/);
 await assert.rejects(executeGenerationPackage(directory,[...bank,{...bank[0],id:'new'}],opts),/changed/);
 await assert.rejects(run(['generate','ignored','ignored']),/Choose 1–100 jobs/);
}));
