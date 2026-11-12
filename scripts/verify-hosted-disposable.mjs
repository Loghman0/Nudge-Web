import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,unlinkSync,mkdirSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {createClient} from '@supabase/supabase-js';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {isolateStagingServices} from './staging-environment.mjs';
import {disposableBrowserTarget} from './lib/disposable-browser-target.mjs';
import {recentDeletionUser} from '../src/lib/auth/recent-deletion-session.ts';
import {POLICY_VERSION} from '../src/lib/legal/config.ts';

// This opt-in command never scans/deletes existing users. Cleanup is limited to
// IDs returned by createUser during this process, recorded privately for recovery.
if(process.env.NUDGE_ALLOW_HOSTED_DISPOSABLE_TESTS!=='1')
  throw new Error('Explicit NUDGE_ALLOW_HOSTED_DISPOSABLE_TESTS=1 is required for hosted writes.');
const env={...parseEnv(readFileSync('.env.local','utf8')),...process.env};
const target=new URL(env.NEXT_PUBLIC_SUPABASE_URL);
const ref=env.NUDGE_E2E_TARGET_PROJECT_REF;
if(!ref||target.origin!=='https://'+ref+'.supabase.co'||target.pathname!=='/'||target.search||target.hash)
  throw new Error('Set NUDGE_E2E_TARGET_PROJECT_REF to the explicitly authorized project.');
if(!env.SUPABASE_SERVICE_ROLE_KEY||!env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  throw new Error('Local public/admin configuration is required; never put private keys in command arguments.');
const journal='.e2e-state-hosted-fixtures.json';
if(existsSync(journal))throw new Error('A previous private fixture-cleanup journal exists. Review it before another run.');
const timedFetch=(url,options={})=>fetch(url,{...options,signal:AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(20000)])});
const settings={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:timedFetch}};
const admin=createClient(target.origin,env.SUPABASE_SERVICE_ROLE_KEY,settings);
const clients=[];
const accounts=[];
const created=[];
const analyticsIds=[];
const checks=[];
const withBrowser=process.argv.includes('--browser');
const browserTarget=withBrowser?disposableBrowserTarget(env):null;
const withFoundation=process.argv.includes('--foundation');
const fixtureCount=withBrowser?3:2;
const report={checkedAtUtc:new Date().toISOString(),projectRef:ref,checks,cleanup:false,fixtureAccountsRequested:fixtureCount};
const output=process.argv.includes('--reliability')?('.local/evidence/2026-10-28-reliability/'+(process.env.NUDGE_E2E_SERVER_MODE==='development'?'hosted-development.json':'hosted.json')):process.argv.includes('--ux')?'.local/evidence/2026-10-27-ux/hosted.json':process.argv.includes('--completion')?'.local/evidence/audit-2026-10-26/completion/hosted.json':process.argv.includes('--workflow')?'.local/evidence/audit-2026-10-25/workflow/hosted.json':withFoundation?'.local/evidence/audit-2026-10-25/foundation/hosted.json':process.argv.includes('--comparison-context')?'.local/evidence/audit-2026-10-24/comparison-context/hosted.json':process.argv.includes('--backend')?'.local/evidence/audit-2026-10-24/backend/hosted.json':process.argv.includes('--web-loop')?'.local/evidence/audit-2026-10-24/web-loop-hosted.json':process.argv.includes('--criteria')?'.local/evidence/audit-2026-10-15/criteria-hosted.json':process.argv.includes('--meaning-topics')?'.local/evidence/audit-2026-10-15/meaning-topics-hosted.json':'.local/evidence/audit-2026-10-15/hosted-disposable-verification.json';
mkdirSync(path.dirname(output),{recursive:true});
// Never write raw provider messages, request headers or payloads into the report.
// In particular, PostgREST's empty code/status 0 is a client-side transport
// failure; it must not be mistaken for a database permission or privacy denial.
function failureDiagnostic(result){
  const status=Number.isInteger(result.status)&&result.status>=0&&result.status<=599?result.status:'unavailable';
  const rawCode=result.error?.code;
  const code=typeof rawCode==='string'&&/^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(rawCode)?rawCode:'none';
  const message=String(result.error?.message??'');
  const category=result.status===0?(/timeout/i.test(message)?'transport timeout':/abort/i.test(message)?'transport aborted':'transport failure')
    :result.error?'upstream error':'no error';
  return 'HTTP '+status+', code '+code+', '+category;
}
function expectRpcCode(result,code,operation){
  assert.equal(result.error?.code,code,operation+' ('+failureDiagnostic(result)+').');
}
function ok(result,operation) {
  if(result.error)throw new Error(operation+' failed ('+failureDiagnostic(result)+').');
  return result.data;
}
function passed(name){checks.push(name);console.log('Passed: '+name);}
async function rpc(db,name,args={}){return ok(await db.rpc(name,args),name);}
try{
  const schemaResponse=await timedFetch(target.origin+'/rest/v1/',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}});
  if(!schemaResponse.ok)throw new Error('Schema preflight failed ('+schemaResponse.status+').');
  const schema=await schemaResponse.json();
  const hasRetry=Boolean(schema.paths?.['/rpc/create_comparison_once']);
  const hasUsage=Boolean(schema.paths?.['/rpc/reserve_ai_usage_attempt']);
  if(process.argv.includes('--backend')&&!hasUsage)throw new Error('Apply migration00010 before hosted backend verification.');
  const comparisonContracts=['create_comparison_with_evidence','rerank_comparison_with_evidence','read_my_comparison_evidence','export_my_comparison_evidence',
    'list_comparison_settings','read_my_comparison_setting','get_comparison_settings_state','save_comparison_setting','delete_comparison_setting'];
  report.comparisonContextContract=comparisonContracts.every(name=>Boolean(schema.paths?.['/rpc/'+name]));
  if(process.argv.includes('--comparison-context')&&!report.comparisonContextContract)
    throw new Error('Apply migration00011 before comparison-context hosted verification; no test accounts were created.');
  if(process.argv.includes('--comparison-context')){
    const anonymous=createClient(target.origin,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,settings);
    assert.ok((await anonymous.rpc('get_comparison_settings_state')).error,'anonymous users cannot read comparison settings');
    assert.ok((await anonymous.rpc('read_my_comparison_evidence',{p_decision_id:randomUUID()})).error,'anonymous users cannot read comparison evidence');
    passed('migration 00011 contract preflight and anonymous read denials before fixture creation');
  }
  report.newComparisonContract=hasRetry;
  report.newPushContract=Boolean(schema.paths?.['/rpc/claim_push_deliveries']);
  report.meaningTopicsContract=Boolean(schema.paths?.['/rpc/discover_other_topic']);
  if(process.argv.includes('--meaning-topics')&&!report.meaningTopicsContract)throw new Error('Apply migration00009 before meaning/topic hosted verification.');
  if(withFoundation||withBrowser){
    const catalog=ok(await admin.from('questions').select('id,kind,option_a,option_b,is_onboarding,is_active,context').eq('context->>foundationEdition','1').order('sort_order').limit(7),'Preflight foundation catalog');
    assert.equal(catalog.length,6,'Apply migration00012 before foundation/browser verification; no test accounts were created.');
    assert.deepEqual(catalog.map(row=>row.id),Array.from({length:6},(_,i)=>'12000000-0000-4000-8000-'+String(i+1).padStart(12,'0')));
    assert.ok(catalog.every(row=>row.kind==='this_or_that'&&row.option_a&&row.option_b&&row.is_onboarding&&row.is_active&&typeof row.context?.starterRationale==='string'));
    // Anonymous permission denial proves the RPC exists without granting the
    // admin token access to a function intended only for authenticated owners.
    const anonymous=createClient(target.origin,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,settings);
    const probe=await anonymous.rpc('save_reviewed_memories',{p_request_id:randomUUID(),p_memories:[],p_generation:-1});
    if(probe.error?.code==='PGRST202')throw new Error('Apply migration00013 before foundation/browser verification; no test accounts were created.');
    expectRpcCode(probe,'42501','Reviewed-memory RPC must exist and deny anonymous execution before fixtures are created');
    report.foundationCatalogContract=true;report.reviewedMemoriesContract=true;
    passed('foundation preflight: six contextual edition-one questions and anonymous-denied reviewed-memory RPC before fixture creation');
  }
  for(let index=0;index<fixtureCount;index++){
    const email='nudge-e2e-'+randomUUID()+'@example.com';
    const password=randomBytes(32).toString('base64url');
    const data=ok(await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'Disposable Nudge verification'}}),'Create disposable account');
    if(!data.user?.id)throw new Error('Disposable account ID was not returned.');
    created.push(data.user.id);
    accounts.push({id:data.user.id,email,password});
    writeFileSync(journal,JSON.stringify({projectRef:ref,createdByThisRun:created}),{mode:0o600});
    const db=createClient(target.origin,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,settings);clients.push(db);
    ok(await db.auth.signInWithPassword({email,password}),'Sign in disposable account');
    await rpc(db,'accept_legal_terms',{p_version:POLICY_VERSION,p_age_eligible:true});
    const profile=ok(await db.from('profiles').select('memory_generation,ai_enabled').eq('id',data.user.id).single(),'Read owned profile');
    assert.equal(profile.ai_enabled,false);
    if(index!==2&&(index===0||!process.argv.includes('--web-loop')))
      await rpc(db,'complete_onboarding',{p_profile:{fullName:'Disposable verifier',country:'',language:'en',age:'24',occupation:''},p_answers:[],p_expected_generation:profile.memory_generation});
    await rpc(db,'set_timezone',{p_timezone:'Europe/Istanbul'});
  }
  report.fixtureAccountsCreated=created.length;
  passed(created.length+' disposable accounts: confirmed login, current terms, fixture-specific onboarding, timezone and AI off');
  if(withBrowser){
    const fresh=ok(await clients[2].from('profiles').select('onboarded_at,ai_enabled,memory_generation').eq('id',created[2]).single(),'Read pristine foundation fixture');
    assert.equal(fresh.onboarded_at,null);assert.equal(fresh.ai_enabled,false);assert.equal(fresh.memory_generation,0);
    assert.equal(ok(await clients[2].from('question_answers').select('id').eq('user_id',created[2]),'Read pristine foundation answers').length,0);
    report.foundationFixturePristine=true;
    passed('third browser fixture remains unonboarded, unanswered and AI off for foundation UI verification');
  }
  const [a,b]=clients;
  const [owner,other]=created;
  if(process.argv.includes('--backend')){
    report.aiUsageContract=hasUsage;
    const generation=async()=>ok(await a.from('profiles').select('memory_generation').eq('id',owner).single(),'Read fixture generation').memory_generation;
    const requestId=randomUUID();
    const reservation={p_user_id:owner,p_request_id:requestId,p_action:'interpret',p_provider:'synthetic',p_model:'verification-no-provider-call',
      p_memory_generation:await generation(),p_max_cost_micros:10,p_user_daily_budget_micros:20,p_global_daily_budget_micros:100};
    assert.equal((await rpc(admin,'reserve_ai_usage_attempt',reservation))[0].reserved,false,'AI-off account must not reserve');
    await rpc(a,'set_ai_enabled',{p_enabled:true});
    reservation.p_memory_generation=await generation();
    assert.ok((await a.rpc('reserve_ai_usage_attempt',reservation)).error,'authenticated clients cannot set billing values');
    assert.equal((await rpc(admin,'reserve_ai_usage_attempt',reservation))[0].reserved,true);
    assert.equal((await rpc(admin,'reserve_ai_usage_attempt',reservation))[0].reason,'duplicate');
    await rpc(admin,'finish_ai_usage_attempt',{p_user_id:owner,p_request_id:requestId,p_outcome:'failed'});
    const owned=await rpc(a,'export_my_ai_usage');
    assert.equal(owned.length,1);assert.equal(owned[0].status,'unknown');assert.equal(Number(owned[0].reserved_cost_micros),10);
    assert.equal((await rpc(b,'export_my_ai_usage')).length,0);
    assert.equal((await rpc(admin,'reserve_ai_usage_attempt',{...reservation,p_request_id:randomUUID(),p_max_cost_micros:11}))[0].reason,'user_budget');
    // No provider was called. Reconcile this synthetic attempt to its known zero
    // cost before deleting the fixture, leaving no artificial global liability.
    assert.equal(await rpc(admin,'finish_ai_usage_attempt',{p_user_id:owner,p_request_id:requestId,p_outcome:'failed',p_input_tokens:0,p_output_tokens:0,p_actual_cost_micros:0}),true);
    assert.equal((await rpc(a,'export_my_ai_usage'))[0].status,'settled');
    await rpc(a,'set_ai_enabled',{p_enabled:false});
    passed('AI ledger: consent, service-only reserve, duplicate denial, unknown liability, budget cap, owner export and known-zero synthetic reconciliation');
  }
  if(process.argv.includes('--comparison-context')){
    const generation=async()=>ok(await a.from('profiles').select('memory_generation').eq('id',owner).single(),'Read comparison-context generation').memory_generation;
    const captured=await generation();
    const initial=await rpc(a,'get_comparison_settings_state');assert.equal(initial.generation,captured);assert.deepEqual(initial.settings,[]);
    const settingArgs={p_id:null,p_name:'Synthetic world',p_domain:'  Synthetic   World V1 ',p_category:'hobbies',p_goal:'Gather synthetic materials',
      p_aliases:[{term:'  Mine  Stone ',meaning:'The synthetic mining action'}],p_generation:captured};
    const setting=await rpc(a,'save_comparison_setting',settingArgs);
    const saved=(await rpc(a,'read_my_comparison_setting',{p_id:setting}))[0];
    assert.equal(saved.domain,'synthetic world v1');assert.deepEqual(saved.aliases,[{term:'Mine Stone',meaning:'The synthetic mining action'}]);
    assert.deepEqual(await rpc(b,'read_my_comparison_setting',{p_id:setting}),[]);
    assert.ok((await b.rpc('save_comparison_setting',{...settingArgs,p_id:setting,p_name:'Foreign edit'})).error);
    await rpc(b,'delete_comparison_setting',{p_id:setting,p_generation:0});
    assert.equal((await rpc(a,'list_comparison_settings')).length,1);
    assert.ok((await a.rpc('save_comparison_setting',{...settingArgs,p_name:'Duplicate aliases',p_aliases:[{term:'mine',meaning:'a'},{term:' MINE ',meaning:'b'}]})).error);
    passed('saved settings: normalized explicit aliases, owner-only read/edit/delete and duplicate-term rejection');

    const weights={preferenceMatch:.55,historySuccess:.3,novelty:.15};
    const scored=[{label:'Mining',score:.5,breakdown:{preferenceMatch:.5,historySuccess:.5,novelty:.5}},
      {label:'Woodcutting',score:.5,breakdown:{preferenceMatch:.5,historySuccess:.5,novelty:.5}}];
    const attempt=()=>{
      const run=randomUUID(),at=new Date().toISOString(),engineConfig={category:'hobbies',version:0,weights};
      const context={domain:'synthetic world v1',meaningConfirmed:true,goal:'Gather synthetic materials',scoring_run_id:run,scored_at:at,
        confidence:'low',cold_start:true,evidence_state:'insufficient',engine_config:engineConfig,engine_version:2};
      const evidence={version:1,scoringRunId:run,scoredAt:at,basis:'journal',engineVersion:2,engineConfig,confidence:'low',coldStart:true,evidenceState:'insufficient',
        options:scored.map(o=>({...o,reasons:['No personal evidence in this synthetic fixture.'],warning:false,
          sourceCounts:{preferences:0,decisions:0,reflections:0},sourceIds:{preferenceIds:[],decisionIds:[]}}))};
      return {context,evidence};
    };
    const first=attempt();
    const comparisonArgs={p_request_id:randomUUID(),p_intent:{domain:'synthetic world v1',options:scored.map(o=>o.label)},p_category:'hobbies',p_title:'Synthetic evidence comparison',
      p_context:first.context,p_expected_outcome:null,p_options:scored,p_generation:captured,p_evidence:first.evidence};
    const id=await rpc(a,'create_comparison_with_evidence',comparisonArgs);
    const original=await rpc(a,'read_my_comparison_evidence',{p_decision_id:id});assert.equal(original.length,1);assert.deepEqual(original[0].snapshot,first.evidence);
    assert.deepEqual(await rpc(b,'read_my_comparison_evidence',{p_decision_id:id}),[]);
    const retry=attempt();assert.equal(await rpc(a,'create_comparison_with_evidence',{...comparisonArgs,p_context:retry.context,p_evidence:retry.evidence}),id);
    assert.deepEqual(await rpc(a,'read_my_comparison_evidence',{p_decision_id:id}),original);
    const ownOptions=ok(await a.from('decision_options').select('id,label').eq('decision_id',id).order('rank'),'Read evidence comparison options');
    const next=attempt();
    const rerankArgs={p_decision_id:id,p_revision:0,p_options:scored.map(o=>({...o,id:ownOptions.find(s=>s.label===o.label).id})),
      p_context:next.context,p_generation:captured,p_evidence:next.evidence};
    assert.ok((await b.rpc('rerank_comparison_with_evidence',rerankArgs)).error);
    await rpc(a,'rerank_comparison_with_evidence',rerankArgs);await rpc(a,'rerank_comparison_with_evidence',rerankArgs);
    const revised=await rpc(a,'read_my_comparison_evidence',{p_decision_id:id});assert.deepEqual(revised.map(s=>s.comparison_revision),[0,1]);
    assert.deepEqual(revised[0].snapshot,first.evidence);assert.deepEqual(revised[1].snapshot,next.evidence);
    assert.equal((await rpc(a,'export_my_comparison_evidence',{p_offset:0})).length,2);
    assert.deepEqual(await rpc(b,'export_my_comparison_evidence',{p_offset:0}),[]);
    const bad=attempt();assert.ok((await a.rpc('create_comparison_with_evidence',{...comparisonArgs,p_request_id:randomUUID(),p_context:bad.context,p_evidence:{...bad.evidence,notes:'Rejected synthetic extra field'}})).error);
    passed('comparison evidence: atomic snapshots, revision history, immutable transport retries, strict payloads, owner export and foreign denial');

    await rpc(a,'erase_learned_memory');
    assert.ok(await generation()>captured);assert.deepEqual((await rpc(a,'get_comparison_settings_state')).settings,[]);
    assert.deepEqual(await rpc(a,'read_my_comparison_evidence',{p_decision_id:id}),[]);
    assert.equal(ok(await a.from('decisions').select('id').eq('id',id).single(),'Read retained synthetic journal').id,id);
    assert.ok((await a.rpc('save_comparison_setting',{...settingArgs,p_id:null,p_name:'Stale async create'})).error);
    assert.ok((await a.rpc('save_comparison_setting',{...settingArgs,p_id:setting,p_name:'Stale async edit'})).error);
    assert.ok((await a.rpc('rerank_comparison_with_evidence',{...rerankArgs,p_revision:1})).error);
    const stale=attempt();assert.ok((await a.rpc('create_comparison_with_evidence',{...comparisonArgs,p_request_id:randomUUID(),p_context:stale.context,p_evidence:stale.evidence})).error);
    assert.equal(await rpc(a,'create_comparison_with_evidence',comparisonArgs),id);
    assert.deepEqual(await rpc(a,'read_my_comparison_evidence',{p_decision_id:id}),[]);
    assert.deepEqual(await rpc(a,'export_my_comparison_evidence',{p_offset:0}),[]);
    passed('privacy reset: journal retained; settings/evidence purged; stale saves and scoring rejected; retries cannot resurrect explanations');
  }
  if(withFoundation){
    const generation=async(db,id)=>ok(await db.from('profiles').select('memory_generation').eq('id',id).single(),'Read review fixture generation').memory_generation;
    const request=randomUUID(),payload=[{kind:'goal',content:'  Synthetic reviewed goal  '},{kind:'constraint',content:'Synthetic reviewed constraint'}];
    const before=await generation(a,owner);
    expectRpcCode(await a.rpc('save_reviewed_memories',{p_request_id:request,p_memories:payload,p_generation:before}),'PT409','AI-off accounts cannot save reviewed extractions');
    await rpc(a,'set_ai_enabled',{p_enabled:true});const captured=await generation(a,owner);
    const reviewArgs={p_request_id:request,p_memories:payload,p_generation:captured};
    assert.equal(await rpc(a,'save_reviewed_memories',reviewArgs),2);
    const saved=ok(await a.from('ai_memories').select('id,user_id,kind,content,confidence,reviewed_at').eq('user_id',owner).order('kind'),'Read synthetic reviewed memories');
    assert.equal(saved.length,2);assert.ok(saved.every(row=>row.user_id===owner&&row.confidence===.5&&Number.isFinite(Date.parse(row.reviewed_at))));
    assert.deepEqual(saved.map(row=>row.content),['Synthetic reviewed constraint','Synthetic reviewed goal']);
    assert.equal(await rpc(a,'save_reviewed_memories',{...reviewArgs,p_memories:payload.map(m=>({...m,content:m.content.trim()}))}),2);
    assert.deepEqual(ok(await a.from('ai_memories').select('id').eq('user_id',owner).order('id'),'Read reviewed retry IDs').map(row=>row.id),saved.map(row=>row.id).sort());
    assert.ok((await a.rpc('save_reviewed_memories',{...reviewArgs,p_memories:[{kind:'goal',content:'Changed synthetic intent'}]})).error);
    expectRpcCode(await a.rpc('save_ai_memories',{p_memories:[{kind:'fact',content:'Legacy bypass attempt',confidence:.9}],p_expected_generation:captured,p_decision_id:null}),'42501','Legacy automatic-memory save is denied');

    await rpc(b,'set_ai_enabled',{p_enabled:true});const otherGeneration=await generation(b,other);
    assert.equal(await rpc(b,'save_reviewed_memories',{p_request_id:request,p_memories:[{kind:'habit',content:'Synthetic other-owner reviewed habit'}],p_generation:otherGeneration}),1);
    assert.equal(ok(await b.from('ai_memories').select('id').in('id',saved.map(row=>row.id)),'Foreign reviewed memory read').length,0);
    assert.ok((await b.rpc('edit_ai_memory',{p_memory_id:saved[0].id,p_content:'Foreign edit',p_kind:saved[0].kind,p_delete:false})).error);
    await rpc(a,'edit_ai_memory',{p_memory_id:saved[0].id,p_content:'Synthetic owner-edited statement',p_kind:saved[0].kind,p_delete:false});
    assert.equal(ok(await a.from('ai_memories').select('content').eq('id',saved[0].id).single(),'Read owned memory edit').content,'Synthetic owner-edited statement');
    passed('reviewed memories: AI-off denial, explicit owner confirmation, normalized retry acknowledgement, changed-intent denial, review provenance, legacy bypass denial and cross-owner isolation/edit protection');

    await rpc(a,'erase_learned_memory');assert.ok(await generation(a,owner)>captured);
    assert.equal(ok(await a.from('ai_memories').select('id').eq('user_id',owner),'Read erased reviewed notes').length,0);
    expectRpcCode(await a.rpc('save_reviewed_memories',reviewArgs),'PT409','Stale reviews cannot recreate erased notes');
    assert.equal(ok(await a.from('ai_memories').select('id').eq('user_id',owner),'Check stale review did not resurrect notes').length,0);
    // A new explicit review in the current generation can reuse the old request
    // identity with new intent only because the privacy reset purged its ledger.
    assert.equal(await rpc(a,'save_reviewed_memories',{p_request_id:request,p_memories:[{kind:'goal',content:'Fresh synthetic review after erasure'}],p_generation:await generation(a,owner)}),1);
    await rpc(a,'erase_learned_memory');await rpc(a,'set_ai_enabled',{p_enabled:false});
    await rpc(b,'erase_learned_memory');await rpc(b,'set_ai_enabled',{p_enabled:false});
    report.reviewedMemoryProviderCalls=0;
    passed('review privacy reset: saved notes and retry state purged, stale generation returns PT409 without serialization retries or resurrection, fresh explicit review allowed, both fixture accounts restored to AI off; zero model calls');
  }
  assert.equal((await recentDeletionUser(a.auth))?.id,owner);
  passed('hosted signed session AMR qualifies the current requesting account');
  const savedProfile=ok(await a.from('profiles').update({full_name:'API verification name'}).eq('id',owner).select('full_name').single(),'Save owned profile');
  assert.equal(savedProfile.full_name,'API verification name');
  ok(await a.from('profiles').update({full_name:'Disposable verifier'}).eq('id',owner).select('id').single(),'Restore fixture profile');
  passed('profile writes return the persisted owner-scoped row');
  const profile=ok(await a.from('profiles').select('memory_generation').eq('id',owner).single(),'Read generation');
  const args={p_category:'food',p_title:'Disposable comparison',p_context:{},p_expected_outcome:null,
    p_options:[{label:'Soup',score:.6,breakdown:{preferenceMatch:.6}},{label:'Pizza',score:.4,breakdown:{preferenceMatch:.4}}],p_generation:profile.memory_generation};
  const requestArgs={...args,p_request_id:randomUUID(),p_intent:{options:['Soup','Pizza'],title:'Disposable comparison'}};
  const decision=await rpc(a,hasRetry?'create_comparison_once':'create_comparison',hasRetry?requestArgs:args);
  report.comparisonMode=hasRetry?'current_retry_rpc':'legacy_rpc_only';
  const options=ok(await a.from('decision_options').select('id,label').eq('decision_id',decision),'Read own options');
  assert.equal(options.length,2);
  const foreign=ok(await b.from('decisions').select('id').eq('id',decision),'Foreign decision read');
  assert.equal(foreign.length,0);
  const denied=await b.rpc('commit_choice_and_learn',{p_decision_id:decision,p_option_id:options[0].id,p_key:'learned.food.soup'});
  assert.ok(denied.error);
  passed('comparison ownership: own options readable; foreign decision and choice denied');
  if(hasRetry){
    assert.equal(await rpc(a,'create_comparison_once',requestArgs),decision);
    assert.ok((await a.rpc('create_comparison_once',{...requestArgs,p_intent:{options:['Changed','Intent']}})).error);
    passed('current comparison RPC: stable replay and changed-intent rejection');
  }
  const chosen=options.find(option=>option.label==='Soup');
  await rpc(a,'commit_choice_and_learn',{p_decision_id:decision,p_option_id:chosen.id,p_key:'learned.food.soup'});
  await rpc(a,'schedule_reflection',{p_decision_id:decision,p_due_at:new Date(Date.now()+7*86400000).toISOString(),p_enabled:true});
  await rpc(a,'submit_decision_reflection',{p_decision_id:decision,p_rating:5,p_would_repeat:true,p_has_regrets:false,p_would_recommend:true,p_would_choose_again:true,p_notes:'Disposable verification only',p_key:'learned.food.soup'});
  const reflected=ok(await a.from('decisions').select('status,selected_option_id').eq('id',decision).single(),'Read reflected decision');
  assert.equal(reflected.status,'reflected');assert.equal(reflected.selected_option_id,chosen.id);
  passed('choose, learn, schedule and reflection lifecycle');
  const question=(await rpc(a,'discover_next_question',{p_topic:null}))[0];
  assert.ok(question?.id);
  await rpc(a,'answer_discover_question',{p_question_id:question.id,p_choice:'a'});
  const answered=ok(await a.from('question_answers').select('id').eq('user_id',owner).eq('question_id',question.id),'Read own Discover answer');
  assert.equal(answered.length,1);
  passed('Discover queue and durable answer');
  if(process.argv.includes('--meaning-topics')){
    const expanded=ok(await a.from('questions').select('id,context').eq('context->>edition','2'),'Read expanded bank');
    assert.equal(expanded.length,42);
    const beforeAnswers=ok(await a.from('question_answers').select('id').eq('user_id',owner),'Read progress before topic change');
    const another=(await rpc(a,'discover_other_topic',{p_current_topic:question.context?.topic??null}))[0];
    assert.ok(another?.id);assert.notEqual(another.context?.topic,question.context?.topic);
    const afterAnswers=ok(await a.from('question_answers').select('id').eq('user_id',owner),'Read progress after topic change');
    assert.deepEqual(afterAnswers,beforeAnswers);
    passed('42 additional questions and read-only Discover topic switch preserve progress');
    for(const domain of ['example sandbox world v2','real-world project']){
      const context={domain,meaningConfirmed:true,goal:'Understand the scope',optionDetails:{Mining:'User-defined activity in this setting'}};
      const id=await rpc(a,'create_comparison_once',{p_request_id:randomUUID(),p_intent:{domain,options:['Mining','Woodcutting']},
        p_category:'hobbies',p_title:'Disposable meaning check',p_context:context,p_expected_outcome:null,
        p_options:[{label:'Mining',score:.5,breakdown:{}},{label:'Woodcutting',score:.5,breakdown:{}}],p_generation:profile.memory_generation});
      const option=ok(await a.from('decision_options').select('id').eq('decision_id',id).eq('label','Mining').single(),'Read scoped option');
      await rpc(a,'commit_choice_and_learn',{p_decision_id:id,p_option_id:option.id,p_key:'learned.hobbies.mining'});
      await rpc(a,'submit_decision_reflection',{p_decision_id:id,p_rating:5,p_would_repeat:true,p_has_regrets:false,p_would_recommend:true,
        p_would_choose_again:true,p_notes:'Disposable domain verification',p_key:'learned.hobbies.mining'});
      const key='learned.hobbies.scope.'+createHash('md5').update(domain).digest('hex')+'.mining';
      const node=ok(await a.from('knowledge_nodes').select('id,key,metadata').eq('user_id',owner).eq('key',key).single(),'Read scoped learning');
      assert.equal(node.metadata.decision_domain,domain);
    }
    const scoped=ok(await a.from('knowledge_nodes').select('id,key').eq('user_id',owner).eq('value','Mining'),'Read scoped node pair');
    assert.equal(scoped.length,2);
    await rpc(a,'correct_knowledge_node',{p_node_id:scoped[0].id,p_polarity:'dislike',p_note:'One setting only'});
    assert.equal(ok(await a.from('knowledge_nodes').select('polarity').eq('id',scoped[1].id).single(),'Read unrelated setting').polarity,'like');
    passed('domain-scoped choice and reflection learning with independent corrections');
  }
  const group=await rpc(a,'create_circle',{p_name:'Disposable verification circle'});
  const circle=ok(await a.from('decision_groups').select('invite_code').eq('id',group).single(),'Read test invitation');
  assert.equal(ok(await b.from('decision_groups').select('id').eq('id',group),'Foreign circle read').length,0);
  assert.equal(await rpc(b,'join_decision_circle',{code:circle.invite_code}),group);
  const poll=await rpc(a,'create_circle_poll',{p_group_id:group,p_question:'Disposable poll',p_options:['Soup','Pizza']});
  const pollOptions=ok(await a.from('group_poll_options').select('id').eq('poll_id',poll).order('sort_order'),'Read test poll');
  await rpc(a,'cast_circle_vote',{p_poll_id:poll,p_option_id:pollOptions[0].id});
  await rpc(b,'cast_circle_vote',{p_poll_id:poll,p_option_id:pollOptions[1].id});
  const counts=await rpc(a,'circle_vote_counts',{gid:group});
  assert.equal(counts.filter(row=>row.poll_id===poll).reduce((sum,row)=>sum+Number(row.votes),0),2);
  await rpc(a,'close_circle_poll',{p_group_id:group,p_poll_id:poll});
  assert.ok((await b.rpc('cast_circle_vote',{p_poll_id:poll,p_option_id:pollOptions[0].id})).error);
  passed('private circle invitation, two-member voting and closed-poll enforcement');
  await rpc(a,'record_knowledge_signal',{p_key:'food.soup',p_value:'Soup',p_category_slug:'food',p_polarity:'like',
    p_source:'explicit',p_weight:.5,p_kind:'manual',p_source_decision_id:null,p_source_question_id:null,p_verified:true,p_detail:{},p_expected_generation:null});
  const aliases=ok(await a.from('preferences').select('id').eq('user_id',owner).in('key',['food.soup','learned.food.soup']),'Read test aliases');
  assert.equal(aliases.length,2);
  await rpc(a,'forget_knowledge_key',{p_key:'learned.food.soup'});
  const remaining=ok(await a.from('preferences').select('id').eq('user_id',owner).in('key',['food.soup','learned.food.soup']),'Read forgotten projections');
  assert.equal(remaining.length,0);
  passed('forgetting retires both canonical and learned aliases');
  if(withBrowser){
    if(!hasRetry)throw new Error('The current browser flow requires migration00006 first.');
    const event=ok(await admin.from('analytics_events').insert({user_id:owner,event:'disposable_deletion_check',properties:{synthetic:true}}).select('id').single(),'Create synthetic analytics fixture');
    analyticsIds.push(event.id);
    writeFileSync(journal,JSON.stringify({projectRef:ref,createdByThisRun:created,analyticsCreatedByThisRun:analyticsIds}),{mode:0o600});
    const childEnv={...process.env,...isolateStagingServices(env),
      NUDGE_E2E_EXTERNAL:browserTarget.external?'1':'0',NUDGE_E2E_BASE_URL:browserTarget.baseURL,
      PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH,
      SUPABASE_SERVICE_ROLE_KEY:env.SUPABASE_SERVICE_ROLE_KEY,
      NUDGE_E2E_EMAIL:accounts[0].email,NUDGE_E2E_PASSWORD:accounts[0].password,
      NUDGE_DASHBOARD_TEST_EMAIL:accounts[1].email,NUDGE_DASHBOARD_TEST_PASSWORD:accounts[1].password,
      NUDGE_FOUNDATION_TEST_EMAIL:accounts[2].email,NUDGE_FOUNDATION_TEST_PASSWORD:accounts[2].password,
      NUDGE_DASHBOARD_FRESH_ACCOUNT:process.argv.includes('--web-loop')?'1':'0',
      NUDGE_E2E_ALLOW_ACCOUNT_DELETE:'1',NUDGE_E2E_EXPECTED_USER_ID:accounts[0].id};
    const browser=spawnSync(process.execPath,['scripts/run-e2e.mjs','auth'],{stdio:'inherit',env:childEnv});
    if(browser.error||browser.status!==0)throw new Error('Authenticated disposable browser checks failed.');
    report.authenticatedBrowser='passed';
    report.browserOrigin=browserTarget.baseURL;
    passed('authenticated browser: comparison, reflection, export, profile, deletion, dashboard and foundation questions');
    const remainingEvent=ok(await admin.from('analytics_events').select('id').eq('id',event.id),'Verify deleted analytics fixture');
    assert.equal(remainingEvent.length,0,'Deletion must remove the event itself, not only null its owner');
    passed('self-account deletion cascades analytics, checked by retained event ID');
  }
  report.status='passed';
}catch(error){
  report.status='failed';report.failure=error instanceof Error?error.message:'Unknown test failure';
  console.error(report.failure);process.exitCode=1;
}finally{
  report.fixtureAccountsCreated=created.length;
  const failed=[];
  for(const id of created){
    try{
      const result=await admin.auth.admin.deleteUser(id,false);
      if(result.error&&result.error.status!==404)throw new Error('cleanup rejected');
    }catch{failed.push(id);}
  }
  // Remove only test-created rows if a failed deletion test exposed a regression.
  for(const id of analyticsIds){
    const result=await admin.from('analytics_events').delete().eq('id',id);
    if(result.error)failed.push('analytics:'+id);
  }
  if(!failed.length&&created.length){
    const result=await admin.from('profiles').select('id').in('id',created);
    if(result.error||result.data.length)failed.push(...created);
  }
  report.cleanup=failed.length===0;
  if(report.cleanup){if(existsSync(journal))unlinkSync(journal);console.log('Disposable account cleanup verified.');}
  else{report.cleanupIdsRequiringAttention=failed;process.exitCode=1;console.error('Disposable cleanup needs attention; retain the private cleanup journal.');}
  writeFileSync(output,JSON.stringify(report,null,2)+'\n');
}
