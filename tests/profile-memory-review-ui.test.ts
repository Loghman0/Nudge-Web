import { act,createElement } from "react";
import { afterEach,describe,it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
import { PrivacyControls } from "../src/app/(app)/profile/privacy-controls";
import { createLanguageTasks } from "../src/lib/services/ai/language-tasks";

const dom=new JSDOM('<!DOCTYPE html><html><body></body></html>',{url:'https://nudge.test/profile'});
for(const [name,value] of Object.entries({window:dom.window,self:dom.window,document:dom.window.document,navigator:dom.window.navigator,FormData:dom.window.FormData}))Object.defineProperty(globalThis,name,{value,configurable:true});
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|undefined;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;document.body.replaceChildren();});
async function mount(props:Partial<Parameters<typeof PrivacyControls>[0]>={}){
  const {createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root!.render(createElement(PrivacyControls,{aiEnabled:true,accepted:true,saveNotes:async()=>({draft:{generation:7,suggestions:[{kind:'goal' as const,content:'Walk more'},{kind:'habit' as const,content:'Reads every evening'}]}}),...props})));
}
const button=(label:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(value=>value.textContent===label)!;
const label=(text:string)=>[...document.querySelectorAll<HTMLLabelElement>('label')].find(value=>value.textContent===text)!;
const field=(text:string)=>document.getElementById(label(text).htmlFor) as HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement;
function change(input:HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement,value:string){
  const prototype=input instanceof dom.window.HTMLTextAreaElement?dom.window.HTMLTextAreaElement.prototype:input instanceof dom.window.HTMLSelectElement?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(input,value);input.dispatchEvent(new dom.window.Event(input instanceof dom.window.HTMLSelectElement?'change':'input',{bubbles:true}));
}
const checkbox=(text:string)=>label(text).querySelector<HTMLInputElement>('input')!;
async function suggestions(){await act(async()=>change(field('Optional notes to review'),'I want to walk more and read most evenings.'));await act(async()=>button('Suggest memories').click());}
async function selectFirst(){await act(async()=>checkbox('Save memory 1').click());await act(async()=>checkbox('I reviewed the selected memories and want to save them.').click());}

describe('explicit profile memory review',()=>{
  it('keeps suggestions temporary, unselected and editable until explicit reviewed selection is confirmed',async()=>{
    const saves:unknown[]=[];await mount({confirmNotes:async input=>{saves.push(input);return {saved:1};}});await suggestions();
    assert.equal(saves.length,0);assert.equal(checkbox('Save memory 1').checked,false);assert.equal(checkbox('Save memory 2').checked,false);assert.equal(button('Save selected memories').disabled,true);
    assert.match(document.body.textContent!,/Nothing has been saved/);
    await selectFirst();assert.equal(button('Save selected memories').disabled,false);
    await act(async()=>change(field('Memory text 1'),'Walk twice a week'));
    assert.equal(checkbox('I reviewed the selected memories and want to save them.').checked,false);assert.equal(button('Save selected memories').disabled,true);
    await act(async()=>change(field('Type for memory 1'),'habit'));await act(async()=>checkbox('I reviewed the selected memories and want to save them.').click());
    await act(async()=>button('Save selected memories').click());
    assert.equal(saves.length,1);const payload=saves[0] as any;
    assert.equal(payload.generation,7);assert.equal(payload.reviewed,true);assert.match(payload.requestId,/^[0-9a-f-]{36}$/i);
    assert.deepEqual(payload.memories,[{kind:'habit',content:'Walk twice a week'}]);assert.doesNotMatch(JSON.stringify(payload),/confidence|Reads every evening/);
    assert.equal(field('Optional notes to review').value,'');assert.match(document.body.textContent!,/1 reviewed memory saved/);assert.equal(button('Save selected memories'),undefined);
  });
  it('reuses one confirmation request after failure and changes it only when the selected statements change',async()=>{
    const saves:any[]=[];await mount({confirmNotes:async input=>{saves.push(input);return {error:'Temporary confirmation problem'};}});await suggestions();await selectFirst();
    await act(async()=>button('Save selected memories').click());await act(async()=>button('Save selected memories').click());
    assert.equal(saves.length,2);assert.equal(saves[0].requestId,saves[1].requestId);assert.equal(field('Memory text 1').value,'Walk more');
    await act(async()=>change(field('Memory text 1'),'Walk on Mondays'));await act(async()=>checkbox('I reviewed the selected memories and want to save them.').click());
    await act(async()=>button('Save selected memories').click());assert.notEqual(saves[2].requestId,saves[1].requestId);
    assert.deepEqual(saves[2].memories,[{kind:'goal',content:'Walk on Mondays'}]);
  });
  it('blocks duplicate in-flight confirmations and preserves the review on a transport error',async()=>{
    let calls=0,finish!:(value:{error:string})=>void;await mount({confirmNotes:async()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});await suggestions();await selectFirst();
    await act(async()=>button('Save selected memories').click());const form=document.querySelectorAll('form')[1];
    await act(async()=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(calls,1);
    await act(async()=>finish({error:'Try again'}));assert.equal(field('Memory text 1').value,'Walk more');assert.equal(checkbox('Save memory 1').checked,true);
  });
  it('discards temporary suggestions without writes when notes change, the user cancels or AI is turned off',async()=>{
    let saves=0,toggles=0;await mount({confirmNotes:async()=>{saves++;return {saved:1};},changeAiPreference:async()=>{toggles++;return {};}});await suggestions();
    await act(async()=>button('Discard suggestions').click());assert.equal(button('Save selected memories'),undefined);assert.equal(saves,0);assert.ok(field('Optional notes to review').value);
    await act(async()=>button('Suggest memories').click());await act(async()=>change(field('Optional notes to review'),'A changed habit'));
    assert.equal(button('Save selected memories'),undefined);assert.equal(saves,0);
    await act(async()=>button('Suggest memories').click());await act(async()=>button('Turn off AI assistance').click());
    assert.equal(toggles,1);assert.equal(document.querySelector('textarea'),null);assert.equal(saves,0);
  });
  it('clears an invalidated review while retaining the original notes for an explicit new request',async()=>{
    await mount({confirmNotes:async()=>({stale:true,error:'Your memory changed. Nothing was saved.'})});await suggestions();await selectFirst();await act(async()=>button('Save selected memories').click());
    assert.equal(button('Save selected memories'),undefined);assert.equal(field('Optional notes to review').value,'I want to walk more and read most evenings.');assert.match(document.body.textContent!,/Nothing was saved/);
  });
});

describe('memory extraction prompt boundary',()=>{
  it('requests explicitly stated suggestions rather than inferred durable traits or automatic storage',async()=>{
    const prompts:string[]=[];const provider=createLanguageTasks('fixture',async prompt=>{prompts.push(prompt);return '[]';});
    await provider.extractPreferences('I had pizza once.');await provider.extractMemories('A quoted story about someone else.');
    for(const prompt of prompts){assert.match(prompt,/explicitly stated/);assert.match(prompt,/temporary event/);assert.match(prompt,/third-party/);assert.match(prompt,/user review before storage/);assert.doesNotMatch(prompt,/strongly implied/);}
  });
});
