import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEVELOPMENT_NVIDIA_MODELS, formatDevelopmentCheck, readDevelopmentNvidiaRouting, supportsDevelopmentNode, validateDevelopmentEnvironment } from '../scripts/check-development.mjs';
import { NVIDIA_MODELS, readNvidiaRouting } from '../src/lib/services/ai/nvidia';
import { nvidiaDevelopmentSettings } from '../scripts/configure-nvidia-development.mjs';

const project='abcdefghijklmnpqrstu';
const anon=(role='anon',ref=project)=>['header',Buffer.from(JSON.stringify({role,ref})).toString('base64url'),'synthetic-signature'].join('.');
const base={NEXT_PUBLIC_SUPABASE_URL:`https://${project}.supabase.co`,NEXT_PUBLIC_SUPABASE_ANON_KEY:anon(),
  NEXT_PUBLIC_SITE_URL:'http://localhost:3000',SUPABASE_SERVICE_ROLE_KEY:'synthetic-private-server-credential',NUDGE_PUBLIC_LAUNCH:'false'};
const check=(env:Record<string,string|undefined>=base,options={})=>validateDevelopmentEnvironment(env,{nodeVersion:'24.19.0',...options});
const price=(provider:string,model:string,maxOutputTokens=600)=>({provider,model,inputUsdPerMillion:'0',outputUsdPerMillion:'0',maxAttemptUsd:'0.000001',maxInputBytes:4000,maxOutputTokens});
const accounting=(rows:unknown[])=>({NUDGE_AI_USER_DAILY_USD:'0.01',NUDGE_AI_GLOBAL_DAILY_USD:'0.1',NUDGE_AI_MODEL_PRICES_JSON:JSON.stringify(rows)});

describe('development-only configuration gate',()=>{
  it('passes manual development with no operator details while explicitly reporting unavailable optional AI',()=>{
    const env=Object.freeze({...base}),before=JSON.stringify(env),result=check(env);
    assert.equal(result.ok,true);assert.deepEqual(result.issues,[]);assert.equal(result.optionalAi.status,'unavailable');
    assert.match(formatDevelopmentCheck(result),/manual comparisons/);assert.match(formatDevelopmentCheck(result),/does not establish public-launch readiness/);
    assert.ok(Object.values(result.checks).every(Boolean));assert.equal(JSON.stringify(env),before);
    for(const field of ['NUDGE_OPERATOR_NAME','NUDGE_CONTACT_EMAIL','NUDGE_OPERATOR_ADDRESS','NUDGE_DATA_REGION'])assert.ok(!formatDevelopmentCheck(result).includes(field));
  });
  it('uses the supported Node versions declared in package.json rather than accepting an older installed runtime',()=>{
    const engines=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).engines.node;
    for(const version of ['22.22.2','22.23.0','24.15.0','24.19.0','26.0.0','27.0.1'])assert.equal(supportsDevelopmentNode(version,engines),true,version);
    for(const version of ['20.19.0','22.22.1','23.0.0','24.14.0','25.0.0','26.0.0-beta','bad'])assert.equal(supportsDevelopmentNode(version,engines),false,version);
    assert.equal(supportsDevelopmentNode('24.19.0','unsupported'),false);assert.equal(check(base,{nodeVersion:'24.14.0'}).ok,false);
  });
  it('keeps public launch off and allows root local HTTP or private HTTPS preview URLs only',()=>{
    for(const site of ['http://127.0.0.1:3117','http://[::1]:3000','https://private-preview.test/'])assert.equal(check({...base,NEXT_PUBLIC_SITE_URL:site}).ok,true,site);
    for(const site of ['http://public.test','https://user:password@private.test/','http://localhost:3000/app','http://localhost:3000/?token=private','javascript:alert(1)'])assert.equal(check({...base,NEXT_PUBLIC_SITE_URL:site}).ok,false);
    for(const flag of ['true','TRUE','1','unexpected'])assert.equal(check({...base,NUDGE_PUBLIC_LAUNCH:flag}).ok,false);
    assert.equal(check({...base,NUDGE_PUBLIC_LAUNCH:undefined}).ok,true);
  });
  it('requires a real public backend key and rejects admin, mistargeted and placeholder browser credentials',()=>{
    assert.equal(check({...base,NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_synthetic_public_key'}).ok,true);
    for(const key of ['', 'your-public-anon-key','sb_secret_private_server_key',anon('service_role'),anon('anon','different-project'),'malformed-key'])assert.equal(check({...base,NEXT_PUBLIC_SUPABASE_ANON_KEY:key}).ok,false);
    for(const backend of ['https://your-project.supabase.co','https://user:password@private.supabase.co','https://example.supabase.co','https://backend.test/path','http://backend.test/'])assert.equal(check({...base,NEXT_PUBLIC_SUPABASE_URL:backend}).ok,false);
    assert.equal(check({...base,SUPABASE_SERVICE_ROLE_KEY:''}).ok,false);
  });
  it('does not confuse another provider key with the selected provider or bypass accounting for free rates',()=>{
    const incomplete={...base,AI_PROVIDER:'nvidia',OPENAI_API_KEY:'synthetic-unrelated-key'};
    assert.equal(check(incomplete).ok,true);assert.equal(check(incomplete,{requireAi:true}).ok,false);
    const unpriced={...base,AI_PROVIDER:'openai',OPENAI_API_KEY:'synthetic-openai-key'};
    assert.equal(check(unpriced,{requireAi:true}).ok,false);
    assert.equal(check({...unpriced,...accounting([price('groq','wrong-model')])},{requireAi:true}).ok,false);
    const ready={...unpriced,...accounting([price('openai','gpt-4o-mini')])};
    assert.equal(check(ready,{requireAi:true}).ok,true);assert.equal(check(ready).optionalAi.status,'configuration_present');
    assert.equal(check({...ready,NUDGE_AI_USER_DAILY_USD:'0'},{requireAi:true}).ok,false);
    assert.equal(check({...ready,NUDGE_AI_MODEL_PRICES_JSON:JSON.stringify([{...price('openai','gpt-4o-mini'),maxAttemptUsd:'0'}])},{requireAi:true}).ok,false);
  });
  it('checks every configured NVIDIA route and its real output ceiling without creating a provider',()=>{
    assert.deepEqual(DEVELOPMENT_NVIDIA_MODELS,NVIDIA_MODELS);
    const env={...base,AI_PROVIDER:'nvidia',NVIDIA_ENABLED_MODELS:'gpt_oss',NVIDIA_GPT_OSS_API_KEY:'synthetic-nvidia-key',...accounting([price('nvidia:gpt_oss',NVIDIA_MODELS.gpt_oss,2048)])};
    assert.equal(check(env,{requireAi:true}).ok,true);
    assert.equal(check({...env,NVIDIA_SUPER_API_KEY:'synthetic-unselected-legacy-route'},{requireAi:true}).ok,true);
    assert.equal(check({...env,NUDGE_AI_MODEL_PRICES_JSON:JSON.stringify([price('nvidia:gpt_oss',NVIDIA_MODELS.gpt_oss,600)])},{requireAi:true}).ok,false);
    assert.equal(check({...env,NVIDIA_ENABLED_MODELS:undefined,NVIDIA_API_KEY:'synthetic-shared-key'},{requireAi:true}).ok,false);
  });
  it('matches the application routing policy for current defaults, reduced allowlists and explicit legacy roles',()=>{
    for(const env of [{},{NVIDIA_ENABLED_MODELS:'lightning,gemma'},{NVIDIA_ENABLED_MODELS:'gpt_oss'},
      {NVIDIA_ENABLED_MODELS:'super,lightning',NVIDIA_REASONING_MODEL:'super'},
      {NVIDIA_ENABLED_MODELS:'ultra,gemma',NVIDIA_SUMMARY_MODEL:NVIDIA_MODELS.ultra},
      {NVIDIA_ENABLED_MODELS:`${NVIDIA_MODELS.lightning},${NVIDIA_MODELS.gemma},lightning`},
      {NVIDIA_ENABLED_MODELS:''},{NVIDIA_ENABLED_MODELS:'unknown'},{NVIDIA_ENABLED_MODELS:'gemma,'},
      {NVIDIA_ENABLED_MODELS:'lightning,gemma',NVIDIA_PARSING_MODEL:'super'},
      {NVIDIA_ENABLED_MODELS:'lightning,gemma',NVIDIA_EXTRACTION_MODEL:'unknown'}]){
      assert.deepEqual(readDevelopmentNvidiaRouting(env),readNvidiaRouting(env));
    }
    assert.deepEqual(readDevelopmentNvidiaRouting({})?.enabled,['lightning','gemma']);
    assert.equal(readDevelopmentNvidiaRouting({})?.roles.parsing,'lightning');
    assert.equal(readDevelopmentNvidiaRouting({})?.roles.summary,'gemma');
  });
  it('accepts the two-model development helper output without requiring unselected legacy pricing',()=>{
    const original=Object.freeze({...base,NVIDIA_API_KEY:'synthetic-nvidia-shared-key'});
    const configured={...original,...nvidiaDevelopmentSettings(original)};
    const result=check(configured,{requireAi:true});
    assert.equal(result.ok,true);assert.equal(result.optionalAi.status,'configuration_present');
    assert.deepEqual(readDevelopmentNvidiaRouting(configured)?.enabled,['lightning','gemma']);
    assert.equal(original.NUDGE_PUBLIC_LAUNCH,'false');
    for(const enabled of ['', 'lightning,', 'unknown'])assert.equal(check({...configured,NVIDIA_ENABLED_MODELS:enabled},{requireAi:true}).ok,false);
    assert.equal(check({...configured,NVIDIA_PARSING_MODEL:'super'},{requireAi:true}).ok,false);
  });
  it('never treats a generic key from another vendor as a NVIDIA key and prices only explicitly selected legacy attempts',()=>{
    const pricing=accounting([price('nvidia:lightning',NVIDIA_MODELS.lightning,1024),price('nvidia:gemma',NVIDIA_MODELS.gemma,1024)]);
    const env={...base,AI_PROVIDER:'nvidia',AI_API_KEY:'other-provider-private-key',...pricing};
    assert.equal(check(env,{requireAi:true}).ok,false);
    assert.equal(check({...env,AI_API_KEY:'nvapi-test-only'},{requireAi:true}).ok,true);
    const shared={...env,NVIDIA_API_KEY:'synthetic-shared-key',NVIDIA_ENABLED_MODELS:'lightning,gemma,super,ultra'};
    assert.equal(check(shared,{requireAi:true}).ok,true);
    assert.equal(check({...shared,NVIDIA_REASONING_MODEL:'super'},{requireAi:true}).ok,false);
    const legacyPriced={...shared,NVIDIA_REASONING_MODEL:'super',...accounting([
      price('nvidia:lightning',NVIDIA_MODELS.lightning,1024),price('nvidia:gemma',NVIDIA_MODELS.gemma,1024),price('nvidia:super',NVIDIA_MODELS.super,1024),
    ])};
    assert.equal(check(legacyPriced,{requireAi:true}).ok,true);
    // Merely enabling a keyed legacy slot cannot serve unassigned roles.
    assert.equal(check({...legacyPriced,NVIDIA_ENABLED_MODELS:'super'},{requireAi:true}).ok,false);
  });
  it('reports only bounded status and variable guidance, never supplied credentials, URLs or raw pricing payloads',()=>{
    const secrets=['PRIVATE_SERVER_SENTINEL','PRIVATE_PROVIDER_SENTINEL','PRIVATE_BROWSER_SENTINEL','PRIVATE_JSON_SENTINEL','PRIVATE_URL_SENTINEL'];
    const result=check({...base,SUPABASE_SERVICE_ROLE_KEY:secrets[0],AI_PROVIDER:'openai',OPENAI_API_KEY:secrets[1],
      NEXT_PUBLIC_SUPABASE_ANON_KEY:secrets[2],NUDGE_AI_MODEL_PRICES_JSON:secrets[3],NEXT_PUBLIC_SITE_URL:`https://name:${secrets[4]}@private.test/`},{requireAi:true});
    const output=JSON.stringify(result)+'\n'+formatDevelopmentCheck(result);
    for(const secret of secrets)assert.ok(!output.includes(secret));
    assert.equal(result.ok,false);assert.ok(result.issues.length>0);
  });
});
