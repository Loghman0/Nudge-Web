import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { parseOnboardingInput } from '../src/lib/services/onboarding-input';
import { postFoundationPath, signupFoundationPath } from '../src/lib/auth/foundation-path';
import { safeReturnPath } from '../src/lib/auth/return-path';
import { authRedirectOrigin } from '../src/lib/auth/redirect-origin';

const nativeRequire=createRequire(import.meta.url);
const plain=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
function load(path:string,modules:Record<string,unknown>,env:Record<string,string>={}){
  const source=readFileSync(new URL(path,import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports:Record<string,any>={};
  vm.runInNewContext(compiled,{exports,require:(name:string)=>{
    if(name==='next/headers')return {headers:async()=>new Headers()};
    if(name==='@/lib/auth/redirect-origin')return {authRedirectOrigin};
    if(/services\/(?:ai|knowledge|rate-limit)/.test(name))throw new Error(`Unexpected optional learning dependency: ${name}`);
    return modules[name]??nativeRequire(name);
  },URL,Date,console,FormData,process:{env:{NEXT_PUBLIC_SITE_URL:'https://nudge.test',...env}}});
  return exports;
}
function redirect(path:string):never{throw new Error(`redirect:${path}`);}
const questionId='12000000-0000-4000-8000-000000000001';
const valid=()=>({fullName:' Sam ',country:'Retain existing country',language:'Retain existing language',age:'24',occupation:'Retain existing occupation',about:'A legacy note must not trigger optional AI extraction.',expectedGeneration:7,next:'/groups?invite=fixture',answers:[{questionId,answer:'a',prefKey:'forged.client.preference'}]});

function actionHarness(options:{user?:boolean;error?:string;generation?:number|null}={}){
  const calls:{name:string;args:Record<string,unknown>}[]=[];let creates=0,auth=0;
  const db={auth:{getUser:async()=>{auth++;return {data:{user:options.user===false?null:{id:'user-a'}}};}},
    rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args:plain(args)});return {data:options.generation===undefined?7:options.generation,error:options.error?{message:options.error}:null};},
    from:()=>{throw new Error('Setup must not read a fresh generation or write other tables.');}};
  const action=load('../src/app/(app)/onboarding/actions.ts',{'next/navigation':{redirect},'@/lib/supabase/server':{createClient:async()=>{creates++;return db;}},'@/lib/services/onboarding-input':{parseOnboardingInput}}).completeOnboarding;
  return {action,calls,creates:()=>creates,auth:()=>auth};
}

describe('confirmed foundation server actions',()=>{
  it('submits only the reviewed name and choices using the captured generation, without optional extraction',async()=>{
    const h=actionHarness();await assert.rejects(()=>h.action(valid()),/redirect:\/groups\?invite=fixture/);
    assert.equal(h.creates(),1);assert.equal(h.auth(),1);assert.deepEqual(h.calls,[{name:'complete_onboarding',args:{p_profile:{fullName:'Sam'},p_answers:[{questionId,answer:'a'}],p_expected_generation:7}}]);
    assert.deepEqual(Object.keys(h.calls[0].args.p_profile as object),['fullName']);
  });
  it('accepts explicit skips and no-answer setup without inventing a preferred side',async()=>{
    for(const answers of [[],[{questionId,answer:'skip'}]]){
      const h=actionHarness();await assert.rejects(()=>h.action({...valid(),answers,next:'/ask'}),/redirect:\/ask$/);
      assert.deepEqual(h.calls[0].args.p_answers,answers);
    }
  });
  it('stops after a rejected privacy generation and never refreshes it to retry old answers',async()=>{
    const h=actionHarness({generation:null,error:'Memory changed. Please reload onboarding'});
    await assert.rejects(()=>h.action(valid()),/Your memory changed\. Reload the starter questions before saving\./);
    assert.equal(h.calls.length,1);assert.equal(h.calls[0].args.p_expected_generation,7);
    assert.equal(h.auth(),1);
  });
  it('keeps other save failures retryable without a redirect or additional writes',async()=>{
    for(const options of [{generation:null},{generation:null,error:'Transport unavailable'}]){
      const h=actionHarness(options);await assert.rejects(()=>h.action(valid()),/draft is still here/);assert.equal(h.calls.length,1);
    }
  });
  it('requires authentication before the completion RPC',async()=>{
    const h=actionHarness({user:false});await assert.rejects(()=>h.action(valid()),/redirect:\/login$/);assert.equal(h.calls.length,0);
  });
  it('rejects invalid serialized inputs before creating a database client',async()=>{
    const h=actionHarness();
    for(const raw of [null,{}, {...valid(),expectedGeneration:undefined},{...valid(),expectedGeneration:-1},{...valid(),answers:[{questionId,answer:'guessed'}]}])await assert.rejects(()=>h.action(raw));
    assert.equal(h.creates(),0);assert.equal(h.auth(),0);assert.equal(h.calls.length,0);
  });
  it('sanitizes the deferred destination instead of returning through signup or onboarding',async()=>{
    for(const next of ['https://outside.invalid','//outside.invalid','/onboarding?next=%2Fgroups','/login','/signup','/reset-password','/update-password','/consent']){
      const h=actionHarness();await assert.rejects(()=>h.action({...valid(),next}),/redirect:\/ask$/);assert.equal(h.calls.length,1);
    }
  });
});

interface Query{table:string;operations:unknown[][]}
const defaultCatalog=Array.from({length:6},(_,index)=>({id:`12000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,kind:'this_or_that',prompt:`Contextual choice ${index+1}?`,option_a:'A',option_b:'B',maps_to_key_a:'a',maps_to_key_b:'b',sort_order:index+1,context:{foundationEdition:'1',starterRationale:'A preference for this situation only.'}}));
function pageHarness(options:{user?:boolean;profile?:Record<string,unknown>|null;profileError?:boolean;catalogError?:boolean;catalog?:unknown[]}={}){
  const queries:Query[]=[];
  const db={auth:{getUser:async()=>({data:{user:options.user===false?null:{id:'user-a'}}})},from:(table:string)=>{
    const query={table,operations:[] as unknown[][]};queries.push(query);
    const data=table==='profiles'?{data:options.profile===undefined?{full_name:'Sam',onboarded_at:null,memory_generation:7}:options.profile,error:options.profileError?{message:'unavailable'}:null}:{data:options.catalog??defaultCatalog,error:options.catalogError?{message:'unavailable'}:null};
    const chain:Record<string,any>={then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>Promise.resolve(data).then(resolve,reject)};
    for(const name of ['select','eq','single','order','limit'])chain[name]=(...args:unknown[])=>{query.operations.push([name,...args]);return chain;};
    return chain;
  }};
  const Flow=()=>null;
  const page=load('../src/app/(app)/onboarding/page.tsx',{'next/navigation':{redirect},'@/lib/supabase/server':{createClient:async()=>db},'@/components/onboarding/onboarding-flow':{OnboardingFlow:Flow},'@/lib/auth/foundation-path':{postFoundationPath}}).default;
  return {page,queries,Flow};
}

describe('owned foundation catalog page',()=>{
  it('loads the owner profile and exactly the six-question edition, carrying rationale and captured generation to the UI',async()=>{
    const h=pageHarness();const result=await h.page({searchParams:Promise.resolve({next:'/groups?invite=fixture'})});const ui=result.props.children;
    assert.equal(ui.type,h.Flow);assert.equal(ui.props.initialName,'Sam');assert.equal(ui.props.initialGeneration,7);assert.equal(ui.props.returnTo,'/groups?invite=fixture');assert.equal(ui.props.questionRationales[questionId],'A preference for this situation only.');
    const profile=h.queries.find(query=>query.table==='profiles')!;assert.ok(profile.operations.some(value=>value[0]==='eq'&&value[1]==='id'&&value[2]==='user-a'));
    const catalog=h.queries.find(query=>query.table==='questions')!;
    for(const operation of [['eq','is_onboarding',true],['eq','is_active',true],['eq','context->>foundationEdition','1'],['limit',6]])assert.ok(catalog.operations.some(value=>JSON.stringify(value)===JSON.stringify(operation)));
    assert.deepEqual(catalog.operations.filter(value=>value[0]==='order'),[['order','sort_order'],['order','id']]);
    assert.equal(h.queries.length,2);
  });
  it('redirects completed accounts to their deferred destination without querying starter questions again',async()=>{
    const destinations:[string|undefined,string][]=[[undefined,'/dashboard'],['/groups?invite=fixture','/groups?invite=fixture']];
    for(const [next,destination] of destinations){
      const h=pageHarness({profile:{full_name:'Sam',onboarded_at:'2026-10-25T00:00:00Z',memory_generation:7}});
      await assert.rejects(()=>h.page({searchParams:Promise.resolve({next})}),new RegExp(`^Error: redirect:${destination.replace(/[?]/g,'\\?')}$`));
      assert.equal(h.queries.length,1);
    }
  });
  it('keeps an unavailable catalog honest and provides the safe compare exit without marking setup complete',async()=>{
    const h=pageHarness({catalogError:true});const result=await h.page({searchParams:Promise.resolve({next:'https://outside.invalid'})});
    assert.deepEqual(plain(result.props.children.props.questions),[]);assert.equal(result.props.children.props.returnTo,'/ask');assert.equal(result.props.children.props.initialGeneration,7);
    assert.ok(h.queries.every(query=>query.operations.every(value=>!['insert','update','upsert','rpc'].includes(String(value[0])))));
  });
  it('does not silently complete a partial catalog or a server-truncated page',async()=>{
    for(const catalog of [[],defaultCatalog.slice(0,1),defaultCatalog.slice(0,5)]){
      const h=pageHarness({catalog});const result=await h.page({searchParams:Promise.resolve({})});
      assert.deepEqual(plain(result.props.children.props.questions),[]);assert.deepEqual(plain(result.props.children.props.questionRationales),{});
      assert.equal(result.props.children.props.returnTo,'/ask');
    }
  });
  it('requires a signed-in profile and never treats a missing profile as an empty setup',async()=>{
    const anonymous=pageHarness({user:false});await assert.rejects(()=>anonymous.page({searchParams:Promise.resolve({})}),/redirect:\/login$/);assert.equal(anonymous.queries.length,0);
    for(const options of [{profile:null},{profileError:true}]){const h=pageHarness(options);await assert.rejects(()=>h.page({searchParams:Promise.resolve({})}),/Could not load your profile/);assert.equal(h.queries.length,1);}
  });
});

describe('foundation-aware OAuth and safe deferred paths',()=>{
  it('wraps a deliberate invitation through setup and blocks auth loops and external destinations',()=>{
    assert.equal(signupFoundationPath('/groups?invite=fixture'),'/onboarding?next=%2Fgroups%3Finvite%3Dfixture');
    assert.equal(postFoundationPath('/ask?copy=fixture'),'/ask?copy=fixture');
    for(const value of [undefined,'https://outside.invalid','//outside.invalid','/\\outside.invalid','/onboarding','/onboarding/again','/login','/signup','/reset-password','/update-password','/consent']){
      assert.equal(postFoundationPath(value),'/ask');assert.equal(signupFoundationPath(value),'/onboarding');
    }
  });
  it('marks Google signup as foundation-aware and preserves the Google login route separately',()=>{
    const ReturnField=()=>null;
    const Google=load('../src/components/ui/google-button.tsx',{'@/components/legal/auth-return-field':{AuthReturnField:ReturnField},'@/app/auth/actions':{signInWithGoogle:()=>{}}}).GoogleButton;
    const signup=Google({label:'Continue with Google',fallback:'/onboarding',foundation:true});
    assert.equal(signup.props.children[0].type,ReturnField);assert.equal(signup.props.children[0].props.fallback,'/onboarding');
    assert.equal(signup.props.children[1].type,'input');assert.equal(signup.props.children[1].props.name,'foundation');assert.equal(signup.props.children[1].props.value,'on');
    assert.equal(Google({label:'Sign in with Google'}).props.children[1],false);
  });
  it('wires the signup page to the foundation-aware Google button',()=>{
    const Google=()=>null;
    const Field=()=>null;
    for(const enabled of ['true','false']) {
    const Page=load('../src/app/(auth)/signup/page.tsx',{'react':{useActionState:()=>[{},()=>{},false]},'next/link':()=>null,
      '@/components/legal/auth-return-field':{AuthReturnField:()=>null,AuthSwitchLink:()=>null},'@/app/auth/actions':{signUpWithEmail:async()=>({})},
      '@/components/ui/button':{Button:()=>null},'../auth-fields':{AuthField:Field,AuthDivider:()=>null,AuthNotice:()=>null},'@/components/ui/google-button':{GoogleButton:Google}}, {NEXT_PUBLIC_EMAIL_SIGNUP_ENABLED:enabled}).default;
    function find(node:any,type:unknown):any{if(!node||typeof node!=='object')return undefined;if(node.type===type)return node;for(const child of [node.props?.children].flat()){const found=find(child,type);if(found)return found;}}
    const tree=Page(),button=find(tree,Google);assert.ok(button);assert.equal(button.props.foundation,true);assert.equal(button.props.fallback,'/onboarding');
    assert.equal(Boolean(find(tree,Field)),enabled==='true');
    }
  });
  it('sends new Google signups through foundation while preserving invitations without a repeated eligibility checkbox',async()=>{
    const targets:string[]=[];
    const auth=load('../src/app/auth/actions.ts',{'next/cache':{revalidatePath:()=>{}},'next/navigation':{redirect},'@/lib/auth/return-path':{safeReturnPath},'@/lib/auth/foundation-path':{signupFoundationPath},'@/lib/supabase/server':{createClient:async()=>({auth:{signInWithOAuth:async(input:{provider:string;options:{redirectTo:string}})=>{assert.equal(input.provider,'google');targets.push(input.options.redirectTo);return {data:{url:'https://provider.invalid/authorize'},error:null};}}})}});
    for(const foundation of [true,false]){const form=new FormData();form.set('next','/groups?invite=fixture');if(foundation)form.set('foundation','on');await assert.rejects(()=>auth.signInWithGoogle(form),/redirect:https:\/\/provider\.invalid\/authorize/);}
    assert.deepEqual(targets.map(value=>new URL(value).searchParams.get('next')),['/onboarding?next=%2Fgroups%3Finvite%3Dfixture','/groups?invite=fixture']);
  });
});
