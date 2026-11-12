import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {createNvidiaProvider} from '../src/lib/services/ai/nvidia';
import {validateStagingEnvironment,isolateStagingServices} from '../scripts/staging-environment.mjs';
const key=(role='anon',ref='stagingproject01')=>'synthetic.'+Buffer.from(JSON.stringify({role,ref})).toString('base64url')+'.synthetic';
const fixture={NUDGE_STAGING_PROJECT_REF:'stagingproject01',NEXT_PUBLIC_SUPABASE_URL:'https://stagingproject01.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:key(),NUDGE_E2E_EMAIL:'flow@example.test',NUDGE_E2E_PASSWORD:'synthetic-only',NUDGE_DASHBOARD_TEST_EMAIL:'empty@example.test',NUDGE_DASHBOARD_TEST_PASSWORD:'synthetic-only',NUDGE_FOUNDATION_TEST_EMAIL:'foundation@example.test',NUDGE_FOUNDATION_TEST_PASSWORD:'synthetic-only'};
describe('dedicated staging isolation',()=>{
 it('rejects mismatched projects, unsafe URLs, missing fixtures and shared test accounts',()=>{
  for(const changed of [{NUDGE_STAGING_PROJECT_REF:''},{NEXT_PUBLIC_SUPABASE_URL:'https://otherproject.supabase.co'},{NEXT_PUBLIC_SUPABASE_URL:'http://stagingproject01.supabase.co'},{NEXT_PUBLIC_SUPABASE_URL:'https://user@stagingproject01.supabase.co'},{NUDGE_E2E_PASSWORD:''},{NUDGE_FOUNDATION_TEST_PASSWORD:''},{NUDGE_DASHBOARD_TEST_EMAIL:fixture.NUDGE_E2E_EMAIL},{NUDGE_FOUNDATION_TEST_EMAIL:fixture.NUDGE_DASHBOARD_TEST_EMAIL}])
   assert.throws(()=>validateStagingEnvironment({...fixture,...changed}),Error);
  assert.doesNotThrow(()=>validateStagingEnvironment(fixture));
  assert.throws(()=>validateStagingEnvironment(fixture,{NEXT_PUBLIC_SUPABASE_URL:fixture.NEXT_PUBLIC_SUPABASE_URL}),/existing configured Nudge database/);
  assert.doesNotThrow(()=>validateStagingEnvironment(fixture,{NEXT_PUBLIC_SUPABASE_URL:'https://otherproject.supabase.co'}));
  for(const privateOrWrong of [key('service_role'),key('anon','wrongproject'),'sb_secret_synthetic','not-a-key'])
   assert.throws(()=>validateStagingEnvironment({...fixture,NEXT_PUBLIC_SUPABASE_ANON_KEY:privateOrWrong}),Error);
  assert.doesNotThrow(()=>validateStagingEnvironment({...fixture,NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_synthetic'}));
 });
 it('prevents inherited private service keys and deletion flags from reaching browser test servers',()=>{
  const isolated=isolateStagingServices({...fixture,AI_API_KEY:'synthetic-private',SUPABASE_SERVICE_ROLE_KEY:'synthetic-admin',NUDGE_E2E_ALLOW_ACCOUNT_DELETE:'1'});
  assert.equal(isolated.AI_API_KEY,'');assert.equal(isolated.SUPABASE_SERVICE_ROLE_KEY,'');assert.equal(isolated.GOOGLE_PLACES_API_KEY,'');assert.equal(isolated.NUDGE_E2E_ALLOW_ACCOUNT_DELETE,'0');
  assert.equal(isolated.NEXT_PUBLIC_SUPABASE_URL,fixture.NEXT_PUBLIC_SUPABASE_URL);
  assert.equal(isolated.NUDGE_E2E_EXTERNAL,'0');assert.equal(isolated.NUDGE_E2E_STORAGE_STATE,'');
 });
 it('disables every NVIDIA route even when a route-specific key exists in the test environment or local dotenv file',()=>{
  const keys=['NVIDIA_API_KEY','NVIDIA_LIGHTNING_API_KEY','NVIDIA_GEMMA_API_KEY','NVIDIA_GPT_OSS_API_KEY','NVIDIA_SUPER_API_KEY','NVIDIA_ULTRA_API_KEY'];
  const privateKeys=Object.fromEntries(keys.map(key=>[key,'synthetic-private']));
  for(const inherited of [{},privateKeys]){
   const isolated=isolateStagingServices({...fixture,...inherited});
   for(const key of keys)assert.equal(isolated[key],'',key+' must override .env.local');
   assert.equal(createNvidiaProvider({...privateKeys,...isolated}),null,'No live provider can be resolved in isolated browser checks');
  }
 });
});
