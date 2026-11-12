import {readFile,writeFile,unlink,mkdir} from 'node:fs/promises';
import {existsSync,openSync,closeSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {disposableBrowserTarget} from './lib/disposable-browser-target.mjs';
import {isolateStagingServices} from './staging-environment.mjs';
if(process.env.NUDGE_ALLOW_HOSTED_DISPOSABLE_TESTS!=='1')throw new Error('Disposable hosted tests require explicit opt-in.');
const env={...parseEnv(await readFile('.env.local','utf8')),...process.env};
const browserTarget=disposableBrowserTarget(env);
if(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname!==`${env.NUDGE_E2E_TARGET_PROJECT_REF}.supabase.co`)throw new Error('Explicit target project mismatch');
const journal='.local/discovery-fixtures.json';if(existsSync(journal)&&!process.argv.includes('--cleanup'))throw new Error('Review the existing fixture recovery journal first.');
await mkdir('.local',{recursive:true});
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(30000)})}};
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,options),created=[],clients=[],report={projectRef:env.NUDGE_E2E_TARGET_PROJECT_REF,checks:[],cleanup:false};
if(process.argv.includes('--cleanup')){
 const recovery=JSON.parse(await readFile(journal,'utf8'));
 if(recovery.projectRef!==report.projectRef||!Array.isArray(recovery.created)||recovery.created.length>2)throw new Error('Unexpected recovery scope');
 for(const id of recovery.created){
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid fixture ID');
  const existing=await admin.auth.admin.getUserById(id);
  if(existing.error?.status===404)continue;
  if(existing.error||existing.data.user.user_metadata.full_name!=='Discovery fixture'||!existing.data.user.email?.startsWith('nudge-discovery-')||!existing.data.user.email?.endsWith('@example.invalid'))throw new Error('Fixture identity does not match');
  if((await admin.auth.admin.deleteUser(id)).error)throw new Error('Fixture cleanup failed');
 }
 await unlink(journal);console.log('Interrupted disposable fixtures removed.');process.exit(0);
}
const ok=(result,stage)=>{if(result.error)throw new Error(`${stage}: ${result.error.code??'transport'}`);return result.data;};
let server;
async function runBrowser(env){
 if(!browserTarget.external){
 // Own the exact Next process rather than a shell process tree, so Windows
 // teardown always returns and the fixture cleanup finally block can run.
 const log=openSync('.local/discovery-server.log','w');
 try{server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3117'],{env,stdio:['ignore',log,log],windowsHide:true});}finally{closeSync(log);}
 const serverStarted=await Promise.race([new Promise(resolve=>server.once('spawn',()=>resolve(true))),new Promise(resolve=>server.once('error',()=>resolve(false)))]);
 if(!serverStarted)throw new Error('Could not start the browser test server');
 let ready=false;
 for(let i=0;i<60;i++){
  if(server.exitCode!==null)throw new Error('Browser test server exited; see .local/discovery-server.log');
  try{ready=(await fetch('http://127.0.0.1:3117/start',{signal:AbortSignal.timeout(1500)})).ok;}catch{}
  if(ready)break;await new Promise(resolve=>setTimeout(resolve,500));
 }
 if(!ready)throw new Error('Browser test server did not become ready');
 }
 const args=['node_modules/@playwright/test/cli.js','test','e2e/discovery.spec.ts','e2e/reliability.spec.ts','--global-timeout=480000'];
 const code=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,args,{env:{...env,NUDGE_E2E_EXTERNAL:'1'},stdio:'inherit',windowsHide:true});
  const timer=setTimeout(()=>{child.kill();reject(new Error('Browser verification timed out'));},510000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);resolve(code);});
 });
 if(code!==0)throw new Error('Discovery browser verification failed');
}
try{
 const credentials=[];
 for(let i=0;i<2;i++){
  const email=`nudge-discovery-${randomUUID()}@example.invalid`,password=randomBytes(24).toString('base64url');const data=ok(await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'Discovery fixture'}}),'create fixture');created.push(data.user.id);await writeFile(journal,JSON.stringify({projectRef:report.projectRef,created}));
  const client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);ok(await client.auth.signInWithPassword({email,password}),'sign in');clients.push(client);credentials.push({email,password});
 }
 const [owner,other]=clients,catalog=JSON.parse(await readFile('data/discovery-catalog.json','utf8'));
 const q=catalog.find(q=>q.id==='rest-break'),payload=[{questionId:q.id,questionVersion:q.version,response:{kind:'choice',optionId:'a'}}],request=randomUUID();
 const initial=ok(await owner.rpc('save_discovery_answers',{p_request_id:request,p_generation:0,p_answers:payload,p_source:'preview'}),'claim');
 assert.deepEqual(ok(await owner.rpc('save_discovery_answers',{p_request_id:request,p_generation:0,p_answers:payload,p_source:'preview'}),'retry'),initial);report.checks.push('Idempotent preview claim');
 assert.equal(ok(await other.rpc('read_discovery_state'),'other owner').answers.length,0);assert.ok((await other.rpc('edit_discovery_answer',{p_request_id:randomUUID(),p_generation:0,p_answer_id:initial.answerIds[0],p_revision:0,p_delete:true})).error);report.checks.push('Cross-account isolation');
 ok(await owner.rpc('erase_learned_memory'),'reset fixture');assert.equal(ok(await owner.rpc('read_discovery_state'),'reset state').answers.length,0);report.checks.push('Memory reset clears discovery');
 const childEnv={...isolateStagingServices(env),PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH,NUDGE_E2E_BASE_URL:browserTarget.baseURL,NUDGE_E2E_SKIP_BUILD:'1',PLAYWRIGHT_CHROMIUM_EXECUTABLE:env.PLAYWRIGHT_CHROMIUM_EXECUTABLE??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',NUDGE_DISCOVERY_TEST_EMAIL:credentials[1].email,NUDGE_DISCOVERY_TEST_PASSWORD:credentials[1].password,NUDGE_DASHBOARD_TEST_EMAIL:credentials[1].email,NUDGE_DASHBOARD_TEST_PASSWORD:credentials[1].password};
 await runBrowser(childEnv);report.browserOrigin=browserTarget.baseURL;report.checks.push('Guest and authenticated discovery plus comparison browser flows');
}finally{
 if(server&&server.exitCode===null){const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill();await stopped;}
 let clean=true;for(const id of created){const r=await admin.auth.admin.deleteUser(id);if(r.error)clean=false;}report.cleanup=clean;
 for(const c of clients)await c.auth.signOut().catch(()=>{});
 await writeFile('.local/discovery-hosted.json',JSON.stringify(report,null,2));if(clean)await unlink(journal).catch(()=>{});else throw new Error('Fixture cleanup incomplete; recovery journal retained.');
}
console.log(JSON.stringify(report));
