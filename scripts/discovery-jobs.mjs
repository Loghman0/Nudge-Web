import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {createGenerationPackage,executeGenerationPackage,exportGenerationCandidates} from './lib/discovery-generation.mjs';
import {createCatalogRunner} from './lib/catalog-ai-runner.mjs';

export async function run(args){
 const [command,input,output]=args;
 if(!input||!output||args.length!==3)throw new Error('Commands: init <briefs.jsonl> <new-job-directory> | generate <job-directory> <limit:1-100> | export <job-directory> <new-candidates.json>. Generated drafts still require discovery-pipeline review and approval.');
 if(command==='generate'){
  const limit=/^[1-9]\d*$/.test(output)?Number(output):0;if(limit<1||limit>100)throw new Error('Choose 1–100 jobs');
  // Operators opt in through private configuration. No key or raw provider error is printed.
  try{process.loadEnvFile('.env.local');}catch(error){if(error.code!=='ENOENT')throw error;}
  const runner=createCatalogRunner();
  try{
   const bank=JSON.parse(await readFile('data/discovery-catalog.json','utf8'));
   const results=await executeGenerationPackage(input,bank,{...runner,limit});
   const report={completed:results.length,statuses:results.map(row=>row.status),...runner.report()};
   console.log(JSON.stringify(report));
   if(results.some(row=>row.status==='accounting_blocked'))throw new Error('Catalog accounting stopped the batch. Review local job and ledger records before another run.');
   if(results.some(row=>row.status==='failed'))throw new Error('Some catalog requests failed. Completed records are retained; no failed request is automatically resent.');
   return report;
  }finally{runner.close();}
 }
 const bank=JSON.parse(await readFile('data/discovery-catalog.json','utf8'));
 if(command==='init'){
  const raw=await readFile(input,'utf8');if(Buffer.byteLength(raw)>1024*1024)throw new Error('Use at most 1 MiB of synthetic briefs');
  const briefs=raw.trim().split(/\r?\n/).map(line=>JSON.parse(line));
  await createGenerationPackage(output,briefs,bank);return;
 }
 if(command==='export'){await exportGenerationCandidates(input,bank,output);return;}
 throw new Error('Unknown offline job command');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)run(process.argv.slice(2)).catch(error=>{console.error(error instanceof Error?error.message:'Offline job command failed');process.exitCode=1;});
