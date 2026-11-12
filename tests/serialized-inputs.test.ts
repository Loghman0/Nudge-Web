import {describe,it} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";
import vm from "node:vm";
import {parsePushSubscription} from "../src/lib/services/push-subscription-input";
import {validPushEndpoint} from "../src/lib/services/push-endpoint";
import {parseOnboardingInput} from "../src/lib/services/onboarding-input";

const questionId="00000000-0000-4000-8000-000000000001";
const onboarding=()=>({fullName:" Sam ",country:"",language:"en",age:"",occupation:"",about:"",expectedGeneration:0,next:"/ask",answers:[{questionId,answer:"a"}]});
const push=()=>({endpoint:"https://fcm.googleapis.com/fcm/send/synthetic",p256dh:"a".repeat(87),auth:"b".repeat(22)});

describe("serialized onboarding and push inputs",()=>{
  it("rejects malformed onboarding shapes, unsupported age and duplicate question identities",()=>{
    for (const input of [null,[],{}, {...onboarding(),fullName:{}}, {...onboarding(),about:"x".repeat(2001)},
      {...onboarding(),answers:[null]}, {...onboarding(),answers:[{questionId,answer:"admin"}]},
      {...onboarding(),answers:[{questionId,answer:"a"},{questionId,answer:"b"}]}])
      assert.ok(parseOnboardingInput(input).error);
    for(const age of ["15","121","1e2","NaN","16.5"])assert.ok(parseOnboardingInput({...onboarding(),age}).error,age);
    for(const age of ["","16","120"])assert.ok(parseOnboardingInput({...onboarding(),age}).value,age);
    for(const expectedGeneration of [undefined,null,-1,1.5,"0"])assert.ok(parseOnboardingInput({...onboarding(),expectedGeneration}).error);
  });
  it("constructs only allowed profile/answer fields and preserves optional empty answers",()=>{
    assert.deepEqual(parseOnboardingInput({...onboarding(),admin:true,answers:[{questionId,answer:"a",prefKey:"forged",user_id:"other"}]}),
      {value:{...onboarding(),fullName:"Sam"}});
    assert.deepEqual(parseOnboardingInput({...onboarding(),answers:[]}).value?.answers,[]);
  });
  it("rejects malformed subscription fields and strips caller-supplied database columns",()=>{
    for (const input of [null,[],{}, {...push(),endpoint:null}, {...push(),p256dh:{}}, {...push(),auth:22},
      {...push(),endpoint:"http://127.0.0.1/"}, {...push(),endpoint:"https://fcm.googleapis.com.attacker.invalid/"}])
      assert.equal(parsePushSubscription(input),null);
    assert.deepEqual(parsePushSubscription({...push(),user_id:"forged",id:"forged",created_at:"forged"}),push());
  });
  it("the real push action binds verified ownership and rejects bad shapes before database work",async()=>{
    const source=readFileSync(new URL("../src/app/(app)/notifications/push-actions.ts",import.meta.url),"utf8");
    const body=stripTypeScriptTypes(source).replace(/^import .+;$/gm,"").replaceAll("export async function","async function");
    let clients=0;let row:unknown;
    const context=vm.createContext({parsePushSubscription,validPushEndpoint,createClient:async()=>{
      clients++;return {auth:{getUser:async()=>({data:{user:{id:"verified-owner"}}})},from:()=>({upsert:async(value:unknown)=>{row=value;return {error:null};}})};
    }});
    vm.runInContext(body+"\nglobalThis.save=savePushSubscription;globalThis.remove=removePushSubscription;",context);
    await context.save(null);await context.remove(null);assert.equal(clients,0);
    const result=await context.save({...push(),user_id:"forged",id:"forged"});
    assert.equal(result.ok,true);
    assert.deepEqual(JSON.parse(JSON.stringify(row)),{user_id:"verified-owner",...push()});
  });
});
