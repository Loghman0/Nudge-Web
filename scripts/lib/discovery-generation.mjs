import {open,readFile,mkdir,writeFile,unlink,rename} from 'node:fs/promises';
import path from 'node:path';
import {candidateHash,generationBriefs,generationBriefFromSpec,reviewCandidate} from '../discovery-pipeline.mjs';
import {meteredAiRequest,AiAccountingError} from '../../src/lib/services/ai/attempt-meter.ts';
import {readAiAccountingConfig,ratedCostMicros} from '../../src/lib/services/ai/accounting-config.ts';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hash=value=>candidateHash(value);
const readJson=async file=>{
 const handle=await open(file,'r');
 try{if((await handle.stat()).size>8*1024*1024)throw new Error('Offline artifacts must not exceed 8 MiB');return JSON.parse(await handle.readFile('utf8'));}finally{await handle.close();}
};
const writeJson=(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const taxonomy=bank=>[...new Map(bank.map(q=>[q.domain,{id:q.domain,subdomains:[...new Set(bank.filter(x=>x.domain===q.domain).map(x=>x.subdomain))],optional:['childhood','uncertainty'].includes(q.domain)}])).values()];

/** Accept only generated synthetic specifications from this exact catalog. No
 * operator-supplied prompts, user records, account IDs or answer text are read. */
function validateBriefs(briefs,bank){
 if(!Array.isArray(briefs)||briefs.length<1||briefs.length>100)throw new Error('Use 1–100 briefs per offline job package');
 const requested=new Map();
 for(const brief of briefs){
  if(!object(brief)||Object.keys(brief).some(key=>!['jobId','spec','prompt'].includes(key))||!object(brief.spec)||requested.has(brief.jobId))throw new Error('Invalid or repeated generation brief');
  requested.set(brief.jobId,hash(brief));
 }
 // The bounded taxonomy space is also the allowlist for contexts and angles.
 // Validate once during package creation and load, never while sending data.
 const tree=taxonomy(bank),capacity=tree.reduce((sum,d)=>sum+d.subdomains.length,0)*3072;
 let remaining=requested.size;
 for(const known of generationBriefs(tree,Math.min(250000,capacity))){
  if(requested.get(known.jobId)===hash(known)){requested.delete(known.jobId);if(--remaining===0)return;}
 }
 throw new Error('A brief changed or contains an unrecognized synthetic specification');
}

export async function createGenerationPackage(directory,briefs,bank){
 if(!Array.isArray(bank)||!bank.length)throw new Error('A published catalog is required');
 validateBriefs(briefs,bank);
 const manifest={version:1,status:'offline_draft_jobs',createdAt:new Date().toISOString(),catalogHash:hash(bank),jobs:briefs.map(brief=>({jobId:brief.jobId,spec:brief.spec,promptHash:hash(brief.prompt)}))};
 await mkdir(directory);
 await writeJson(path.join(directory,'manifest.json'),manifest);
 return manifest;
}

async function loadPackage(directory,bank){
 const manifest=await readJson(path.join(directory,'manifest.json'));
 if(!object(manifest)||manifest.version!==1||manifest.status!=='offline_draft_jobs'||manifest.catalogHash!==hash(bank)||!Array.isArray(manifest.jobs))throw new Error('Catalog or generation manifest changed; create a new package');
 const briefs=manifest.jobs.map(job=>{
  if(!object(job)||Object.keys(job).some(key=>!['jobId','spec','promptHash'].includes(key)))throw new Error('Invalid generation manifest');
  const brief=generationBriefFromSpec(job.spec);
  if(job.jobId!==brief.jobId||job.promptHash!==hash(brief.prompt))throw new Error('Generation specification changed');
  return brief;
 });
 validateBriefs(briefs,bank);
 return {manifest,briefs};
}

/** A transport adapter may execute only after BOTH operator rate reservation
 * and durable cost reservation. It must send the supplied synthetic prompt and
 * outputTokenLimit unchanged. The live app's personal-action ledger is not an
 * operator ledger; callers must implement that separate scope before dispatch.
 *
 * adapter: {provider,model,outputTokenLimit,send({prompt,signal,outputTokenLimit})}
 * accounting: existing AiAttemptAccounting bound to operator/catalog budgets
 * reserveJob: durable per-job rate reservation; false blocks before transport
 * @param {string} directory
 * @param {Array<object>} bank
 * @param {{adapter?: {provider:string,model:string,outputTokenLimit:number,send:(input:{prompt:string,signal:AbortSignal,outputTokenLimit:number})=>Promise<Response>},accounting?:import('../../src/lib/services/ai/provider').AiAttemptAccounting,reserveJob?:(jobId:string)=>Promise<boolean>,env?:Record<string,string|undefined>,signal?:AbortSignal,limit?:number}} options
 * @returns {Promise<Array<{status:string,metering:object|null,reservation:{attemptId:string,reservedCostMicros:number}|null,candidate?:unknown}>>}
 */
export async function executeGenerationPackage(directory,bank,{adapter,accounting,reserveJob,env=process.env,signal,limit=10}={}){
 if(!adapter||typeof adapter.send!=='function'||!accounting||typeof accounting.reserve!=='function'||typeof accounting.finish!=='function'||typeof reserveJob!=='function')throw new Error('Dedicated metered catalog adapter and durable rate reservation are required');
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('Choose a limit of 1–100 jobs');
 const config=readAiAccountingConfig(env),price=config?.models.find(row=>row.provider===adapter.provider&&row.model===adapter.model);
 if(!price||!Number.isSafeInteger(adapter.outputTokenLimit)||adapter.outputTokenLimit<1||adapter.outputTokenLimit>price.maxOutputTokens)throw new Error('Configured model rates and output limits are required');
 const {briefs}=await loadPackage(directory,bank),lock=await open(path.join(directory,'run.lock'),'wx');
 const results=[];
 try{
  await lock.writeFile(JSON.stringify({startedAt:new Date().toISOString(),pid:process.pid})+'\n');await lock.sync();
  for(const brief of briefs){
   if(results.length>=limit)break;
   signal?.throwIfAborted();
   const output=path.join(directory,brief.jobId+'.json');
   let existing;try{existing=await readJson(output);}catch(error){if(error.code!=='ENOENT')throw error;}
   // Never resend a dispatch whose completion is uncertain after a crash.
   if(existing){if(['dispatching','accounting_blocked'].includes(existing.status))throw new Error('An interrupted dispatch or blocked accounting needs operator reconciliation before any more requests');continue;}
   const descriptor={provider:adapter.provider,model:adapter.model,inputBytes:Buffer.byteLength(brief.prompt,'utf8'),outputTokenLimit:adapter.outputTokenLimit};
   const quoted=ratedCostMicros(descriptor.inputBytes+1024,descriptor.outputTokenLimit,price);
   if(descriptor.inputBytes>price.maxInputBytes||quoted===null||quoted>price.maxAttemptMicros)throw new Error('Prompt exceeds the configured model reservation');
   // Write-ahead record precedes every rate/budget/provider operation. A crash
   // can consume zero calls and still need review; it can never silently resend.
   const pending={version:1,jobId:brief.jobId,promptHash:hash(brief.prompt),status:'dispatching',startedAt:new Date().toISOString(),provider:adapter.provider,model:adapter.model};
   const journal=await open(output,'wx',0o600);
   try{await journal.writeFile(JSON.stringify(pending,null,2)+'\n');await journal.sync();}finally{await journal.close();}
   /** @type {object|null} */
   let metering=null;
   /** @type {{attemptId:string,reservedCostMicros:number}|null} */
   let reservation=null;
   let record;
   try{
    try{if(await reserveJob(brief.jobId)!==true)throw new AiAccountingError('Catalog request rate is unavailable');}
    catch{throw new AiAccountingError('Catalog request rate is unavailable');}
    const wrapped={reserve:async attempt=>{
     const id=await accounting.reserve(attempt);
     if(typeof id==='string'&&id.trim()){
      reservation={attemptId:id,reservedCostMicros:price.maxAttemptMicros};
      const reserved=output+'.reserved';await writeJson(reserved,{...pending,reservation});await rename(reserved,output);
     }
     return id;
    },finish:async(id,result)=>{
     await accounting.finish(id,result);
     metering={attemptId:id,inputTokens:result.usage.inputTokens,outputTokens:result.usage.outputTokens,totalTokens:result.usage.totalTokens,reservedCostMicros:price.maxAttemptMicros,
      configuredActualCostMicros:!result.usage.costMayDiffer&&result.usage.inputTokens!==null&&result.usage.outputTokens!==null?ratedCostMicros(result.usage.inputTokens,result.usage.outputTokens,price):null,status:result.status};
    }};
    const deadline=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(30000)]);
    const raw=await meteredAiRequest(descriptor,{accounting:wrapped},deadline,'openai',()=>adapter.send({prompt:brief.prompt,outputTokenLimit:adapter.outputTokenLimit,signal:deadline}));
    const content=raw?.choices?.[0]?.message?.content;
    if(typeof content!=='string'||Buffer.byteLength(content,'utf8')>16384)throw new Error('invalid_output');
    let candidate;try{candidate=JSON.parse(content);}catch{throw new Error('invalid_output');}
    const prior=results.flatMap(row=>row.status==='draft'?[row.candidate]:[]);
    const errors=reviewCandidate(candidate,[...bank,...prior]);
    if(candidate?.domain!==brief.spec.domain||candidate?.subdomain!==brief.spec.subdomain||candidate?.format!==brief.spec.format||candidate?.depth!==brief.spec.depth||candidate?.sensitivity!==brief.spec.sensitivity)errors.push('Generated question does not match its assigned specification');
    record={...pending,finishedAt:new Date().toISOString(),status:errors.length?'rejected':'draft',reservation,metering,...(errors.length?{errors}:{candidate:{...candidate,status:'draft',source:'generated',signals:[]},candidateHash:hash({...candidate,status:'draft',source:'generated',signals:[]})})};
   }catch(error){
    record={...pending,finishedAt:new Date().toISOString(),status:error instanceof AiAccountingError?'accounting_blocked':'failed',reservation,metering,failure:error instanceof AiAccountingError?'accounting_unavailable':'generation_failed'};
   }
   const temp=output+'.complete';await writeJson(temp,record);await rename(temp,output);results.push(record);
   // A refused reservation/failed settlement cannot be bypassed with another
   // model, request, job or fallback in this invocation.
   if(record.status==='accounting_blocked'||signal?.aborted)break;
  }
 }finally{await lock.close();await unlink(path.join(directory,'run.lock'));}
 return results;
}

export async function exportGenerationCandidates(directory,bank,output){
 const {briefs}=await loadPackage(directory,bank),candidates=[];
 for(const brief of briefs){
  let record;try{record=await readJson(path.join(directory,brief.jobId+'.json'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
  if(record.jobId!==brief.jobId||record.promptHash!==hash(brief.prompt))throw new Error('Generation result does not match its job');
  if(record.status==='dispatching')throw new Error('Reconcile interrupted dispatch before exporting this batch');
  if(record.status!=='draft')continue;
  if(record.candidateHash!==hash(record.candidate))throw new Error('Generated candidate changed; create a new review input');
  const errors=reviewCandidate(record.candidate,[...bank,...candidates]);
  if(errors.length)throw new Error('Generated candidate needs a new review package');
  candidates.push(record.candidate);
 }
 if(!candidates.length)throw new Error('No completed draft candidates to review');
 await writeJson(output,candidates);
 return candidates.length;
}
