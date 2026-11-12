import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { anthropicProvider } from '../src/lib/services/ai/anthropic';
import { createOpenAiCompatibleProvider } from '../src/lib/services/ai/openai-compatible';
import { createNvidiaProvider } from '../src/lib/services/ai/nvidia';
import { withAiDeadline } from '../src/lib/services/ai/deadline';

const originalFetch = globalThis.fetch;
const originalKey = process.env.ANTHROPIC_API_KEY;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
});
const compatible = () => createOpenAiCompatibleProvider({ name:'test', baseUrl:'https://test.invalid', apiKey:'test', model:'test' });
function answer(value: unknown) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  globalThis.fetch = async () => Response.json({ content:[{type:'text',text:raw}], choices:[{message:{content:raw}}] });
}

describe('shared AI trust boundary', () => {
  for (const name of ['anthropic', 'compatible']) {
    it(`${name} keeps absent historical preference evidence explicit in the explanation request`, async () => {
      process.env.ANTHROPIC_API_KEY = 'test';
      let sent:Record<string,unknown> | undefined;
      globalThis.fetch = async (_url,options) => {
        sent=JSON.parse(String(options?.body));
        return Response.json({content:[{type:'text',text:'These are relative scores with limited evidence.'}],choices:[{message:{content:'These are relative scores with limited evidence.'}}]});
      };
      const input={question:'Dinner',chosenLabel:'Soup',topPreferences:[],scoreBreakdown:{preferenceMatch:.5,historySuccess:.5}};
      const provider=name==='anthropic'?anthropicProvider:compatible();
      assert.match(await provider.explainRecommendation(input),/limited evidence/);
      const messages=sent!.messages as {role:string;content:string}[];
      const system=name==='anthropic'?sent!.system as string:messages[0].content;
      assert.match(system,/topPreferences is empty/);
      assert.match(system,/never invent likes, dislikes or personal history/);
      assert.deepEqual(JSON.parse(messages.find(message=>message.role==='user')!.content),input);
    });
    it(`${name} validates structured objects, filters malformed members and bounds values`, async () => {
      process.env.ANTHROPIC_API_KEY = 'test';
      const provider = name === 'anthropic' ? anthropicProvider : compatible();
      answer({options:['Mining','Woodcutting'],category:'hobbies',domain:'',goal:'',question:'What setting is this in?',unfamiliarTerms:['Mining']});
      assert.equal((await provider.understandDecision('Mining or Woodcutting?')).domain,'');
      answer({options:['Mining'],category:'hobbies',domain:{},goal:'',question:'Where?',unfamiliarTerms:[]});
      await assert.rejects(provider.understandDecision('Mining or Woodcutting?'));
      answer([null, true, 1, {key:'bad key',polarity:'like',confidence:0.8}, {key:'food.x',polarity:'other',confidence:1}, {key:'food.x',polarity:'like',confidence:99}, {key:'food.soup',polarity:'like',confidence:1}]);
      assert.deepEqual(await provider.extractPreferences('synthetic'), [{key:'food.soup',polarity:'like',confidence:0.95}]);
      answer([null, {kind:'bad',content:'x',confidence:1}, ...Array.from({length:10},()=>({kind:'goal',content:' x'.repeat(400),confidence:1}))]);
      const memories = await provider.extractMemories('synthetic');
      assert.equal(memories.length, 6); assert.equal(memories[0].content.length, 300); assert.equal(memories[0].confidence,0.95);
      for (const value of ['broken json', '{}', 'null']) {
        answer(value);
        await assert.rejects(provider.extractPreferences('synthetic'));
        await assert.rejects(provider.extractMemories('synthetic'));
      }
      answer({category:'finance',intent:'Budget',constraints:{limit:'100',ignored:7}});
      assert.deepEqual(await provider.parseQuestion('synthetic'), {category:'finance',intent:'Budget',constraints:{limit:'100'}});
      answer({category:'invented',intent:'x',constraints:{}});
      await assert.rejects(provider.parseQuestion('synthetic'));
      answer('   ');
      await assert.rejects(provider.explainRecommendation({question:'x',chosenLabel:'x',topPreferences:[],scoreBreakdown:{}}));
      answer('<think>private reasoning</think>');
      await assert.rejects(provider.summarizeMonth({windowDays:30,totalDecisions:3,topCategories:[],bestRated:[],regretted:[],averageRating:null}));
    });
  }
});

describe('abortable AI deadlines', () => {
  it('passes cancellation to the in-flight request and never starts a fallback after cancellation', async () => {
    let calls = 0; let aborted = false;
    globalThis.fetch = async (_url, options) => {
      calls++;
      return new Promise<Response>((_resolve,reject) => options!.signal!.addEventListener('abort', () => {aborted=true; reject(options!.signal!.reason);}, {once:true}));
    };
    const provider = createNvidiaProvider({NVIDIA_API_KEY:'test'})!;
    await assert.rejects(withAiDeadline(signal => provider.extractMemories('synthetic', {signal}), 20), {name:'TimeoutError'});
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(aborted,true); assert.equal(calls,1);
  });
  it('does not invoke providers with an already canceled signal', async () => {
    let calls=0; globalThis.fetch=async()=>{calls++;throw new Error('should not fetch');};
    const controller = new AbortController(); controller.abort();
    await assert.rejects(compatible().extractPreferences('synthetic', {signal:controller.signal}), {name:'AbortError'});
    assert.equal(calls,0);
  });
  it('cleans timers and parent listeners after success and failure', async () => {
    const parent = new AbortController();
    let listeners=0;
    const add = parent.signal.addEventListener.bind(parent.signal);
    const remove = parent.signal.removeEventListener.bind(parent.signal);
    parent.signal.addEventListener = (...args: Parameters<typeof add>) => {listeners++;return add(...args);};
    parent.signal.removeEventListener = (...args: Parameters<typeof remove>) => {listeners--;return remove(...args);};
    assert.equal(await withAiDeadline(async()=>42, 60000, parent.signal),42);
    await assert.rejects(withAiDeadline(async()=>{throw new Error('fixture');},60000,parent.signal),/fixture/);
    assert.equal(listeners,0);
  });
  it('keeps the same caller deadline when a fast failure starts the fallback', async () => {
    let calls=0;
    globalThis.fetch=async(_url,options)=>{
      calls++;
      if(calls===1)return new Response('',{status:429});
      return new Promise<Response>((_resolve,reject)=> options!.signal!.addEventListener('abort',()=>reject(options!.signal!.reason),{once:true}));
    };
    await assert.rejects(withAiDeadline(signal=>createNvidiaProvider({NVIDIA_API_KEY:'test'})!.extractPreferences('synthetic',{signal}),20),{name:'TimeoutError'});
    assert.equal(calls,2);
  });
});
