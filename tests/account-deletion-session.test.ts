import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {recentDeletionUser} from '../src/lib/auth/recent-deletion-session';

const now=1_800_000_000_000;
const userId='00000000-0000-4000-8000-000000000001';
const oldSession='11111111-1111-4111-8111-111111111111';
const newSession='22222222-2222-4222-8222-222222222222';
const freshClaims=()=>({sub:userId,role:'authenticated',session_id:newSession,amr:[{method:'password',timestamp:now/1000-5}]});
function authFor(claims:Record<string,unknown>,options:{claimsError?:boolean;userError?:boolean;user?:string;sessionError?:boolean}={}) {
  const token=`synthetic-${String(claims.session_id)}`;
  return {
    getSession:async()=>({data:{session:{access_token:token,user:{id:'UNTRUSTED'}}},error:options.sessionError?new Error('Missing session'):null}),
    getClaims:async(input:string)=>{assert.equal(input,token);return {data:{claims},error:options.claimsError?new Error('Invalid signature'):null};},
    getUser:async(input:string)=>{assert.equal(input,token);return {data:{user:{id:options.user??userId,last_sign_in_at:new Date(now-1000).toISOString()}},error:options.userError?new Error('Revoked session'):null};},
  } as unknown as SupabaseClient['auth'];
}

describe('session-bound account deletion freshness',()=>{
  it('does not let another session login make an old session fresh or treat token refresh as reauthentication',async()=>{
    // Both requests receive the same fresh account-wide last_sign_in_at from
    // Auth, but each exact token has its own session authentication history.
    const oldClaims={...freshClaims(),session_id:oldSession,iat:now/1000,amr:[{method:'password',timestamp:now/1000-3600},{method:'token_refresh',timestamp:now/1000-1}]};
    assert.equal(await recentDeletionUser(authFor(oldClaims),now),null);
    assert.equal((await recentDeletionUser(authFor(freshClaims()),now))?.id,userId);
  });
  it('rejects missing, unsupported, future or stale authentication proof and identity/session mismatch',async()=>{
    for(const changes of [
      {amr:undefined},{amr:['password']},{amr:[{method:'password',timestamp:'1800000000'}]},
      {amr:[{method:'password',timestamp:now/1000+1}]},{amr:[{method:'password',timestamp:now/1000-601}]},
      {amr:[{method:'recovery',timestamp:now/1000}]},{amr:[{method:'email/signup',timestamp:now/1000}]},
      {amr:[{method:'invite',timestamp:now/1000}]},{session_id:undefined},{session_id:'not-a-session'},
      {role:'service_role'},{is_anonymous:true},
    ])assert.equal(await recentDeletionUser(authFor({...freshClaims(),...changes}),now),null,JSON.stringify(changes));
    for(const options of [{claimsError:true},{userError:true},{sessionError:true},{user:'another-user'}])assert.equal(await recentDeletionUser(authFor(freshClaims(),options),now),null);
  });
  it('accepts timestamped OAuth and MFA proof at the ten-minute boundary',async()=>{
    for(const method of ['password','oauth','otp','magiclink','sso/saml','mfa/totp','mfa/phone']) {
      const user=await recentDeletionUser(authFor({...freshClaims(),amr:[{method,timestamp:now/1000-600}]}),now);
      assert.equal(user?.id,userId,method);
    }
  });
  it('the deletion action preserves explicit confirmation, uses only verified ownership and never reaches admin deletion after failed proof',async()=>{
    // Execute the real action body with inert dependencies; no service key or
    // network call is used. Dynamic imports are replaced by test-owned objects.
    const source=readFileSync(new URL('../src/app/(app)/profile/actions.ts',import.meta.url),'utf8');
    let body=stripTypeScriptTypes(source.slice(source.indexOf('export async function deleteMyAccount'))).replace('export async function','async function');
    body=body.replace('await import("@/lib/auth/recent-deletion-session")','({recentDeletionUser:recentDeletionUserMock})')
      .replace('await import("@supabase/supabase-js")','({createClient:createAdminMock})')
      .replace('await import("next/navigation")','({redirect:redirectMock})');
    let proof:{id:string}|null=null;const deleted:string[]=[];let signedOut=false;let authCalls=0;
    const context=vm.createContext({
      createClient:async()=>{authCalls++;return {auth:{signOut:async()=>{signedOut=true;}}};},
      recentDeletionUserMock:async()=>proof,
      process:{env:{SUPABASE_SERVICE_ROLE_KEY:'inert-test-placeholder',NEXT_PUBLIC_SUPABASE_URL:'https://invalid.test'}},
      createAdminMock:()=>({auth:{admin:{deleteUser:async(id:string,soft:boolean)=>{assert.equal(soft,false);deleted.push(id);return {error:null};}}}}),
      revalidatePath:()=>{},redirectMock:(path:string)=>{assert.equal(path,'/login?deleted=1');},
    });
    vm.runInContext(body+'\nglobalThis.run=deleteMyAccount;',context);
    assert.match((await context.run('no')).error,/Type DELETE/);assert.equal(authCalls,0);
    assert.match((await context.run('DELETE')).error,/sign out and sign back in/);assert.equal(deleted.length,0);
    proof={id:userId};await context.run('DELETE');assert.deepEqual(deleted,[userId]);assert.equal(signedOut,true);
  });
});
