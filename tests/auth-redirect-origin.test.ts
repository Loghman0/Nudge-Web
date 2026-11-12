import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {authRedirectOrigin} from '../src/lib/auth/redirect-origin';
import {safeReturnPath} from '../src/lib/auth/return-path';
import {signupFoundationPath} from '../src/lib/auth/foundation-path';

describe('authentication callback origins',()=>{
  it('preserves either explicitly supported loopback host on the same port',()=>{
    for(const configured of ['http://localhost:3000','http://127.0.0.1:3000'])for(const origin of ['http://localhost:3000','http://127.0.0.1:3000'])assert.equal(authRedirectOrigin(configured,origin,true),origin);
  });
  it('ignores malformed origins, different ports, credential URLs and lookalike hosts',()=>{
    for(const origin of [null,'null','garbage','http://localhost:4000','https://localhost:3000','http://localhost.evil.test:3000','http://localhost:3000@evil.test','http://user@localhost:3000','http://localhost:3000/path','http://127.0.0.2:3000','http://127.0.0.1:3000?x=1'])assert.equal(authRedirectOrigin('http://localhost:3000',origin,true),'http://localhost:3000');
  });
  it('never adopts a request origin for public or non-loopback deployments',()=>{
    assert.equal(authRedirectOrigin('http://localhost:3000','http://127.0.0.1:3000',false),'http://localhost:3000');
    for(const origin of ['http://127.0.0.1:3000','https://evil.test','https://preview.nudge.test'])assert.equal(authRedirectOrigin('https://nudge.test/',origin,true),'https://nudge.test');
  });
  it('uses the initiating local origin for Google, signup and recovery without losing the return path',async()=>{
    const callbacks:string[]=[];
    const db={auth:{
      signInWithOAuth:async(input:any)=>{callbacks.push(input.options.redirectTo);return {data:{url:'https://provider.test/authorize'},error:null};},
      signUp:async(input:any)=>{callbacks.push(input.options.emailRedirectTo);return {error:null};},
      resetPasswordForEmail:async(_email:string,options:any)=>{callbacks.push(options.redirectTo);return {error:null};},
    }};
    const modules:Record<string,unknown>={
      'next/cache':{revalidatePath:()=>{}},'next/navigation':{redirect:()=>{}},
      'next/headers':{headers:async()=>new Headers({origin:'http://127.0.0.1:3000'})},
      '@/lib/auth/redirect-origin':{authRedirectOrigin},'@/lib/auth/return-path':{safeReturnPath},
      '@/lib/auth/foundation-path':{signupFoundationPath},'@/lib/supabase/server':{createClient:async()=>db},
    };
    const compiled=ts.transpileModule(readFileSync(new URL('../src/app/auth/actions.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const exports:Record<string,any>={};
    vm.runInNewContext(compiled,{exports,require:(name:string)=>{if(!(name in modules))throw new Error(name);return modules[name];},process:{env:{NEXT_PUBLIC_SITE_URL:'http://localhost:3000'}}});
    const form=new FormData();form.set('next','/discovery-save');form.set('email','fixture@example.invalid');form.set('password','fixture-password');
    await exports.signInWithGoogle(form);await exports.signUpWithEmail({},form);await exports.requestPasswordReset({},form);
    assert.deepEqual(callbacks.map(value=>new URL(value).origin),Array(3).fill('http://127.0.0.1:3000'));
    assert.deepEqual(callbacks.map(value=>new URL(value).searchParams.get('next')),['/discovery-save','/discovery-save','/update-password']);
  });
});
