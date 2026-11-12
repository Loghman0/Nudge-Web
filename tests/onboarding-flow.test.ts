import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { OnboardingFlow } from '../src/components/onboarding/onboarding-flow';
import type { OnboardingQuestion } from '../src/lib/types';

const questions:OnboardingQuestion[]=[
  {id:'12000000-0000-4000-8000-000000000001',kind:'this_or_that',prompt:'For an ordinary evening meal, which would you rather do?',option_a:'Cook at home',option_b:'Order in',maps_to_key_a:'food.cook_home',maps_to_key_b:'food.order_in',sort_order:1},
  {id:'12000000-0000-4000-8000-000000000002',kind:'this_or_that',prompt:'With a free hour at home, what would you choose?',option_a:'Read a book',option_b:'Watch a film',maps_to_key_a:'leisure.reading',maps_to_key_b:'leisure.films',sort_order:2},
];
const dom=new JSDOM('<!DOCTYPE html><html><body></body></html>',{url:'https://nudge.test/onboarding'});
for(const [name,value] of Object.entries({window:dom.window,self:dom.window,document:dom.window.document,navigator:dom.window.navigator,FormData:dom.window.FormData})) Object.defineProperty(globalThis,name,{value,configurable:true});
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|undefined;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;document.body.replaceChildren();});
async function mount(element:ReturnType<typeof createElement>){const {createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root!.render(element));}
const button=(name:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(value=>value.textContent?.trim()===name)!;
const radio=(label:string)=>[...document.querySelectorAll<HTMLLabelElement>('label')].find(value=>value.textContent?.trim()===label)!.querySelector<HTMLInputElement>('input')!;
function change(input:HTMLInputElement,value:string){Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));}
const props={initialName:'Sam',initialGeneration:4,questions,questionRationales:{[questions[0].id]:'A meal preference helps with everyday meal comparisons; it says nothing about your cooking ability.'}};

describe('foundation onboarding review and honest skips',()=>{
  it('collects only an optional name and keeps an available exit before saving',async()=>{
    await mount(createElement(OnboardingFlow,{...props,aiEnabled:true}));
    assert.equal(document.querySelectorAll('input').length,1);assert.ok(document.querySelector<HTMLInputElement>('input')!.labels?.length);
    assert.equal(document.querySelector('textarea'),null);assert.equal(document.body.textContent!.includes('Age'),false);
    assert.equal(document.querySelector('a')!.getAttribute('href'),'/ask');assert.match(document.body.textContent!,/Nothing is saved until you review and save/);
  });
  it('shows a rationale, native answer group, progress and no preselected answer',async()=>{
    await mount(createElement(OnboardingFlow,props));await act(async()=>button('Start the questions').click());
    assert.match(document.body.textContent!,/says nothing about your cooking ability/);assert.equal(document.querySelectorAll('input[type="radio"]').length,6);
    assert.equal(document.querySelectorAll('input:checked').length,0);assert.ok(document.querySelector('fieldset legend'));
    assert.equal(button('Next question').disabled,true);assert.equal(document.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow'),'2');
    assert.equal(document.activeElement?.tagName,'H1');
  });
  it('does not save until the summary, keeps Back drafts, and sends only explicit preferences',async()=>{
    let sent:unknown;let calls=0;
    await mount(createElement(OnboardingFlow,{...props,returnTo:'/ask?a=Soup&b=Pizza',completeAction:async input=>{calls++;sent=input;}}));
    await act(async()=>button('Start the questions').click());await act(async()=>radio('Cook at home').click());assert.equal(calls,0);
    await act(async()=>button('Next question').click());await act(async()=>radio('It depends').click());await act(async()=>button('Back').click());
    assert.equal(radio('Cook at home').checked,true);await act(async()=>button('Next question').click());assert.equal(radio('It depends').checked,true);
    await act(async()=>button('Review my answers').click());assert.equal(calls,0);assert.match(document.body.textContent!,/1 answer will be saved as an explicit everyday preference/);
    assert.match(document.body.textContent!,/It depends · no single preference saved/);await act(async()=>button('Save and compare').click());
    assert.equal(calls,1);assert.deepEqual(sent,{fullName:'Sam',country:'',language:'',age:'',occupation:'',about:'',expectedGeneration:4,next:'/ask?a=Soup&b=Pizza',answers:[{questionId:questions[0].id,answer:'a'},{questionId:questions[1].id,answer:'skip'}]});
  });
  it('keeps Both, Depends, Neither and Skip honest rather than inferring a side',async()=>{
    for(const label of ['Both could fit','It depends','Neither fits','Skip this question']){
      let sent:unknown;
      await mount(createElement(OnboardingFlow,{...props,questions:[questions[0]],completeAction:async input=>{sent=input;}}));
      await act(async()=>button('Start the questions').click());await act(async()=>radio(label).click());await act(async()=>button('Review my answers').click());
      assert.match(document.body.textContent!,/No preference for either side will be saved/);await act(async()=>button('Save and compare').click());
      assert.deepEqual((sent as {answers:unknown[]}).answers,[{questionId:questions[0].id,answer:'skip'}]);
      await act(async()=>root!.unmount());root=undefined;document.body.replaceChildren();
    }
  });
  it('skips all questions without fabricated answers or a save before review',async()=>{
    const sent:unknown[]=[];
    await mount(createElement(OnboardingFlow,{...props,completeAction:async input=>{sent.push(input);}}));await act(async()=>button('Skip the questions').click());
    assert.equal(sent.length,0);assert.match(document.body.textContent!,/Not answered · no single preference saved/);await act(async()=>button('Save and compare').click());
    assert.deepEqual((sent[0] as {answers:unknown[]}).answers,[]);
  });
  it('lets review edits replace a preference without silently answering other questions',async()=>{
    let sent:unknown;
    await mount(createElement(OnboardingFlow,{...props,completeAction:async input=>{sent=input;}}));await act(async()=>button('Start the questions').click());await act(async()=>radio('Cook at home').click());
    await act(async()=>button('Review now and leave the rest unanswered').click());
    await act(async()=>document.querySelector<HTMLButtonElement>('button[aria-label="Edit answer 1"]')!.click());assert.equal(radio('Cook at home').checked,true);
    await act(async()=>radio('Neither fits').click());await act(async()=>button('Review my answers').click());await act(async()=>button('Save and compare').click());
    assert.deepEqual((sent as {answers:unknown[]}).answers,[{questionId:questions[0].id,answer:'skip'}]);
  });
  it('serializes save clicks, disables navigation while pending and retains a retry draft',async()=>{
    let calls=0;let reject!:(error:Error)=>void;const attempts:unknown[]=[];
    await mount(createElement(OnboardingFlow,{...props,completeAction:async input=>{calls++;attempts.push(input);if(calls===1)await new Promise<void>((_,fail)=>{reject=fail;});}}));
    await act(async()=>change(document.querySelector<HTMLInputElement>('input')!,'Draft name'));await act(async()=>button('Skip the questions').click());
    await act(async()=>{button('Save and compare').click();button('Save and compare')?.click();});assert.equal(calls,1);
    assert.equal(document.querySelector('a'),null);for(const value of document.querySelectorAll('button'))assert.equal(value.disabled,true);
    await act(async()=>reject(new Error('offline')));assert.match(document.querySelector('[role="alert"]')!.textContent!,/answers are still here/);assert.equal(document.querySelector<HTMLInputElement>('input')!.value,'Draft name');
    await act(async()=>button('Try again').click());assert.equal(calls,2);assert.deepEqual(attempts[0],attempts[1]);
  });
  it('keeps the originally captured privacy generation after a server prop refresh',async()=>{
    let sent:unknown;const save=async(input:unknown)=>{sent=input;};
    await mount(createElement(OnboardingFlow,{...props,completeAction:save}));await act(async()=>button('Skip the questions').click());
    await act(async()=>root!.render(createElement(OnboardingFlow,{...props,initialGeneration:5,completeAction:save})));await act(async()=>button('Save and compare').click());
    assert.equal((sent as {expectedGeneration:number}).expectedGeneration,4);
  });
  it('distinguishes privacy invalidation from retryable transport failures without silently clearing the reviewed draft',async()=>{
    let calls=0;await mount(createElement(OnboardingFlow,{...props,completeAction:async()=>{calls++;throw new Error('Your memory changed. Reload the starter questions before saving.');}}));
    await act(async()=>button('Start the questions').click());await act(async()=>radio('Cook at home').click());await act(async()=>button('Review now and leave the rest unanswered').click());
    await act(async()=>button('Save and compare').click());assert.equal(calls,1);assert.equal(button('Reload before saving').disabled,true);
    assert.match(document.body.textContent!,/reviewed answers remain here until you reload/);assert.match(document.body.textContent!,/Cook at home/);
    const reload=[...document.querySelectorAll('a')].find(value=>value.textContent==='Reload starter questions')!;assert.equal(reload.getAttribute('href'),'/onboarding?next=%2Fask');
    await act(async()=>button('Reload before saving').click());assert.equal(calls,1);
  });
  it('allows an empty catalog to exit without completing setup or inventing questions',async()=>{
    let calls=0;await mount(createElement(OnboardingFlow,{...props,questions:[],completeAction:async()=>{calls++;}}));
    assert.match(document.body.textContent!,/starter questions are currently unavailable/);assert.match(document.body.textContent!,/profile has not been marked complete/);
    assert.equal(button('Save and compare'),undefined);assert.equal(document.querySelector('a')!.getAttribute('href'),'/ask');assert.equal(calls,0);
  });
});
