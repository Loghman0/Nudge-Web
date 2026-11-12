import { act, createElement } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach,describe,it } from 'node:test';
import assert from 'node:assert/strict';
import { DiscoverView } from '../src/app/(app)/discover/discover-view';
import type { AnswerResult,DiscoverActions,VerificationItem } from '../src/lib/discover/types';
const dom=new JSDOM('<!DOCTYPE html><html><body></body></html>',{url:'https://nudge.test/discover'});
Object.defineProperty(globalThis,'window',{value:dom.window,configurable:true});
Object.defineProperty(globalThis,'self',{value:dom.window,configurable:true});
Object.defineProperty(globalThis,'document',{value:dom.window.document,configurable:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const question=(i:number)=>({id:`q${i}`,prompt:`Question ${i}?`,option_a:`Choice A ${i}`,option_b:`Choice B ${i}`,maps_to_key_a:null,maps_to_key_b:null});
const state=(i:number):AnswerResult=>({next:question(i),answeredToday:i-1,totalAnswered:i-1,remaining:20-i,topic:'food'});
let root:Root;
afterEach(async()=>{if(root)await act(async()=>root.unmount());document.body.replaceChildren();});
const text=()=>document.body.textContent!;
const button=(label:string)=>({props:{onClick:()=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent!.includes(label))!.click()}});
async function mount(actions:Partial<DiscoverActions>,initial=state(1),verifications:VerificationItem[]=[]) {
  const defaults:DiscoverActions={changeTopic:async()=>({...state(1),topic:'music'}),answerQuestion:async()=>state(2),answerVerification:async()=>({}),confirmInsight:async()=>({})};
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>{root.render(createElement(DiscoverView,{initial,verifications,insight:{prefKey:'food.sushi',label:'Sushi',evidence:3},dailyTarget:1,actions:{...defaults,...actions}}));});
}
describe('Discover interactions',()=>{
  it('changes topic without answering, keeps the question after failures, and serializes repeat clicks',async()=>{
    let calls=0,answers=0,fail=true;const seen:unknown[]=[];
    await mount({answerQuestion:async()=>{answers++;return state(2);},
      changeTopic:async(current)=>{calls++;seen.push(current);if(fail)throw new Error('No other topic yet');
        return {...state(1),topic:'music',next:{...question(50),context:{topic:'music'}}};}});
    await act(async()=>{button('Change topic').props.onClick();button('Change topic').props.onClick();});
    assert.equal(calls,1);assert.equal(answers,0);assert.ok(text().includes('Question 1?'));assert.ok(text().includes('No other topic yet'));
    fail=false;await act(async()=>button('Change topic').props.onClick());
    assert.ok(text().includes('Question 50?'));assert.equal(answers,0);assert.ok(text().includes("Today's question is waiting"));
    assert.deepEqual(seen,['food','food']);assert.equal(window.location.search,'?topic=music');
  });
  it('keeps advancing after opting in, including skips, and pauses only on request',async()=>{
    let i=1;const sent:unknown[][]=[];
    await mount({answerQuestion:async(...args)=>{sent.push(args);return state(++i);}});
    await act(async()=>button('Choice A 1').props.onClick());assert.ok(text().includes('Keep exploring'));
    await act(async()=>button('Keep exploring').props.onClick());
    await act(async()=>button('Choice B 2').props.onClick());assert.ok(text().includes('Question 3?'));
    await act(async()=>button('Neither / skip').props.onClick());assert.ok(text().includes('Question 4?'));
    assert.deepEqual(sent,[['q1','a','food'],['q2','b','food'],['q3','skip','food']]);
    await act(async()=>button('Pause for today').props.onClick());assert.ok(text().includes('Keep exploring'));
  });
  it('keeps a failed answer visible and blocks duplicate clicks before rerender',async()=>{
    let calls=0;
    await mount({answerQuestion:async()=>{calls++;throw new Error('Apply missing migrations through 00004');}});
    const choose=button('Choice A 1');await act(async()=>{choose.props.onClick();choose.props.onClick();});
    assert.equal(calls,1);assert.ok(text().includes('Question 1?'));assert.ok(text().includes('Apply missing migrations through 00004'));
  });
  it('keeps failed quick checks, describes dislikes accurately and advances the next check after success',async()=>{
    const check=(id:string):VerificationItem=>({id,nodeId:id,prompt:'Check',key:'hobby.languages',label:id,polarity:'dislike'});
    let fail=true;
    await mount({answerVerification:async()=>fail?{error:'Save failed'}:{}},state(1),[check('Languages'),check('Puzzles')]);
    assert.ok(text().includes('prefer to avoid'));
    await act(async()=>button('Still true').props.onClick());assert.ok(text().includes('Languages'));assert.ok(text().includes('Save failed'));
    fail=false;await act(async()=>button('Still true').props.onClick());assert.ok(text().includes('Puzzles'));assert.ok(!text().includes('Languages'));
  });
  it('waits for successful insight confirmation and keeps errors retryable',async()=>{
    let fail=true;await mount({confirmInsight:async()=>fail?{error:'Pattern save failed'}:{}});
    await act(async()=>button("right").props.onClick());assert.ok(text().includes('Nudge noticed something'));assert.ok(text().includes('Pattern save failed'));
    fail=false;await act(async()=>button("right").props.onClick());assert.ok(!text().includes('Nudge noticed something'));
  });
  it('explains that rejecting a pattern is neutral and sends one explicit rejection despite repeat clicks',async()=>{
    const calls:unknown[][]=[];let finish!:(value:{})=>void;
    await mount({confirmInsight:async(...args)=>{calls.push(args);return new Promise(resolve=>{finish=resolve;});}});
    assert.ok(text().includes('Not really clears this inferred preference. It does not mean you prefer to avoid it.'));
    await act(async()=>{button('Not really').props.onClick();button('Not really').props.onClick();});
    assert.deepEqual(calls,[['food.sushi',false]]);assert.ok(text().includes('Nudge noticed something'));
    await act(async()=>finish({}));assert.ok(!text().includes('Nudge noticed something'));
  });
});
