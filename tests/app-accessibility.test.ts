import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { DecideClient } from '../src/app/(app)/ask/decide-client';
import { ReflectionForm } from '../src/app/(app)/history/reflection-form';
import { EditableBasics } from '../src/app/(app)/profile/profile-client';
import { EditableMemory,MemoryLibrary,MemoryInspector } from '../src/app/(app)/profile/memory-inspector';
import { PrivacyControls } from '../src/app/(app)/profile/privacy-controls';
import { pollResult } from '../src/lib/services/poll-result';
import type { CompareResult } from '../src/app/(app)/ask/actions';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://nudge.test/ask' });
for (const [name,value] of Object.entries({ window:dom.window, self:dom.window, document:dom.window.document, navigator:dom.window.navigator, FormData:dom.window.FormData }))
  Object.defineProperty(globalThis,name,{value,configurable:true});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT:boolean }).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root | undefined;
afterEach(async()=>{ if(root) await act(async()=>root!.unmount()); root=undefined; document.body.replaceChildren(); });
async function mount(element:ReturnType<typeof createElement>) {
  const { createRoot }=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>{root!.render(element);});
}
const button=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.includes(text))!;
const result:CompareResult={decisionId:'decision',title:'Dinner',category:'food',confidence:'low',evidenceState:'personal_fit',coldStart:false,status:'open',options:[
  {id:'a',label:'Soup',score:.6,breakdown:{},warning:false,reasons:['Saved preference']},
  {id:'b',label:'Pizza',score:.5,breakdown:{},warning:false,reasons:['Saved preference']},
]};
type Actions=NonNullable<Parameters<typeof DecideClient>[0]['actions']>;
function actions(overrides:Partial<Actions>={}):Actions {
  return {compareOptions:async()=>result,askNaturally:async()=>result,refreshComparison:async()=>result,
    chooseOption:async()=>({}),abandonDecision:async()=>{},explainDecision:async()=>null,suggestOptions:async()=>['Soup','Pizza'],...overrides};
}
function enter(input:HTMLInputElement){input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}
function change(input:HTMLInputElement|HTMLTextAreaElement,value:string){
  const prototype=input instanceof dom.window.HTMLTextAreaElement?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(input,value);
  input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
}

describe('app accessibility and retry interactions',()=>{
  it('preserves an already-reflected choice acknowledged after another tab saved it',async()=>{
    await mount(createElement(DecideClient,{initialOptions:[],initialResult:result,actions:actions({chooseOption:async()=>({status:'reflected'})})}));
    await act(async()=>button('Choose this').click());
    assert.match(document.body.textContent!,/already has a reflection/);
    assert.equal(document.body.textContent!.includes('When should Nudge check in?'),false);
    assert.equal([...document.querySelectorAll('button')].some(b=>b.textContent!.includes('Choose this')),false);
  });
  it('reviews ambiguous meaning before saving, retains drafts, and abstains from an unsupported winner',async()=>{
    const sent:unknown[][]=[];
    await mount(createElement(DecideClient,{initialOptions:['Mining','Woodcutting'],actions:actions({
      compareOptions:async(...args)=>{sent.push(args);const context=args[2];
        if(!context?.meaningConfirmed)return {...result,decisionId:'',clarification:{options:['Mining','Woodcutting'],category:'hobbies',domain:'',goal:'',
          source:'manual',question:'Which setting and goal?',unfamiliarTerms:[],notice:'Nothing has been saved.'}};
        return {...result,title:'Gather materials',evidenceState:'insufficient',meaning:context};}
    })}));
    await act(async()=>button('Compare 2').click());
    assert.match(document.body.textContent!,/Add a little context/);
    assert.match(document.activeElement?.textContent??'',/Add a little context/);
    assert.equal([...document.querySelectorAll('button')].some(b=>b.textContent==='Choose this'),false);
    await act(async()=>button('Compare options').click());assert.equal(sent.length,1);
    const setting=document.querySelector<HTMLInputElement>('input[placeholder^="A game"]')!;
    assert.ok(setting.labels?.length);
    await act(async()=>change(setting,'Custom game v2'));
    await act(async()=>change(document.querySelector<HTMLInputElement>('input[placeholder="Your goal and any information still needed"]')!,'Build shelter'));
    await act(async()=>button('Compare options').click());assert.equal(sent.length,2);
    assert.equal((sent[1][2] as {domain:string}).domain,'Custom game v2');
    assert.match(document.body.textContent!,/not enough relevant evidence/);
    assert.match(document.body.textContent!,/Custom game v2/);
    assert.equal(document.body.textContent!.includes('Leaning'),false);
    assert.match(document.body.textContent!,/insufficient evidence/);
  });
  it('names every comparison input persistently and exposes context selection state',async()=>{
    await mount(createElement(DecideClient,{initialOptions:['Soup','Pizza'],actions:actions()}));
    for(const input of document.querySelectorAll<HTMLInputElement>('input'))assert.ok(input.labels?.length,input.outerHTML);
    assert.equal(button('Food').getAttribute('aria-pressed'),'false');
    await act(async()=>button('Food').click());
    assert.equal(button('Food').getAttribute('aria-pressed'),'true');
    assert.match(document.body.textContent!,/journal notes; they do not change the current scores/);
  });
  it('blocks repeated Enter/click comparison writes before rerender and releases the guard after failure',async()=>{
    let calls=0;let finish!:(value:CompareResult)=>void;const requestIds:unknown[]=[];
    const api=actions({compareOptions:async(...args:unknown[])=>{requestIds.push(args[3]);calls++;if(calls===1)return new Promise(resolve=>{finish=resolve;});return {...result,error:'Retry failed'};}});
    await mount(createElement(DecideClient,{initialOptions:['Soup','Pizza'],actions:api}));
    await act(async()=>{button('Compare 2').click();enter(document.querySelector<HTMLInputElement>('input[placeholder="First option"]')!);button('Compare 2').click();});
    assert.equal(calls,1);
    await act(async()=>finish({...result,error:'Temporary failure'}));
    assert.match(document.querySelector('[role="alert"]')!.textContent!,/Temporary failure/);
    await act(async()=>button('Compare 2').click());assert.equal(calls,2);
    assert.match(String(requestIds[0]),/^[a-f0-9-]{36}$/);assert.equal(requestIds[0],requestIds[1]);
    await act(async()=>change(document.querySelector<HTMLInputElement>('input[placeholder="First option"]')!,'Salad'));
    await act(async()=>button('Compare 2').click());assert.equal(calls,3);assert.notEqual(requestIds[2],requestIds[1]);
  });
  it('blocks repeated natural-question submissions synchronously',async()=>{
    let calls=0;let finish!:(value:CompareResult)=>void;const requestIds:unknown[]=[];
    await mount(createElement(DecideClient,{initialOptions:[],actions:actions({askNaturally:async(...args:unknown[])=>{requestIds.push(args[1]);calls++;if(calls===1)return new Promise(resolve=>{finish=resolve;});return {...result,error:'Try again'};}})}));
    const question=document.querySelector<HTMLInputElement>('input[placeholder="What should I eat tonight?"]')!;
    await act(async()=>change(question,'What should I eat tonight?'));
    await act(async()=>{enter(question);enter(question);button('Ask Nudge')?.click();});
    assert.equal(calls,1);await act(async()=>finish({...result,error:'Try again'}));
    await act(async()=>enter(question));assert.equal(calls,2);assert.equal(requestIds[0],requestIds[1]);
    await act(async()=>change(question,'What should I watch tonight?'));
    await act(async()=>enter(question));assert.equal(calls,3);assert.notEqual(requestIds[1],requestIds[2]);
  });
  it('keeps suggestion transport failure retryable without discarding existing options',async()=>{
    let calls=0;
    await mount(createElement(DecideClient,{initialOptions:['Tea',''],actions:actions({suggestOptions:async()=>{if(++calls===1)throw new Error('offline');return ['Soup','Pizza'];}})}));
    await act(async()=>button('Suggest options').click());
    assert.match(document.querySelector('[role="alert"]')!.textContent!,/Please try again/);
    assert.equal(document.querySelector<HTMLInputElement>('input[placeholder="First option"]')!.value,'Tea');
    await act(async()=>button('Suggest options').click());assert.equal(calls,2);
    assert.equal(document.querySelector<HTMLInputElement>('input[placeholder="Second option"]')!.value,'Soup');
    assert.equal(document.querySelector('[role="alert"]'),null);
  });
  it('restores the selected option when a retry returns an already decided comparison',async()=>{
    const decided={...result,status:'decided' as const,selectedOptionId:'a'};
    await mount(createElement(DecideClient,{initialOptions:['Soup','Pizza'],actions:actions({compareOptions:async()=>decided})}));
    await act(async()=>button('Compare 2').click());
    assert.match(document.body.textContent!,/Soup/);
    assert.equal([...document.querySelectorAll('button')].some(node=>node.textContent?.trim()==='Choose this'),false);
    assert.match(document.body.textContent!,/Tomorrow|Check-in|chosen|chose|Locked/i);
  });
  it('serializes add-option Enter and refresh actions and explains score limits',async()=>{
    let calls=0;let finish!:(value:CompareResult)=>void;
    await mount(createElement(DecideClient,{initialOptions:[],initialResult:result,actions:actions({refreshComparison:async()=>{calls++;return new Promise(resolve=>{finish=resolve;});}})}));
    const extra=document.querySelector<HTMLInputElement>('input[placeholder="Type it here"]')!;
    assert.ok(extra.labels?.length);
    await act(async()=>change(extra,'Salad'));
    await act(async()=>{enter(extra);enter(extra);button('Refresh with current memory').click();});
    assert.equal(calls,1);
    await act(async()=>finish({...result,error:'Temporary refresh failure'}));
    assert.equal(extra.value,'Salad');assert.match(document.body.textContent!,/not a probability of a good outcome/);
    assert.equal(document.querySelector('[role="alert"]')?.textContent,'Temporary refresh failure');
  });
  it('uses one native radio group with a fieldset legend and labels reflection notes',async()=>{
    await mount(createElement(ReflectionForm,{decisionId:'decision'}));
    const radios=[...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    assert.equal(radios.length,5);assert.equal(new Set(radios.map(input=>input.name)).size,1);
    assert.match(document.querySelector('fieldset legend')!.textContent!,/Rating out of 5/);
    assert.ok(document.querySelector<HTMLTextAreaElement>('textarea')!.labels?.length);
    await act(async()=>radios[3].click());assert.equal(radios[3].checked,true);
    assert.equal(button('Save reflection').disabled,false);
    await act(async()=>radios[1].click());assert.equal(radios[3].checked,false);assert.equal(radios[1].checked,true);
  });
  it('retains visible profile field labels after values are entered',async()=>{
    await mount(createElement(EditableBasics,{profile:{full_name:'Tester',country:'Türkiye',language:'English',occupation:'Student'}}));
    await act(async()=>button('Edit').click());
    for(const input of document.querySelectorAll<HTMLInputElement>('input'))assert.ok(input.labels?.[0].textContent?.trim(),input.name);
    assert.equal(document.querySelectorAll('input').length,4);
  });
  it('shows the persisted profile immediately and uses it as the next edit/cancel baseline',async()=>{
    const profile={full_name:'Original',country:null,language:'en',occupation:null};
    await mount(createElement(EditableBasics,{profile,saveAction:async form=>({profile:{...profile,full_name:String(form.get('full_name')).trim()}})}));
    await act(async()=>button('Edit').click());await act(async()=>change(document.querySelector<HTMLInputElement>('input[name=full_name]')!,'Saved name'));
    await act(async()=>button('Save').click());assert.match(document.body.textContent!,/Saved name/);
    await act(async()=>button('Edit').click());assert.equal(document.querySelector<HTMLInputElement>('input[name=full_name]')!.value,'Saved name');
    await act(async()=>change(document.querySelector<HTMLInputElement>('input[name=full_name]')!,'Unsaved draft'));
    await act(async()=>button('Cancel').click());assert.match(document.body.textContent!,/Saved name/);assert.ok(!document.body.textContent!.includes('Unsaved draft'));
  });
  it('keeps profile drafts open when the save fails or no persisted row is returned',async()=>{
    let result:{error?:string}={error:'Connection lost'};
    await mount(createElement(EditableBasics,{profile:{full_name:'Original',country:null,language:'en',occupation:null},saveAction:async()=>result}));
    await act(async()=>button('Edit').click());await act(async()=>change(document.querySelector<HTMLInputElement>('input[name=full_name]')!,'Keep draft'));
    await act(async()=>button('Save').click());assert.equal(document.querySelector<HTMLInputElement>('input[name=full_name]')!.value,'Keep draft');assert.match(document.body.textContent!,/Connection lost/);
    result={};await act(async()=>button('Save').click());assert.ok(document.querySelector('form'));assert.match(document.body.textContent!,/verify your saved profile/);
  });
});

describe('profile memory interactions',()=>{
  it('hydrates stored belief dates consistently when server and browser default date formats differ',async()=>{
    const {renderToString}=await import('react-dom/server');
    const {hydrateRoot}=await import('react-dom/client');
    const original=Date.prototype.toLocaleDateString;const errors:unknown[]=[];
    const element=createElement(MemoryInspector,{timeZone:'Europe/Istanbul',nodes:[{id:'belief',key:'food.soup',value:'Soup',category_slug:'food',polarity:'like',confidence:.8,source:'explicit',evidence_count:1,last_reinforced_at:'2026-10-15T00:00:00Z'}]});
    try{
      Date.prototype.toLocaleDateString=()=> 'SERVER DEFAULT';
      const container=document.createElement('div');container.innerHTML=renderToString(element);document.body.append(container);
      Date.prototype.toLocaleDateString=()=> 'BROWSER DEFAULT';
      await act(async()=>{root=hydrateRoot(container,element,{onRecoverableError:error=>errors.push(error)});});
      assert.deepEqual(errors,[]);assert.equal(container.querySelector('time')!.textContent,'Oct 15, 2026');
    }finally{Date.prototype.toLocaleDateString=original;}
  });
  it('cancels to the most recently saved memory, rather than its initial prop',async()=>{
    const writes:unknown[][]=[];
    await mount(createElement(EditableMemory,{memory:{id:'m',content:'Original',kind:'fact',confidence:.8},saveMemory:async(...args)=>{writes.push(args);return {};}}));
    await act(async()=>button('Edit').click());await act(async()=>change(document.querySelector('textarea')!,'Saved version'));
    await act(async()=>button('Save').click());assert.match(document.body.textContent!,/Saved version/);
    await act(async()=>button('Edit').click());await act(async()=>change(document.querySelector('textarea')!,'Unsaved draft'));
    await act(async()=>button('Cancel').click());assert.match(document.body.textContent!,/Saved version/);assert.ok(!document.body.textContent!.includes('Unsaved draft'));
    assert.equal(writes.length,1);assert.equal(writes[0][1],'Saved version');
  });
  it('keeps a failed edit open with its draft so it can be retried',async()=>{
    let failed=true;
    await mount(createElement(EditableMemory,{memory:{id:'m',content:'Original',kind:'fact',confidence:.8},saveMemory:async()=>failed?{error:'Save failed'}:{}}));
    await act(async()=>button('Edit').click());await act(async()=>change(document.querySelector('textarea')!,'Keep this draft'));
    await act(async()=>button('Save').click());assert.equal(document.querySelector('textarea')!.value,'Keep this draft');assert.match(document.body.textContent!,/Save failed/);
    failed=false;await act(async()=>button('Save').click());assert.equal(document.querySelector('textarea'),null);assert.match(document.body.textContent!,/Keep this draft/);
  });
  it('reaches memories beyond the initial page, resets search offset and preserves results after transport errors',async()=>{
    const memory=(id:string)=>({id,content:`Memory ${id}`,kind:'fact',confidence:.8,created_at:'2026-10-15T00:00:00Z'});
    const requests:unknown[][]=[];let fail=false;
    await mount(createElement(MemoryLibrary,{initial:[memory('first')],initialHasMore:true,load:async(query,offset)=>{requests.push([query,offset]);if(fail)throw new Error('offline');return {memories:[memory(query?'searched':'twenty-first')],hasMore:false};}}));
    await act(async()=>button('Next memories').click());assert.deepEqual(requests[0],['',20]);assert.match(document.body.textContent!,/Memory twenty-first/);
    await act(async()=>change(document.querySelector<HTMLInputElement>('input[placeholder="Search memory text"]')!,'walk'));
    await act(async()=>button('Search memories').click());assert.deepEqual(requests[1],['walk',0]);assert.match(document.body.textContent!,/Memory searched/);
    fail=true;await act(async()=>button('Refresh memories').click());assert.match(document.body.textContent!,/Memory searched/);assert.match(document.querySelector('[role="alert"]')!.textContent!,/Please try again/);
  });
  it('does not offer note transmission without opt-in and keeps explicitly submitted failed notes retryable',async()=>{
    let calls=0;let fail=true;
    await mount(createElement(PrivacyControls,{aiEnabled:false,accepted:true,saveNotes:async()=>{calls++;return {draft:{generation:7,suggestions:[{kind:'goal' as const,content:'Walk more'}]}};}}));
    assert.equal(document.querySelector('textarea'),null);assert.equal(calls,0);
    await act(async()=>root!.unmount());root=undefined;document.body.replaceChildren();
    await mount(createElement(PrivacyControls,{aiEnabled:true,accepted:true,saveNotes:async()=>{calls++;return fail?{error:'Temporary extraction failure'}:{draft:{generation:7,suggestions:[{kind:'goal' as const,content:'Walk more'}]}};}}));
    assert.equal(calls,0);await act(async()=>change(document.querySelector('textarea')!,'I want to walk more.'));
    await act(async()=>document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
    assert.equal(calls,1);assert.equal(document.querySelector('textarea')!.value,'I want to walk more.');assert.match(document.body.textContent!,/Temporary extraction failure/);
    fail=false;await act(async()=>document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
    assert.equal(calls,2);assert.equal(document.querySelector('textarea')!.value,'I want to walk more.');assert.match(document.body.textContent!,/Nothing has been saved/);
    assert.match(document.body.textContent!,/Review suggested memories/);assert.equal(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked,false);
  });
});

describe('closed poll outcomes',()=>{
  const options=[{id:'a'},{id:'b'},{id:'c'}];
  it('never assigns a winner without votes',()=>{assert.deepEqual(pollResult(options,new Map()),{winnerId:null,tiedIds:[],hasVotes:false});});
  it('reports all tied leaders and remains independent of option order',()=>{
    const counts=new Map([['a',2],['b',2],['c',1]]);
    assert.equal(pollResult(options,counts).winnerId,null);
    assert.deepEqual(pollResult(options,counts).tiedIds,['a','b']);
    assert.equal(pollResult([...options].reverse(),counts).winnerId,null);
  });
  it('assigns only a unique positive leader as winner',()=>{assert.deepEqual(pollResult(options,new Map([['b',1]])),{winnerId:'b',tiedIds:[],hasVotes:true});});
});
