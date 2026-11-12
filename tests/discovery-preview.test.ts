import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {AppRouterContext,type AppRouterInstance} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {JSDOM} from 'jsdom';
import {afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {SaveDiscoveryPreview} from '../src/components/discovery/save-client';
import {DiscoveryPreview} from '../src/components/discovery/preview-client';
import {PREVIEW_QUESTIONS} from '../src/lib/discovery/catalog';
import {previewQuestionsForEdition} from '../src/lib/discovery/preview-catalog';
import {clearGuestDraft,parseGuestDraft,readGuestDraft,writeGuestDraft,type GuestDiscoveryDraft} from '../src/lib/discovery/guest-draft';

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://nudge.test/discovery-save'});
for(const [name,value] of Object.entries({window:dom.window,self:dom.window,document:dom.window.document,navigator:dom.window.navigator,sessionStorage:dom.window.sessionStorage,localStorage:dom.window.localStorage}))Object.defineProperty(globalThis,name,{value,configurable:true});
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const originalFetch=globalThis.fetch,originalNow=Date.now;
const router:AppRouterInstance={back(){},forward(){},refresh(){},push(){},replace(){},prefetch(){},bfcacheId:'test'};
let root:Root|undefined;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;document.body.replaceChildren();globalThis.fetch=originalFetch;Date.now=originalNow;Object.defineProperty(globalThis,'sessionStorage',{value:dom.window.sessionStorage,configurable:true});clearGuestDraft();});
function draft():GuestDiscoveryDraft{return {version:1,createdAt:Date.now(),requestId:crypto.randomUUID(),answers:PREVIEW_QUESTIONS.map(q=>({questionId:q.id,questionVersion:q.version,response:{kind:'skip'}}))};}
const button=(name:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===name)!;
async function mount(component:typeof SaveDiscoveryPreview|typeof DiscoveryPreview=SaveDiscoveryPreview){const container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root!.render(createElement(AppRouterContext.Provider,{value:router},createElement(component))));}

test('Preview parsing keeps a pinned claim generation and rejects malformed IDs and sequence gaps',()=>{
 const d={...draft(),claimGeneration:4};assert.equal(parseGuestDraft(JSON.stringify(d))?.claimGeneration,4);
 assert.equal(parseGuestDraft(JSON.stringify({...d,claimGeneration:-1})),null);
 assert.equal(parseGuestDraft(JSON.stringify({...d,requestId:'-'.repeat(36)})),null);
 assert.equal(parseGuestDraft(JSON.stringify({...d,answers:d.answers.slice(1)})),null);
});

test('All skipped preview answers make no reflection and can be reviewed from the result screen',async()=>{
 const d=draft();writeGuestDraft(d);await mount(DiscoveryPreview);
 assert.match(document.body.textContent!,/You skipped these questions. Nothing here is used to describe you/);
 await act(async()=>button('Back to questions').click());
 assert.match(document.body.textContent!,/6 \/ 6/);assert.equal(button('Skip').getAttribute('aria-pressed'),'true');
 assert.notEqual(readGuestDraft()?.requestId,d.requestId);
});

test('Preview removes the requested copy and lets an old draft switch editions explicitly',async()=>{
 const old=previewQuestionsForEdition(1)[0];
 writeGuestDraft({version:1,createdAt:Date.now(),requestId:crypto.randomUUID(),answers:[{questionId:old.id,questionVersion:1,response:{kind:'choice',optionId:'a'}}]});
 await mount(DiscoveryPreview);
 assert.match(document.body.textContent!,/You’re finishing an earlier set/);
 assert.doesNotMatch(document.body.textContent!,/A little curiosity, no account needed|Your preview stays in this browser|Nothing is sent to AI/);
 await act(async()=>button('Try updated questions').click());
 assert.match(document.body.textContent!,/After a draining day/);assert.match(document.body.textContent!,/1 \/ 6/);
 assert.equal(readGuestDraft(),null,'Switching does not retain the old answers under new meanings');
});

test('Lost claim responses retain the first privacy generation across retries and reloads',async()=>{
 writeGuestDraft(draft(),true);let reads=0,finish!:(v:Response)=>void;const claims:Record<string,unknown>[]=[];
 globalThis.fetch=async(input,init)=>{
  if(String(input).endsWith('/profile')){reads++;return new Promise(resolve=>{finish=resolve;});}
  claims.push(JSON.parse(String(init?.body)));throw new Error('Connection lost');
 };
 await mount();await act(async()=>{button('Save to my profile').click();button('Save to my profile').click();});assert.equal(reads,1);
 await act(async()=>finish(Response.json({generation:2})));assert.equal(claims.length,1);assert.equal(readGuestDraft(true)?.claimGeneration,2);
 // A later profile reset must not make this pending claim adopt generation 3.
 globalThis.fetch=async(input,init)=>{if(String(input).endsWith('/profile')){reads++;return Response.json({generation:3});}claims.push(JSON.parse(String(init?.body)));return Response.json({error:{message:'Your memory changed.'}},{status:409});};
 await act(async()=>button('Save to my profile').click());
 await act(async()=>root!.unmount());root=undefined;await mount();await act(async()=>button('Save to my profile').click());
 assert.equal(reads,1);assert.deepEqual(claims.map(c=>c.expectedGeneration),[2,2,2]);assert.equal(new Set(claims.map(c=>c.requestId)).size,1);assert.match(document.body.textContent!,/Your memory changed/);
});

test('An open review cannot save an expired or discarded preview',async()=>{
 const d=draft();writeGuestDraft(d,true);let requests=0;globalThis.fetch=async()=>{requests++;return Response.json({generation:0});};
 await mount();Date.now=()=>d.createdAt+86400001;await act(async()=>button('Save to my profile').click());assert.equal(requests,0);assert.match(document.body.textContent!,/preview expired or changed/);
 Date.now=originalNow;writeGuestDraft(d,true);clearGuestDraft();await act(async()=>button('Save to my profile').click());assert.equal(requests,0);
});

test('Clearing a draft still removes persistent storage if session storage is blocked',()=>{
 writeGuestDraft(draft(),true);Object.defineProperty(globalThis,'sessionStorage',{value:{removeItem(){throw new Error('Blocked');}},configurable:true});clearGuestDraft();assert.equal(readGuestDraft(true),null);
});
