import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NextRequest,NextResponse } from 'next/server';
import { describe,it } from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnPath } from "../src/lib/auth/return-path";
import { AUTH_COOKIE_OPTIONS } from '../src/lib/supabase/cookie-options';
import { authRedirectOrigin } from '../src/lib/auth/redirect-origin';
function load(path:string,createServerClient:unknown,fn:string,siteUrl='https://nudge.test') {
  const src=stripTypeScriptTypes(readFileSync(new URL(path,import.meta.url),'utf8')).replace(/^import[\s\S]*?;\s*$/gm,'').replace(/export (async function)/g,'$1');
  const ctx=vm.createContext({NextResponse,URL,createServerClient,AUTH_COOKIE_OPTIONS,safeReturnPath,authRedirectOrigin,process:{env:{NEXT_PUBLIC_SITE_URL:siteUrl,NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'public-test-key'}}});
  vm.runInContext(src+`\nglobalThis.entry=${fn};`,ctx);
  return ctx.entry as (request:NextRequest)=>Promise<NextResponse>;
}
describe('session cookie persistence',()=>{
  it('keeps successful and failed local OAuth callbacks on the host holding the PKCE cookie',async()=>{
    for(const fail of [false,true]){
      const callback=load('../src/app/auth/callback/route.ts',(_url:unknown,_key:unknown,options:any)=>({auth:{exchangeCodeForSession:async()=>{
        assert.ok(options.cookies.getAll().some((cookie:any)=>cookie.name==='sb-test-code-verifier'));
        options.cookies.setAll([{name:'sb-test-auth-token',value:'test-session',options:AUTH_COOKIE_OPTIONS}],{});
        return {error:fail?{message:'expired'}:null};
      }}}),'GET','http://localhost:3000');
      const response=await callback(new NextRequest('http://localhost:3000/auth/callback?code=test&next=/discovery-save',{headers:{host:'127.0.0.1:3000',cookie:'sb-test-code-verifier=test-verifier'}}));
      assert.equal(response.headers.get('location'),`http://127.0.0.1:3000${fail?'/login?error=auth':'/discovery-save'}`);
      assert.equal(response.cookies.get('sb-test-auth-token')?.value,'test-session');
    }
  });
  it('requires a session for password changes and refreshes recovery-session cookies',async()=>{
    let calls=0;
    const unauthenticated=load('../src/lib/supabase/middleware.ts',()=>({auth:{getClaims:async()=>{calls++;return {data:null};}}}),'updateSession');
    const anonymous=await unauthenticated(new NextRequest('https://nudge.test/update-password'));
    assert.equal(anonymous.headers.get('location'),'https://nudge.test/login?next=%2Fupdate-password');
    assert.equal(calls,1);
    const recovered=load('../src/lib/supabase/middleware.ts',(_url:unknown,_key:unknown,options:any)=>({auth:{getClaims:async()=>{
      options.cookies.setAll([{name:'sb-test-auth-token',value:'recovered-session',options:AUTH_COOKIE_OPTIONS}],{});
      return {data:{claims:{sub:'recovering-user'}}};
    }}}),'updateSession');
    const response=await recovered(new NextRequest('https://nudge.test/update-password'));
    assert.equal(response.status,200);
    assert.equal(response.headers.get('location'),null);
    assert.equal(response.cookies.get('sb-test-auth-token')?.value,'recovered-session');
    assert.match(response.headers.get('cache-control')!,/no-store/);
  });
  it('retains refreshed cookies on authenticated login redirects and the next page request',async()=>{
    let gotRequestCookie=false;
    const update=load('../src/lib/supabase/middleware.ts',(_url:unknown,_key:unknown,options:any)=>({auth:{getUser:async()=>({data:{user:{id:'user-a'}},error:null}),signOut:async()=>({error:null}),getClaims:async()=>{
      gotRequestCookie=options.cookies.getAll().some((c:any)=>c.name==='sb-test-auth-token');
      options.cookies.setAll([{name:'sb-test-auth-token',value:'refreshed-test-session',options:AUTH_COOKIE_OPTIONS}],{'Cache-Control':'private, no-store'});
      return {data:{claims:{sub:'user-a'}}};
    }}}),'updateSession');
    const request=new NextRequest('https://nudge.test/login',{headers:{cookie:'sb-test-auth-token=old-test-session'}});
    const response=await update(request);
    assert.equal(gotRequestCookie,true);assert.equal(response.headers.get('location'),'https://nudge.test/dashboard');
    assert.equal(response.cookies.get('sb-test-auth-token')?.value,'refreshed-test-session');
    assert.match(response.headers.get('cache-control')! ,/no-store/);
    const refreshed=await update(new NextRequest('https://nudge.test/dashboard',{headers:{cookie:response.headers.get('set-cookie')!}}));
    assert.equal(refreshed.status,200);assert.equal(refreshed.cookies.get('sb-test-auth-token')?.value,'refreshed-test-session');
  });
  it('propagates cleared expired cookies on protected-route redirects',async()=>{
    const update=load('../src/lib/supabase/middleware.ts',(_url:unknown,_key:unknown,options:any)=>({auth:{getUser:async()=>({data:{user:{id:'user-a'}},error:null}),signOut:async()=>({error:null}),getClaims:async()=>{
      options.cookies.setAll([{name:'sb-test-auth-token',value:'',options:{...AUTH_COOKIE_OPTIONS,maxAge:0}}],{});
      return {data:null,error:{message:'Expired'}};
    }}}),'updateSession');
    const response=await update(new NextRequest('https://nudge.test/discover'));
    assert.equal(response.headers.get('location'),'https://nudge.test/login?next=%2Fdiscover');
    assert.equal(response.cookies.get('sb-test-auth-token')?.maxAge,0);
  });
  it('preserves explicit local destinations for signed-in users and starts signup at foundation setup', async () => {
    const update=load('../src/lib/supabase/middleware.ts',()=>({auth:{
      getClaims:async()=>({data:{claims:{sub:'user-a'}}}),
      getUser:async()=>({data:{user:{id:'user-a'}},error:null}),
    }}),'updateSession');
    for (const [path,expected] of [
      ['/signup','/onboarding'],
      ['/login?next=%2Fgroups%3Finvite%3Dtest','/groups?invite=test'],
      ['/signup?next=%2Fask%3Fcopy%3Dexisting','/ask?copy=existing'],
      ['/signup?next=https%3A%2F%2Felsewhere.test','/onboarding'],
      ['/login?next=%2Flogin','/dashboard'],
    ]) {
      const response=await update(new NextRequest(`https://nudge.test${path}`));
      assert.equal(response.headers.get('location'),`https://nudge.test${expected}`);
      assert.match(response.headers.get('cache-control')!,/no-store/);
    }
  });
  it('attaches exchanged OAuth sessions to redirects with persistent root-scoped cookies',async()=>{
    const callback=load('../src/app/auth/callback/route.ts',(_url:unknown,_key:unknown,options:any)=>({auth:{exchangeCodeForSession:async()=>{
      options.cookies.setAll([{name:'sb-test-auth-token',value:'oauth-test-session',options:AUTH_COOKIE_OPTIONS}],{'Cache-Control':'private, no-store'});
      return {error:null};
    }}}),'GET');
    const response=await callback(new NextRequest('https://nudge.test/auth/callback?code=test-code&next=/discover'));
    assert.equal(response.headers.get('location'),'https://nudge.test/discover');
    const cookie=response.cookies.get('sb-test-auth-token')!;
    assert.equal(cookie.value,'oauth-test-session');assert.equal(cookie.path,'/');assert.equal(cookie.sameSite,'lax');assert.ok(cookie.maxAge!>86400);
    const unsafe=await callback(new NextRequest('https://nudge.test/auth/callback?code=test-code&next=//elsewhere.test'));
    assert.equal(unsafe.headers.get('location'),'https://nudge.test/dashboard');
  });
});

it('preserves a shared-circle destination without accepting external return URLs',()=>{
 assert.equal(safeReturnPath('/groups?invite=012345678901234567'),'/groups?invite=012345678901234567');
 for(const value of ['https://other.test','//other.test','/\\other.test','/consent','/\nother'])assert.equal(safeReturnPath(value),'/dashboard');
});

it('allows login and clears cookies for a deleted identity even while its claims are valid',async()=>{
 let signedOut=false;
 const update=load('../src/lib/supabase/middleware.ts',(_url:unknown,_key:unknown,options:any)=>({auth:{
  getClaims:async()=>({data:{claims:{sub:'deleted-user'}}}),
  getUser:async()=>({data:{user:null},error:{status:404}}),
  signOut:async()=>{signedOut=true;options.cookies.setAll([{name:'sb-test-auth-token',value:'',options:{...AUTH_COOKIE_OPTIONS,maxAge:0}}],{});return {error:null};},
 }}),'updateSession');
 const response=await update(new NextRequest('https://nudge.test/login',{headers:{cookie:'sb-test-auth-token=old-test-session'}}));
 assert.equal(signedOut,true);assert.equal(response.status,200);assert.equal(response.headers.get('location'),null);assert.equal(response.cookies.get('sb-test-auth-token')?.maxAge,0);
});
