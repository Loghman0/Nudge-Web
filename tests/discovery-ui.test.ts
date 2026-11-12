import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {afterEach,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {DailyDiscovery} from '../src/components/discovery/daily-client';
import {DiscoveryProfilePanel} from '../src/components/discovery/profile-client';
import {DiscoveryCriterionSuggestions} from '../src/components/discovery/criterion-suggestions';
import {PREVIEW_QUESTIONS} from '../src/lib/discovery/catalog';
import {DEFAULT_DISCOVERY_SETTINGS,type DiscoveryProfile} from '../src/lib/discovery/contracts';

const dom=new JSDOM('<!DOCTYPE html><html><body></body></html>',{url:'https://nudge.test/dashboard'});
for(const [name,value] of Object.entries({window:dom.window,self:dom.window,document:dom.window.document,navigator:dom.window.navigator}))Object.defineProperty(globalThis,name,{value,configurable:true});
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const originalFetch=globalThis.fetch;
let root:Root|undefined;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;document.body.replaceChildren();globalThis.fetch=originalFetch;});
const profile=():DiscoveryProfile=>({available:true,generation:0,suppressedQuestionIds:[],capabilities:{optionalTopics:false,writtenAnswers:false},answers:[],insights:[],counts:{answers:0,domains:0,confirmed:0},settings:{...DEFAULT_DISCOVERY_SETTINGS},exposures:[]});
const button=(label:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===label);
const text=()=>document.body.textContent!;
const select=(label:string)=>[...document.querySelectorAll<HTMLLabelElement>('label')].find(element=>element.firstChild?.textContent===label)!.querySelector<HTMLSelectElement>('select')!;
function changeSelect(label:string,value:string){const field=select(label);Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new dom.window.Event('change',{bubbles:true}));}
function fakeFetch(handler:(path:string,body:Record<string,any>|undefined)=>unknown|Promise<unknown>){globalThis.fetch=async(input,init)=>Response.json(await handler(String(input).replace('/api/v1/discovery/',''),init?.body?JSON.parse(String(init.body)):undefined));}
async function mount(component=DailyDiscovery){const container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root!.render(createElement(component)));}
const next=(index=0)=>({question:PREVIEW_QUESTIONS[index],generation:0,reason:'coverage'});

describe('self-discovery interactions',()=>{
 it('accepts the freshly verified criterion and omits a null category in both requests',async()=>{
  let reads=0;const bodies:Record<string,any>[]=[],used:unknown[]=[];
  const suggestion={id:'time:scope:a',kind:'criterion' as const,label:'Flexibility',statement:'Initial reflection',scope:'Free time',evidenceIds:['old'],questionIds:['q'],observedAt:null,requiresConfirmation:true as const};
  fakeFetch((_path,body)=>{bodies.push(body!);return {generation:++reads,suggestions:[{...suggestion,statement:reads===1?'Initial reflection':'Updated reflection',evidenceIds:reads===1?['old']:['current']}]};});
  await mount(()=>createElement(DiscoveryCriterionSuggestions,{domain:'travel',category:null,onUse:(s,g)=>used.push([s,g])}));
  await act(async()=>button('Use Flexibility')!.click());
  assert.ok(bodies.every(body=>!Object.hasOwn(body,'category')));assert.deepEqual(used,[[{...suggestion,statement:'Updated reflection',evidenceIds:['current']},2]]);
 });
 it('discards an accepted suggestion response if its decision setting changed in flight',async()=>{
  let reads=0,finish!:(v:unknown)=>void;const used:unknown[]=[];
  const suggestion={id:'id',kind:'criterion' as const,label:'Time',statement:'An answer',scope:'Work',evidenceIds:['a'],questionIds:['q'],observedAt:null,requiresConfirmation:true as const};
  fakeFetch(()=>++reads===2?new Promise(resolve=>{finish=resolve;}):{generation:0,suggestions:[suggestion]});
  const onUse=(s:unknown)=>used.push(s);
  let domain='work';const Component=()=>createElement(DiscoveryCriterionSuggestions,{domain,category:null,onUse});await mount(Component);
  await act(async()=>{button('Use Time')!.click();});
  domain='Minecraft';await act(async()=>root!.render(createElement(Component)));
  await act(async()=>finish({generation:0,suggestions:[suggestion]}));assert.deepEqual(used,[]);
 });
 it('serializes topic changes before fetching and retains the selected draft after a failed change',async()=>{
  let reads=0,finish!:(v:unknown)=>void;
  fakeFetch((path)=>path==='next'?next():++reads===1?profile():new Promise(resolve=>{finish=resolve;}));
  await mount();await act(async()=>button(PREVIEW_QUESTIONS[0].choices![0].label)!.click());
  await act(async()=>{button('Change question')!.click();button('Change question')!.click();});assert.equal(reads,2);
  await act(async()=>finish(profile()));
  fakeFetch((path)=>{if(path==='profile')throw new Error('Try again later');return next();});
  await act(async()=>button(PREVIEW_QUESTIONS[0].choices![0].label)!.click());
  await act(async()=>button('Change question')!.click());
  assert.equal(button(PREVIEW_QUESTIONS[0].choices![0].label)!.getAttribute('aria-pressed'),'true');assert.match(text(),/Try again later/);
 });

 it('keeps optional mood, pace and topic edits local until an explicit question change',async()=>{
  const calls:{path:string;body?:Record<string,any>}[]=[];
  fakeFetch((path,body)=>{calls.push({path,body});return path==='profile'?profile():path==='next'?next():{saved:true};});
  await mount();
  assert.equal(select('Mood (optional)').value,'');assert.ok(select('Pace'));assert.doesNotMatch(text(),/Today feels|A moment for yourself|One question is enough/);
  assert.deepEqual([...select('Mood (optional)').options].map(option=>option.textContent),['No preference','Happy','Excited','Calm','Sad','Angry','Anxious','Tired','Mixed']);
  assert.equal(Object.hasOwn(calls.find(call=>call.path==='next')!.body!,'mood'),false);
  await act(async()=>button(PREVIEW_QUESTIONS[0].choices![0].label)!.click());const initialCalls=calls.length;
  await act(async()=>{changeSelect('Mood (optional)','anxious');changeSelect('Pace','curious');changeSelect('Topic','food');});
  assert.equal(calls.length,initialCalls);assert.equal(button(PREVIEW_QUESTIONS[0].choices![0].label)!.getAttribute('aria-pressed'),'true');
  await act(async()=>button('Change question')!.click());
  const applied=calls.filter(call=>call.path==='next').at(-1)!.body!;
  assert.equal(applied.mood,'anxious');assert.equal(applied.mode,'curious');assert.equal(applied.topic,'food');assert.equal(applied.change,true);
  assert.equal(calls.some(call=>call.path==='answers'),false);
  const afterApply=calls.length;await act(async()=>changeSelect('Mood (optional)',''));assert.equal(calls.length,afterApply);
  await act(async()=>button('Change question')!.click());assert.equal(Object.hasOwn(calls.filter(call=>call.path==='next').at(-1)!.body!,'mood'),false);
 });

 it('freezes reservation retries with their original mood and request ID until an explicit changed intent',async()=>{
  const requests:Record<string,any>[]=[];
  fakeFetch((path,body)=>{if(path==='profile')return profile();if(path==='next'){requests.push(body!);if(requests.length>1)throw new Error('Connection lost');return next();}throw new Error('Unexpected answer write');});
  await mount();await act(async()=>changeSelect('Mood (optional)','angry'));await act(async()=>button('Change question')!.click());
  await act(async()=>button('Change question')!.click());
  assert.deepEqual(requests[2],requests[1]);assert.equal(requests[1].mood,'angry');
  await act(async()=>changeSelect('Mood (optional)','calm'));
  assert.equal(requests.length,3);assert.equal(requests[1].mood,'angry');assert.equal(requests[2].mood,'angry');
  await act(async()=>button('Change question')!.click());assert.notEqual(requests[3].requestId,requests[1].requestId);assert.equal(requests[3].mood,'calm');
 });

 it('never attaches mood to an answer save and starts a new session without the previous mood',async()=>{
  const calls:{path:string;body?:Record<string,any>}[]=[];
  fakeFetch((path,body)=>{calls.push({path,body});return path==='profile'?profile():path==='next'?next():{saved:true};});
  await mount();await act(async()=>changeSelect('Mood (optional)','sad'));await act(async()=>button('Change question')!.click());
  await act(async()=>button('It depends')!.click());await act(async()=>button('Save answer')!.click());
  assert.equal(Object.hasOwn(calls.find(call=>call.path==='answers')!.body!,'mood'),false);
  assert.equal(dom.window.localStorage.length,0);assert.equal(dom.window.sessionStorage.length,0);
  await act(async()=>root!.unmount());root=undefined;document.body.replaceChildren();await mount();
  assert.equal(select('Mood (optional)').value,'');assert.equal(Object.hasOwn(calls.filter(call=>call.path==='next').at(-1)!.body!,'mood'),false);
 });

 it('retries the same save with its original request ID and uses a new ID for a changed answer',async()=>{
  const saves:Record<string,any>[]=[];
  fakeFetch((path,body)=>{if(path==='next')return next();if(path==='profile')return profile();saves.push(body!);throw new Error('Connection lost');});
  await mount();await act(async()=>button(PREVIEW_QUESTIONS[0].choices![0].label)!.click());
  await act(async()=>{button('Save answer')!.click();button('Save answer')!.click();});assert.equal(saves.length,1);
  await act(async()=>button('Save answer')!.click());assert.equal(saves[1].requestId,saves[0].requestId);
  await act(async()=>button('It depends')!.click());await act(async()=>button('Save answer')!.click());assert.notEqual(saves[2].requestId,saves[0].requestId);
 });

 it('keeps acknowledged saves complete when the following profile refresh fails',async()=>{
  let reads=0,saves=0;
  fakeFetch(path=>{if(path==='next')return next();if(path==='answers'){saves++;return {saved:true};}if(++reads>1)throw new Error('Could not load');return profile();});
  await mount();await act(async()=>button('It depends')!.click());await act(async()=>button('Save answer')!.click());
  assert.equal(saves,1);assert.equal(button('Save answer'),undefined);assert.match(text(),/Your answer was saved, but your updated profile could not load/);assert.match(text(),/A small piece of your story, saved/);
 });

 it('passes session fatigue counts and resets them only after explicit continuation',async()=>{
  const requests:Record<string,any>[]=[];
  fakeFetch((path,body)=>{if(path==='next'){requests.push(body!);return next((requests.length-1)%PREVIEW_QUESTIONS.length);}return path==='profile'?profile():{saved:true};});
  await mount();
  for(let i=0;i<4;i++){
   await act(async()=>button('It depends')!.click());await act(async()=>button('Save answer')!.click());
   await act(async()=>button(i===2?'Another three':'One more question')!.click());
  }
  assert.deepEqual(requests.slice(1).map(r=>[r.sessionAnswers,r.continueAfterPause]),[[1,false],[2,false],[3,true],[1,false]]);
 });

 it('keeps forgotten answers visible for deletion without offering to restore them',async()=>{
  const p=profile(),question=PREVIEW_QUESTIONS[0];p.suppressedQuestionIds=[question.id];p.answers=[{id:'answer',questionId:question.id,questionVersion:question.version,question,response:{kind:'depends'},revision:1,active:false,useInProfile:false,answeredAt:'2026-10-30T08:00:00Z'}];
  fakeFetch(()=>p);await mount(DiscoveryProfilePanel);
  assert.match(text(),/Forgotten — not used in your profile/);assert.equal(button('Use in profile'),undefined);assert.equal(button('Edit'),undefined);assert.ok(button('Delete'));
  const checkboxes=[...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];assert.equal(checkboxes.filter(c=>c.disabled).length,2);
 });

 it('retries profile corrections with the same request and reconciles the editor after a saved-change refresh error',async()=>{
  const p=profile(),question=PREVIEW_QUESTIONS[0],writes:Record<string,any>[]=[];let refreshFails=false;
  p.answers=[{id:'answer',questionId:question.id,questionVersion:question.version,question,response:{kind:'choice',optionId:question.choices![0].id},revision:1,active:true,useInProfile:true,answeredAt:'2026-10-30T08:00:00Z'}];
  fakeFetch((path,body)=>{if(path==='profile'){if(refreshFails)throw new Error('Refresh failed');return p;}writes.push(body!);if(writes.length===1)throw new Error('Connection lost');refreshFails=true;return {saved:true};});
  await mount(DiscoveryProfilePanel);await act(async()=>button('Edit')!.click());await act(async()=>button('It depends')!.click());
  await act(async()=>{button('Save correction')!.click();button('Save correction')!.click();});assert.equal(writes.length,1);
  await act(async()=>button('Save correction')!.click());assert.equal(writes[0].requestId,writes[1].requestId);assert.match(text(),/Your change was saved, but the updated profile could not load/);
  refreshFails=false;p.answers[0]={...p.answers[0],response:{kind:'depends'},revision:2};
  await act(async()=>button('Retry')!.click());assert.equal(button('Save correction'),undefined);assert.match(text(),/It depends/);
 });
});
