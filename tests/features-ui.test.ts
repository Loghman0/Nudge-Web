import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe,it } from 'node:test';
import assert from 'node:assert/strict';
import { DecideClient } from '../src/app/(app)/ask/decide-client';
import { MemoryInspector,EditableMemory } from '../src/app/(app)/profile/memory-inspector';
import { ReminderControls } from '../src/app/(app)/history/reminder-controls';

describe('feature UI rendering contracts',()=>{
  it('copies all eight options and restores the title and context without writing a new decision',()=>{
    const options=Array.from({length:8},(_,i)=>`Option ${i+1}`);
    const html=renderToStaticMarkup(createElement(DecideClient,{initialOptions:options,seed:{options,title:'Dinner again',context:{category:'food',mood:'Relaxed',expectedOutcome:'Enjoy the evening'}}}));
    for(const label of options)assert.ok(html.includes(`value="${label}"`),label);
    assert.ok(html.includes('value="Dinner again"'));assert.ok(html.includes('value="Enjoy the evening"'));
  });
  it('renders a resumed comparison with refresh and persisted choice controls',()=>{
    const html=renderToStaticMarkup(createElement(DecideClient,{initialOptions:[],initialResult:{decisionId:'d',category:'food',title:'Saved dinner',status:'open',revision:2,confidence:'low',coldStart:false,options:[{id:'a',label:'Sushi',score:0.7,breakdown:{},warning:false,reasons:['Saved score']},{id:'b',label:'Pizza',score:0.6,breakdown:{},warning:false,reasons:['Saved score']}]}}));
    assert.ok(html.includes('Saved dinner'));assert.ok(html.includes('Refresh with current memory'));assert.ok(html.includes('Choose this'));
  });
  it('makes correction, evidence and individual extracted-memory editing available',()=>{
    const html=renderToStaticMarkup(createElement(MemoryInspector,{nodes:[{id:'n',key:'food.sushi',value:'Sushi',category_slug:'food',polarity:'like',confidence:0.8,source:'inferred',evidence_count:3,last_reinforced_at:null}]}));
    for(const label of ['I like this','I avoid this','Neutral for me','View recent evidence','Forget this belief'])assert.ok(html.includes(label),label);
    const memory=renderToStaticMarkup(createElement(EditableMemory,{memory:{id:'m',kind:'goal',content:'Walk more',confidence:0.8}}));
    assert.ok(memory.includes('Walk more'));assert.ok(memory.includes('Delete memory'));
  });
  it('renders explicit reminder timing and timezone labeling',()=>{
    const html=renderToStaticMarkup(createElement(ReminderControls,{decisionId:'d'}));
    assert.ok(html.includes('Tomorrow'));assert.ok(html.includes('In a week'));assert.ok(html.includes('Turn off'));assert.ok(html.includes('your device timezone'));
  });
});
