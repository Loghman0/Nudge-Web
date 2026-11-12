import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {readAiAccountingConfig,ratedCostMicros,usdToMicros} from '../../src/lib/services/ai/accounting-config.ts';
import {NVIDIA_MODELS,readNvidiaRouting} from '../../src/lib/services/ai/nvidia.ts';

const integer=(raw,max)=>typeof raw==='string'&&/^[1-9]\d*$/.test(raw)&&Number(raw)<=max?Number(raw):null;

/** A separate operator budget. Personal account ledgers and user data are never read.
 * @param {Record<string,string|undefined>} env */
export function catalogRunnerConfig(env=process.env){
 if(env.NUDGE_CATALOG_AI_ENABLED!=='true')throw new Error('Catalog generation is disabled. Configure the separate operator budget before enabling it.');
 const dailyMicros=usdToMicros(env.NUDGE_CATALOG_AI_DAILY_USD);
 const dailyRequests=integer(env.NUDGE_CATALOG_AI_DAILY_REQUESTS,1000),minuteRequests=integer(env.NUDGE_CATALOG_AI_MINUTE_REQUESTS,60);
 const slot=env.NUDGE_CATALOG_AI_MODEL,routing=readNvidiaRouting(env);
 if(!dailyMicros||!dailyRequests||!minuteRequests||minuteRequests>dailyRequests||!['lightning','gemma'].includes(slot)||!routing?.enabled.includes(slot))throw new Error('Configure a catalog budget, request limits and an enabled lightning or gemma model.');
 const provider='nvidia:'+slot,model=NVIDIA_MODELS[slot];
 const price=readAiAccountingConfig(env)?.models.find(row=>row.provider===provider&&row.model===model);
 if(!price||price.maxAttemptMicros>dailyMicros)throw new Error('Catalog generation requires explicit matching model rates and a sufficient reservation budget.');
 const key=env[slot==='lightning'?'NVIDIA_LIGHTNING_API_KEY':'NVIDIA_GEMMA_API_KEY']?.trim()||env.NVIDIA_API_KEY?.trim();
 if(!key)throw new Error('Configure the selected NVIDIA key locally.');
 return {dailyMicros,dailyRequests,minuteRequests,provider,model,slot,price,key,outputTokenLimit:Math.min(1024,price.maxOutputTokens)};
}

/** One SQLite ledger per checkout, shared by every catalog package. FULL sync
 * and IMMEDIATE transactions persist reservations before any HTTP transport.
 * This local CLI is single-host infrastructure, not a distributed worker ledger.
 * @param {{root?:string,env?:Record<string,string|undefined>,fetcher?:typeof fetch,now?:()=>number}} options */
export function createCatalogRunner({root=process.cwd(),env=process.env,fetcher=fetch,now=Date.now}={}){
 const config=catalogRunnerConfig(env),directory=path.join(root,'.local');
 mkdirSync(directory,{recursive:true});
 const db=new DatabaseSync(path.join(directory,'catalog-ai-ledger.sqlite'));
 db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS catalog_jobs(job_id TEXT PRIMARY KEY,reserved_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS catalog_attempts(
 id TEXT PRIMARY KEY,job_id TEXT NOT NULL UNIQUE REFERENCES catalog_jobs(job_id),
 provider TEXT NOT NULL,model TEXT NOT NULL,input_bytes INTEGER NOT NULL,output_limit INTEGER NOT NULL,
 reserved_micros INTEGER NOT NULL,charged_micros INTEGER NOT NULL,price_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('pending','succeeded','failed','aborted')),
 created_at INTEGER NOT NULL,finished_at INTEGER,usage_json TEXT);
 CREATE INDEX IF NOT EXISTS catalog_jobs_time ON catalog_jobs(reserved_at);
 CREATE INDEX IF NOT EXISTS catalog_attempts_time ON catalog_attempts(created_at);`);
 let pendingJob=null;
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
 const count=(sql,...args)=>Number(db.prepare(sql).get(...args).n);
 const pending=()=>count("SELECT COUNT(*) n FROM catalog_attempts WHERE status='pending'")>0;
 const dayStart=timestamp=>Math.floor(timestamp/86400000)*86400000;
 const reserveJob=async jobId=>transaction(()=>{
  if(typeof jobId!=='string'||!/^[a-f0-9]{24}$/.test(jobId)||pendingJob||pending())return false;
  const timestamp=now();
  if(count('SELECT COUNT(*) n FROM catalog_jobs WHERE job_id=?',jobId)
   ||count('SELECT COUNT(*) n FROM catalog_jobs WHERE reserved_at>=?',dayStart(timestamp))>=config.dailyRequests
   ||count('SELECT COUNT(*) n FROM catalog_jobs WHERE reserved_at>?',timestamp-60000)>=config.minuteRequests)return false;
  db.prepare('INSERT INTO catalog_jobs(job_id,reserved_at) VALUES(?,?)').run(jobId,timestamp);
  pendingJob=jobId;return true;
 });
 const accounting={
  reserve:async descriptor=>transaction(()=>{
   const jobId=pendingJob;pendingJob=null;
   if(!jobId||pending()||descriptor.provider!==config.provider||descriptor.model!==config.model
    ||!Number.isSafeInteger(descriptor.inputBytes)||descriptor.inputBytes<1||descriptor.inputBytes>config.price.maxInputBytes
    ||descriptor.outputTokenLimit!==config.outputTokenLimit)return null;
   const timestamp=now(),used=count('SELECT COALESCE(SUM(charged_micros),0) n FROM catalog_attempts WHERE created_at>=?',dayStart(timestamp));
   if(used+config.price.maxAttemptMicros>config.dailyMicros)return null;
   const id=randomUUID();
   db.prepare(`INSERT INTO catalog_attempts(id,job_id,provider,model,input_bytes,output_limit,reserved_micros,charged_micros,price_json,status,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,'pending',?)`).run(id,jobId,descriptor.provider,descriptor.model,descriptor.inputBytes,descriptor.outputTokenLimit,config.price.maxAttemptMicros,config.price.maxAttemptMicros,JSON.stringify(config.price),timestamp);
   return id;
  }),
  finish:async(id,result)=>transaction(()=>{
   const row=db.prepare('SELECT * FROM catalog_attempts WHERE id=?').get(id);
   if(!row||row.status!=='pending'||row.provider!==result.provider||row.model!==result.model||row.input_bytes!==result.inputBytes||row.output_limit!==result.outputTokenLimit||!['succeeded','failed','aborted'].includes(result.status))throw new Error('Catalog settlement does not match its reservation');
   const price=JSON.parse(row.price_json),usage=result.usage;
   const known=!usage.costMayDiffer&&usage.inputTokens!==null&&usage.outputTokens!==null;
   const actual=known?ratedCostMicros(usage.inputTokens,usage.outputTokens,price):null;
   db.prepare('UPDATE catalog_attempts SET status=?,finished_at=?,charged_micros=?,usage_json=? WHERE id=?')
    .run(result.status,now(),actual??row.reserved_micros,JSON.stringify({inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,totalTokens:usage.totalTokens,configuredActualCostMicros:actual}),id);
  }),
 };
 const adapter={provider:config.provider,model:config.model,outputTokenLimit:config.outputTokenLimit,
  send:async({prompt,signal,outputTokenLimit})=>{
   if(typeof prompt!=='string'||outputTokenLimit!==config.outputTokenLimit)throw new Error('Invalid catalog transport');
   return fetcher('https://integrate.api.nvidia.com/v1/chat/completions',{
    method:'POST',redirect:'error',signal,
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.key},
    body:JSON.stringify({model:config.model,messages:[{role:'user',content:prompt}],max_tokens:outputTokenLimit,temperature:.7,stream:false,...(config.slot==='lightning'?{chat_template_kwargs:{enable_thinking:false}}:{})}),
   });
  }};
 return {adapter,accounting,reserveJob,env,
  report:()=>({requestsToday:count('SELECT COUNT(*) n FROM catalog_jobs WHERE reserved_at>=?',dayStart(now())),chargedMicrosToday:count('SELECT COALESCE(SUM(charged_micros),0) n FROM catalog_attempts WHERE created_at>=?',dayStart(now())),unsettledAttempts:count("SELECT COUNT(*) n FROM catalog_attempts WHERE status='pending'")}),
  close:()=>db.close()};
}
