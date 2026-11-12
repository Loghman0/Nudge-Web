import { afterEach,describe,it } from 'node:test';
import assert from 'node:assert/strict';
import { createNvidiaProvider,NVIDIA_MODELS,readNvidiaRouting } from '../src/lib/services/ai/nvidia';
import { createOpenAiCompatibleProvider } from '../src/lib/services/ai/openai-compatible';
const original=globalThis.fetch;
afterEach(()=>{globalThis.fetch=original;});
const env={NVIDIA_LIGHTNING_API_KEY:'test-lightning',NVIDIA_SUPER_API_KEY:'test-super',NVIDIA_ULTRA_API_KEY:'test-ultra',NVIDIA_GPT_OSS_API_KEY:'test-oss',NVIDIA_GEMMA_API_KEY:'test-gemma'};
const content=(value:unknown)=>Response.json({choices:[{message:{content:typeof value==='string'?value:JSON.stringify(value)}}]});
describe('NVIDIA model routing and validation',()=>{
  it('routes ambiguity interpretation through parsing with a bounded schema rather than inventing a recommendation',async()=>{
    let model='';
    globalThis.fetch=async(_url,options)=>{
      const body=JSON.parse(options!.body as string);model=body.model;
      assert.match(body.messages[0].content,/without answering or ranking/);
      return content({options:['Stage','Rebase'],category:'work',domain:'',goal:'',question:'What project and goal?',unfamiliarTerms:['Stage','Rebase']});
    };
    const draft=await createNvidiaProvider(env)!.understandDecision('Stage or Rebase?');
    assert.equal(model,NVIDIA_MODELS.lightning);assert.equal(draft.domain,'');
    assert.deepEqual(draft.options,['Stage','Rebase']);
  });
  it('routes parsing to Lightning and extraction, explanations and summaries to Gemma by default',async()=>{
    const calls:{model:string;key:string|null}[]=[];
    globalThis.fetch=async(url,options)=>{
      assert.equal(url,'https://integrate.api.nvidia.com/v1/chat/completions');
      const body=JSON.parse(options!.body as string);calls.push({model:body.model,key:new Headers(options!.headers).get('authorization')});
      assert.equal(body.stream,false);assert.ok(options?.signal);
      if(body.model===NVIDIA_MODELS.lightning){assert.equal(body.chat_template_kwargs.enable_thinking,false);return content({category:'finance',intent:'Pick a budget',constraints:{budget:'small'}});}
      if(body.messages[0].content.startsWith('Suggest only'))return content([]);
      return content('Grounded test explanation.');
    };
    const ai=createNvidiaProvider(env)!;
    assert.equal((await ai.parseQuestion('Which budget?')).category,'finance');
    await ai.extractPreferences('Preferences');await ai.extractMemories('Memories');
    await ai.explainRecommendation({question:'Dinner?',chosenLabel:'Soup',scoreBreakdown:{preference:0.8},topPreferences:['Likes soup']});
    await ai.summarizeMonth({windowDays:30,totalDecisions:1,topCategories:[],bestRated:[],regretted:[],averageRating:null});
    assert.deepEqual(calls.map(c=>c.model),[NVIDIA_MODELS.lightning,NVIDIA_MODELS.gemma,NVIDIA_MODELS.gemma,NVIDIA_MODELS.gemma,NVIDIA_MODELS.gemma]);
    assert.deepEqual(calls.map(c=>c.key),['Bearer test-lightning','Bearer test-gemma','Bearer test-gemma','Bearer test-gemma','Bearer test-gemma']);
  });
  it('falls back on provider errors, empty responses and malformed structured output',async()=>{
    for(const failure of ['http','empty','malformed']){
      let calls=0;
      globalThis.fetch=async()=>{
        if(++calls===1)return failure==='http'?new Response('',{status:429}):content(failure==='empty'?'':'invalid json');
        return content({category:'health',intent:'Move more',constraints:{time:'morning'}});
      };
      assert.equal((await createNvidiaProvider(env)!.parseQuestion('Movement?')).category,'health');assert.equal(calls,2);
    }
  });
  it('bounds attempts and returns a safe error without keys or response bodies',async()=>{
    let calls=0;globalThis.fetch=async()=>{calls++;return new Response('private vendor details',{status:500});};
    await assert.rejects(createNvidiaProvider(env)!.parseQuestion('Question'),/NVIDIA AI is temporarily unavailable/);assert.equal(calls,2);
  });
  it('supports shared keys and explicit model slots, and stays optional without keys',async()=>{
    assert.equal(createNvidiaProvider({}),null);
    let used='';globalThis.fetch=async(_url,options)=>{used=JSON.parse(options!.body as string).model;return content({category:'food',intent:'Dinner',constraints:{}});};
    await createNvidiaProvider({NVIDIA_API_KEY:'shared-test',NVIDIA_ENABLED_MODELS:'super,gemma',NVIDIA_PARSING_MODEL:'super'})!.parseQuestion('Dinner');assert.equal(used,NVIDIA_MODELS.super);
  });
  it('fails closed on empty/invalid allowlists and explicitly disabled or unknown role selections',()=>{
    for(const settings of [
      {NVIDIA_ENABLED_MODELS:''},{NVIDIA_ENABLED_MODELS:'  '},{NVIDIA_ENABLED_MODELS:'lightning,unknown'},
      {NVIDIA_ENABLED_MODELS:'lightning,'},{NVIDIA_ENABLED_MODELS:',gemma'},
      {NVIDIA_PARSING_MODEL:'super'},{NVIDIA_EXTRACTION_MODEL:'unknown'},
      {NVIDIA_ENABLED_MODELS:'lightning',NVIDIA_EXTRACTION_MODEL:'gemma'},
    ])assert.equal(createNvidiaProvider({...env,...settings}),null);
    assert.deepEqual(readNvidiaRouting({})?.enabled,['lightning','gemma']);
    assert.deepEqual(readNvidiaRouting({NVIDIA_ENABLED_MODELS:`${NVIDIA_MODELS.lightning},${NVIDIA_MODELS.gemma}`})?.enabled,['lightning','gemma']);
  });
  it('never falls back to a disabled model or to implicitly enabled legacy keys',async()=>{
    const calls:string[]=[];
    globalThis.fetch=async(_url,options)=>{calls.push(JSON.parse(options!.body as string).model);return new Response('',{status:500});};
    await assert.rejects(createNvidiaProvider({...env,NVIDIA_ENABLED_MODELS:'lightning'})!.parseQuestion('Dinner'),/temporarily unavailable/);
    assert.deepEqual(calls,[NVIDIA_MODELS.lightning]);
    assert.equal(createNvidiaProvider({NVIDIA_SUPER_API_KEY:'legacy-super',NVIDIA_ULTRA_API_KEY:'legacy-ultra'}),null);
    assert.equal(createNvidiaProvider({NVIDIA_API_KEY:'shared',NVIDIA_ENABLED_MODELS:'super,ultra'}),null);
  });
  it('keeps optional GPT-OSS opt-in and never creates a third fallback attempt',async()=>{
    assert.equal(createNvidiaProvider({NVIDIA_GPT_OSS_API_KEY:'optional'}),null);
    const calls:string[]=[];
    globalThis.fetch=async(_url,options)=>{calls.push(JSON.parse(options!.body as string).model);return content({category:'food',intent:'Dinner',constraints:{}});};
    await createNvidiaProvider({NVIDIA_GPT_OSS_API_KEY:'optional',NVIDIA_ENABLED_MODELS:'gpt_oss'})!.parseQuestion('Dinner');
    assert.deepEqual(calls,[NVIDIA_MODELS.gpt_oss]);calls.length=0;
    globalThis.fetch=async(_url,options)=>{calls.push(JSON.parse(options!.body as string).model);return new Response('',{status:500});};
    await assert.rejects(createNvidiaProvider({...env,NVIDIA_ENABLED_MODELS:'lightning,gemma,gpt_oss,super,ultra'})!.parseQuestion('Dinner'));
    assert.deepEqual(calls,[NVIDIA_MODELS.lightning,NVIDIA_MODELS.gemma]);
  });
  it('never forwards another vendor generic key, but accepts recognized NVIDIA generic keys',async()=>{
    assert.equal(createNvidiaProvider({AI_API_KEY:'gsk-synthetic-other-vendor'}),null);
    assert.equal(createNvidiaProvider({AI_API_KEY:'sk-synthetic-other-vendor'}),null);
    const keys:string[]=[];
    globalThis.fetch=async(_url,options)=>{keys.push(new Headers(options!.headers).get('authorization')!);return content({category:'food',intent:'Dinner',constraints:{}});};
    await createNvidiaProvider({AI_API_KEY:'  nvapi-synthetic-generic  '})!.parseQuestion('Dinner');
    await createNvidiaProvider({AI_API_KEY:'gsk-other',NVIDIA_API_KEY:'shared-nvidia'})!.parseQuestion('Dinner');
    await createNvidiaProvider({AI_API_KEY:'nvapi-generic',NVIDIA_API_KEY:'shared-nvidia',NVIDIA_LIGHTNING_API_KEY:'per-model-nvidia'})!.parseQuestion('Dinner');
    assert.deepEqual(keys,['Bearer nvapi-synthetic-generic','Bearer shared-nvidia','Bearer per-model-nvidia']);
  });
  it('uses legacy routes only as an explicit selected primary and keeps fallback on current enabled models',async()=>{
    const calls:string[]=[];
    globalThis.fetch=async(_url,options)=>{
      const model=JSON.parse(options!.body as string).model;calls.push(model);
      return calls.length===1?new Response('',{status:503}):content({category:'food',intent:'Dinner',constraints:{}});
    };
    await createNvidiaProvider({...env,NVIDIA_ENABLED_MODELS:'super,ultra,lightning,gemma',NVIDIA_PARSING_MODEL:NVIDIA_MODELS.super})!.parseQuestion('Dinner');
    assert.deepEqual(calls,[NVIDIA_MODELS.super,NVIDIA_MODELS.lightning]);
  });
  it('validates and caps extracted data before it can reach memory writes',async()=>{
    const ai=createOpenAiCompatibleProvider({name:'test',baseUrl:'https://example.test/v1',apiKey:'test',model:'test'});
    globalThis.fetch=async()=>content([{key:'food.soup',polarity:'like',confidence:1},{key:'invalid key',polarity:'like',confidence:0.8},{key:'food.bad',polarity:'sideways',confidence:0.8},{key:'food.nan',polarity:'like',confidence:'0.8'}]);
    assert.deepEqual(await ai.extractPreferences('text'),[{key:'food.soup',polarity:'like',confidence:0.95}]);
    globalThis.fetch=async()=>content(Array.from({length:10},()=>({kind:'goal',content:'x'.repeat(400),confidence:1})));
    const memories=await ai.extractMemories('text');assert.equal(memories.length,6);assert.equal(memories[0].content.length,300);assert.equal(memories[0].confidence,0.95);
  });
});
