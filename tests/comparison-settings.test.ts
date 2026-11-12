import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { applyComparisonAliases, decodeComparisonSettingsState, parseComparisonSetting, removeAppliedComparisonAliases, type ComparisonSettingsState, type SavedComparisonSetting } from '../src/lib/services/comparison-settings';
import { SavedSettings } from '../src/app/(app)/ask/saved-settings';
import { DecideClient } from '../src/app/(app)/ask/decide-client';
import type { CompareResult } from '../src/app/(app)/ask/actions';

const setting: SavedComparisonSetting = { id:'11111111-1111-4111-8111-111111111111',name:'My game',domain:'my game v2',category:'hobbies',goal:'Collect supplies',
  aliases:[{term:'Mine',meaning:'The activity I defined for this game.'},{term:'Woodcutting',meaning:'My tree activity.'}],memory_generation:2,created_at:'2026-10-24T00:00:00Z',updated_at:'2026-10-24T00:00:00Z' };
const state: ComparisonSettingsState = { available:true,generation:2,settings:[setting] };
const draft = () => ({ id:null,name:' My game ',domain:' My  Game V2 ',category:'hobbies',goal:' Collect supplies ',aliases:setting.aliases,generation:2 });

describe('saved comparison vocabulary boundaries',()=>{
  it('allowlists explicit vocabulary and refuses journal or measurement fields',()=>{
    const parsed=parseComparisonSetting(draft());assert.equal(parsed.value?.domain,'my game v2');assert.equal(parsed.value?.goal,'Collect supplies');
    for(const extra of [{optionDetails:{Mine:'private journal note'}},{criteria:[]},{notes:'private'},{options:['Mine','Woodcutting']}]) assert.ok(parseComparisonSetting({...draft(),...extra}).error);
    assert.ok(parseComparisonSetting({...draft(),aliases:[{term:'Mine',meaning:'x',sourceUrl:'https://example.test'}]}).error);
  });
  it('rejects invalid generations, excess aliases, oversized definitions and shadowed terms',()=>{
    for(const generation of [-1,2.5,'2',undefined]) assert.ok(parseComparisonSetting({...draft(),generation}).error);
    assert.ok(parseComparisonSetting({...draft(),aliases:Array.from({length:13},(_,index)=>({term:`Term${index}`,meaning:'Mine'}))}).error);
    assert.ok(parseComparisonSetting({...draft(),aliases:[{term:'Mine',meaning:'x'.repeat(501)}]}).error);
    assert.ok(parseComparisonSetting({...draft(),aliases:[{term:'Mine',meaning:'One'},{term:' MINE ',meaning:'Two'}]}).error);
    assert.ok(parseComparisonSetting({...draft(),domain:''}).error);
  });
  it('fills only complete case-folded labels and keeps manual definitions',()=>{
    const mapped=applyComparisonAliases(setting,[' MINE ','Mining','Woodcutting','Mine in real life'],{Woodcutting:'My existing detail'});
    assert.deepEqual(mapped.applied,{MINE:'The activity I defined for this game.'});
    assert.equal(mapped.details.Mining,undefined);assert.equal(mapped.details['Mine in real life'],undefined);
    assert.equal(mapped.details.Woodcutting,'My existing detail');
    assert.deepEqual(removeAppliedComparisonAliases({...mapped.details,MINE:'Edited by me'},mapped.applied),{MINE:'Edited by me',Woodcutting:'My existing detail'});
    assert.deepEqual(removeAppliedComparisonAliases(mapped.details,mapped.applied),{Woodcutting:'My existing detail'});
  });
  it('supports literal labels that share JavaScript property names without guessing or changing object prototypes',()=>{
    const mapped=applyComparisonAliases({...setting,aliases:[{term:'constructor',meaning:'A builder in my project'},{term:'__proto__',meaning:'A literal label'}]},['constructor','__proto__'],{});
    assert.equal(mapped.details.constructor,'A builder in my project');assert.equal(mapped.details.__proto__,'A literal label');
    assert.equal(Object.getPrototypeOf(mapped.details),Object.prototype);
    assert.deepEqual(Object.keys(removeAppliedComparisonAliases(mapped.details,mapped.applied)),[]);
  });
  it('requires a complete generation-consistent server state before displaying private settings',()=>{
    assert.equal(decodeComparisonSettingsState({generation:2,settings:[setting]})?.settings.length,1);
    assert.deepEqual(decodeComparisonSettingsState({generation:3,settings:[]}),{available:true,generation:3,settings:[]});
    assert.equal(decodeComparisonSettingsState({generation:3,settings:[setting]}),null);
    assert.equal(decodeComparisonSettingsState({generation:2,settings:Array(21).fill(setting)}),null);
    assert.equal(decodeComparisonSettingsState({generation:2,settings:[{...setting,aliases:[{term:'Mine',meaning:null}]}]}),null);
  });
});

const dom=new JSDOM('<!DOCTYPE html><html><body></body></html>',{url:'https://nudge.test/ask'});
for(const [name,value] of Object.entries({window:dom.window,self:dom.window,document:dom.window.document,navigator:dom.window.navigator,FormData:dom.window.FormData})) Object.defineProperty(globalThis,name,{value,configurable:true});
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|undefined;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;document.body.replaceChildren();});
async function mount(element:ReturnType<typeof createElement>){const {createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root!.render(element));}
const button=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(value=>value.textContent?.trim()===text)!;
function change(input:HTMLInputElement,value:string){Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));}
const result:CompareResult={decisionId:'11111111-1111-4111-8111-111111111112',title:'Options',category:'hobbies',confidence:'low',evidenceState:'insufficient',coldStart:true,status:'open',options:[{id:'a',label:'Mine',score:.5,breakdown:{},warning:false,reasons:['No relevant evidence']},{id:'b',label:'Woodcutting',score:.5,breakdown:{},warning:false,reasons:['No relevant evidence']}]};
type SettingsActions=NonNullable<Parameters<typeof SavedSettings>[0]['actions']>;
const settingsActions=(overrides:Partial<SettingsActions>={}):SettingsActions=>({loadComparisonSettings:async()=>state,saveComparisonSetting:async()=>({state}),deleteComparisonSetting:async()=>({state:{...state,settings:[]}}),...overrides});
type Actions=NonNullable<Parameters<typeof DecideClient>[0]['actions']>;
const actions=(overrides:Partial<Actions>={}):Actions=>({compareOptions:async()=>result,askNaturally:async()=>result,refreshComparison:async()=>result,chooseOption:async()=>({}),abandonDecision:async()=>{},explainDecision:async()=>null,suggestOptions:async()=>[],...overrides});

describe('saved settings review and privacy interactions',()=>{
  it('checks the current server record before applying and requires renewed confirmation without replacing options or details',async()=>{
    let reads=0,calls=0;let sent:unknown[]=[];
    await mount(createElement(DecideClient,{initialOptions:['Mine','Woodcutting'],seed:{options:[],title:'My draft',context:{optionDetails:{Woodcutting:'Existing manual detail'}}},initialSettings:state,
      settingsActions:settingsActions({loadComparisonSettings:async()=>{reads++;return state;}}),actions:actions({compareOptions:async(...args)=>{calls++;sent=args;return result;}})}));
    await act(async()=>button('Apply').click());assert.equal(reads,1);
    assert.equal(document.querySelector<HTMLInputElement>('input[placeholder="First option"]')!.value,'Mine');
    const details=[...document.querySelectorAll<HTMLTextAreaElement>('textarea')];assert.equal(details[0].value,setting.aliases[0].meaning);assert.equal(details[1].value,'Existing manual detail');
    await act(async()=>button('Compare options').click());assert.equal(calls,0);
    await act(async()=>document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async()=>change(document.querySelector<HTMLInputElement>('input[placeholder="First option"]')!,'MINE'));
    await act(async()=>button('Compare options').click());assert.equal(calls,0);assert.ok(document.querySelector('input[type="checkbox"]'));
    await act(async()=>document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async()=>button('Compare options').click());assert.equal(calls,1);
    assert.deepEqual(sent[0],['MINE','Woodcutting']);assert.equal((sent[2] as {domain:string}).domain,setting.domain);
    assert.equal((sent[2] as {optionDetails:Record<string,string>}).optionDetails.Woodcutting,'Existing manual detail');
  });
  it('removes injected meanings when the user changes scope, without carrying them to another game',async()=>{
    await mount(createElement(DecideClient,{initialOptions:['Mine','Woodcutting'],initialSettings:state,settingsActions:settingsActions(),actions:actions()}));
    await act(async()=>button('Apply').click());
    await act(async()=>change(document.querySelector<HTMLInputElement>('input[placeholder^="A game and version, a project"]')!,'A different game'));
    assert.equal(document.querySelector<HTMLTextAreaElement>('textarea')!.value,'');
    assert.equal(document.querySelector('input[type="checkbox"]'),null);
  });
  it('prevents edits and confirmation while an applied setting is still being checked',async()=>{
    let finish!:(value:ComparisonSettingsState)=>void;
    const waiting=new Promise<ComparisonSettingsState>(resolve=>{finish=resolve;});
    await mount(createElement(DecideClient,{initialOptions:['Mine','Woodcutting'],initialSettings:state,
      settingsActions:settingsActions({loadComparisonSettings:async()=>waiting}),actions:actions()}));
    await act(async()=>button('Apply').click());
    const input=document.querySelector<HTMLInputElement>('input[placeholder="First option"]')!;
    assert.equal(input.matches(':disabled'),true);
    assert.equal(button('Compare 2 options').matches(':disabled'),true);
    assert.match(document.querySelector('[role="status"]')!.textContent!,/Updating saved settings/);
    await act(async()=>finish(state));
    assert.equal(document.querySelector('input[type="checkbox"]')!.matches(':disabled'),false);
    assert.equal((document.querySelector('input[type="checkbox"]') as HTMLInputElement).checked,false);
    assert.equal(document.activeElement,document.querySelector('h1'));
  });
  it('rechecks an applied preset before Compare and clears erased definitions while retaining option drafts',async()=>{
    let reads=0,calls=0;
    await mount(createElement(DecideClient,{initialOptions:['Mine','Woodcutting'],initialSettings:state,
      settingsActions:settingsActions({loadComparisonSettings:async()=>++reads===1?state:{...state,generation:3,settings:[]}}),actions:actions({compareOptions:async()=>{calls++;return result;}})}));
    await act(async()=>button('Apply').click());
    await act(async()=>document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async()=>button('Compare options').click());
    assert.equal(reads,2);assert.equal(calls,0);assert.match(document.body.textContent!,/saved setting changed or was cleared/);
    assert.equal(document.querySelector<HTMLInputElement>('input[placeholder="First option"]')!.value,'Mine');
    assert.equal(document.querySelector('textarea'),null);
  });
  it('refuses cached presets after deletion or privacy reset and preserves option drafts',async()=>{
    let applied=0,cleared=0;
    await mount(createElement(SavedSettings,{initialState:state,domain:'',category:null,goal:'',onApply:()=>applied++,onInvalidated:()=>cleared++,
      actions:settingsActions({loadComparisonSettings:async()=>({...state,generation:3,settings:[]})})}));
    await act(async()=>button('Apply').click());assert.equal(applied,0);assert.equal(cleared,1);assert.equal(document.querySelector('li'),null);
    assert.match(document.body.textContent!,/memory changed/i);
  });
  it('captures the loaded generation and clears a stale editor rather than resubmitting old private definitions',async()=>{
    let payload:unknown;
    await mount(createElement(SavedSettings,{initialState:state,domain:'Example project',category:'work',goal:'',onApply:()=>{},onInvalidated:()=>{},
      actions:settingsActions({saveComparisonSetting:async value=>{payload=value;return {stale:true,error:'Memory changed'};}})}));
    await act(async()=>button('Create a saved setting').click());
    await act(async()=>change(document.querySelector<HTMLInputElement>('input[placeholder="A name you recognize"]')!,'New preset'));
    await act(async()=>button('Save setting').click());
    assert.equal((payload as {generation:number}).generation,2);assert.deepEqual((payload as {aliases:unknown[]}).aliases,[]);
    assert.equal(document.querySelector('fieldset'),null);assert.equal(document.querySelector('li'),null);
  });
  it('offers an unavailable fallback without blocking the ordinary comparison path',async()=>{
    let calls=0;
    await mount(createElement(DecideClient,{initialOptions:['Mine','Woodcutting'],actions:actions({compareOptions:async()=>{calls++;return result;}})}));
    assert.match(document.body.textContent!,/Saved settings are currently unavailable/);
    await act(async()=>button('Compare 2 options').click());assert.equal(calls,1);
  });
  it('suppresses ranking claims and measured winners when saved evidence is unavailable',async()=>{
    await mount(createElement(DecideClient,{initialOptions:[],initialResult:{...result,evidenceSnapshotState:'unavailable',evidenceState:'personal_fit',confidence:'high',options:result.options.map(option=>({...option,score:.99}))},actions:actions()}));
    assert.match(document.body.textContent!,/saved evidence for this comparison is unavailable/i);assert.equal(document.body.textContent!.includes('Higher relative fit'),false);
    assert.equal(document.body.textContent!.includes('larger relative-fit score gap'),false);assert.match(document.body.textContent!,/insufficient evidence/);
  });
});
