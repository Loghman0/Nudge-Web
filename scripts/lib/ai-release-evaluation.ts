import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/types/database';
import type { AiProvider } from '../../src/lib/services/ai/provider';
import { groundUnderstanding } from '../../src/lib/services/decision-understanding';
import { decisionScopeError } from '../../src/lib/services/decision-scope';
import { decodeUnderstanding, decodeMemories } from '../../src/lib/services/ai/language-tasks';
import { parseCriteria, assessCriteria } from '../../src/lib/services/comparison-criteria';
import { extractProfileMemories, confirmProfileMemoryReview } from '../../src/lib/services/profile-memory-intake';
import { POLICY_VERSION } from '../../src/lib/legal/config';
import {
  groundingCases, decoderCases, criteriaCases, privacyCases, scopeCases,
  type GroundingCase, type DecoderCase, type CriteriaCase, type PrivacyCase, type ScopeCase,
} from '../../tests/fixtures/ai-release-cases';

type EvaluationCase =
  | { group:'grounding'; fixture:GroundingCase }
  | { group:'decoders'; fixture:DecoderCase }
  | { group:'criteria'; fixture:CriteriaCase }
  | { group:'privacy'; fixture:PrivacyCase }
  | { group:'scope'; fixture:ScopeCase };
export const aiReleaseCases: EvaluationCase[] = [
  ...groundingCases.map(fixture=>({group:'grounding' as const,fixture})),
  ...decoderCases.map(fixture=>({group:'decoders' as const,fixture})),
  ...criteriaCases.map(fixture=>({group:'criteria' as const,fixture})),
  ...privacyCases.map(fixture=>({group:'privacy' as const,fixture})),
  ...scopeCases.map(fixture=>({group:'scope' as const,fixture})),
];

function checkGrounding(c:GroundingCase) {
  const interpretation=decodeUnderstanding(JSON.stringify({
    options:c.proposed,category:'other',domain:c.domain??'',goal:c.goal??'',
    unfamiliarTerms:c.terms??[],question:c.unsafeQuestion??'What setting and goal should I use?',
  }));
  const actual=groundUnderstanding(interpretation,c.text,c.named);
  assert.deepEqual(actual.options,c.expected,'Only complete supplied phrases or authoritative option slots may survive.');
  assert.equal(actual.domain,c.expectedDomain??'','An unstated domain must stay empty.');
  assert.equal(actual.goal,c.expectedGoal??'','An unstated goal must stay empty.');
  assert.deepEqual(actual.unfamiliarTerms,c.expectedTerms??[],'Unstated jargon must not be invented.');
  assert.equal(actual.source,'ai');
  assert.match(actual.notice,/check and edit|review/i,'Model interpretation must remain a reviewed draft.');
  assert.ok(actual.question.length>0&&actual.question.length<=300,'Clarification remains bounded and available.');
  if(c.unsafeQuestion)assert.notEqual(actual.question,c.unsafeQuestion,'An unchecked model premise must not become the clarification prompt.');
}
function checkDecoder(c:DecoderCase) {
  const raw=typeof c.raw==='string'?c.raw:JSON.stringify(c.raw);
  const decode=c.decoder==='understanding'?decodeUnderstanding:decodeMemories;
  if(c.throws){assert.throws(()=>decode(raw),'Malformed model output must fail validation.');return;}
  const actual=decode(raw);
  if(c.decoder==='understanding'){
    const understanding=actual as ReturnType<typeof decodeUnderstanding>;
    assert.deepEqual({options:understanding.options,domain:understanding.domain,goal:understanding.goal},c.expected);
    assert.equal(Object.hasOwn(actual,'recommendation'),false);
    assert.equal(Object.hasOwn(actual,'confidence'),false);
  }else assert.deepEqual(actual,c.expected);
}
function checkCriteria(c:CriteriaCase) {
  const raw={comparisonBasis:'criteria',criteriaConfirmed:true,...(c.invalid??{criteria:c.rows})};
  const parsed=parseCriteria(raw,['A','B']);
  if(c.invalid){assert.ok(parsed.error,'Contradictory or malformed criteria must be rejected.');return;}
  assert.equal(parsed.error,undefined);assert.ok(parsed.value?.criteria);
  const assessment=assessCriteria(parsed.value!.criteria!,['A','B']);
  assert.equal(assessment.outcome,c.outcome,'Winner selection must use only the fixed supplied measurements.');
  assert.equal(assessment.leader,c.leader,'Unknowns must not be imputed to create a leader.');
  if(assessment.leader){
    const leader=assessment.options.find(option=>option.label===assessment.leader)!;
    for(const other of assessment.options.filter(option=>option!==leader))assert.ok(leader.low>other.high+1e-9);
  }
  for(const option of assessment.options){assert.ok(option.low>=0&&option.high<=1);assert.ok(option.low<=option.high);}
}
async function checkPrivacy(c:PrivacyCase) {
  let providerCalls=0,reservations=0,writeAttempts=0,profileReads=0;
  const owner='evaluation-owner-'+c.id;
  const db={
    from:(table:string)=>{
      if(table!=='profiles'){writeAttempts++;throw new Error('Unexpected memory-table access');}
      return {select:()=>({eq:(field:string,value:string)=>{
        assert.equal(field,'id');assert.equal(value,owner);
        return {single:async()=>{
          profileReads++;
          return {data:{
            ai_enabled:c.mode!=='off'&&!(providerCalls&&c.mode==='withdrawn'),
            terms_version:c.mode==='old-terms'?'outdated':POLICY_VERSION,
            memory_generation:c.mode==='stale-review'||(providerCalls&&c.mode==='reset')?8:7,
          },error:null};
        }};
      }})};
    },
    rpc:async(name:string)=>{
      if(name==='reserve_ai_request'){reservations++;return {data:c.mode!=='quota-denied',error:null};}
      writeAttempts++;return {data:1,error:null};
    },
  } as unknown as SupabaseClient<Database>;
  const provider={extractMemories:async()=>{
    providerCalls++;
    if(c.mode==='provider-failure')throw new Error('Synthetic provider secret error');
    if(c.mode==='empty-output')return [];
    return [{kind:c.kind??'habit',content:c.content??c.text,confidence:.8}];
  }} as unknown as AiProvider;
  if(['unreviewed','empty-review','stale-review'].includes(c.mode)){
    const response=await confirmProfileMemoryReview(db,owner,{
      requestId:'00000000-0000-4000-8000-000000000001',generation:7,reviewed:c.mode!=='unreviewed',
      memories:c.mode==='empty-review'?[]:[{kind:'fact',content:c.text}],
    });
    assert.ok(response.error);assert.equal(response.saved,undefined);
    if(c.mode==='stale-review')assert.equal(response.stale,true);
    else assert.equal(profileReads,0,'Unreviewed or unselected input must fail before reading account data.');
    assert.equal(providerCalls,0);assert.equal(reservations,0);
  }else{
    const response=await extractProfileMemories(db,owner,c.text,c.mode==='no-provider'?null:provider);
    if(c.mode==='draft'){
      assert.deepEqual(response.draft,{generation:7,suggestions:[{kind:c.kind??'habit',content:c.content??c.text}]});
      assert.equal(providerCalls,1);assert.equal(reservations,1);
    }else{
      assert.equal(response.draft,undefined);assert.ok(response.error);
      const called=['withdrawn','reset','provider-failure','empty-output'].includes(c.mode);
      assert.equal(providerCalls,called?1:0,'Consent, terms, provider and quota checks must precede transmission.');
      if(c.mode==='withdrawn'||c.mode==='reset')assert.equal(response.stale,true);
      assert.doesNotMatch(response.error!,/Synthetic provider secret error/);
    }
  }
  assert.equal(writeAttempts,0,'AI suggestions and rejected reviews must never cause a durable memory write.');
}

export async function evaluateAiReleaseCase(test:EvaluationCase):Promise<void> {
  switch(test.group){
    case 'grounding':return checkGrounding(test.fixture);
    case 'decoders':return checkDecoder(test.fixture);
    case 'criteria':return checkCriteria(test.fixture);
    case 'privacy':return checkPrivacy(test.fixture);
    case 'scope':assert.equal(decisionScopeError(test.fixture.text)!==null,test.fixture.blocked,'Explicit high-stakes routing must stay distinct from ordinary preference choices.');return;
  }
}

export async function evaluateAiReleaseCorpus(){
  const ids=aiReleaseCases.map(test=>test.fixture.id);
  assert.ok(ids.length>=100,'The finite release corpus must contain at least 100 explicit cases.');
  assert.equal(new Set(ids).size,ids.length,'Case identities must stay unique and reviewable.');
  const cases:{id:string;group:string;status:'passed'|'failed';failure?:string}[]=[];
  for(const test of aiReleaseCases){
    try{await evaluateAiReleaseCase(test);cases.push({id:test.fixture.id,group:test.group,status:'passed'});}
    catch(error){cases.push({id:test.fixture.id,group:test.group,status:'failed',failure:error instanceof Error?error.message:'Unknown evaluation error'});}
  }
  return {
    schemaVersion:1,evaluatedAtUtc:new Date().toISOString(),mode:'local-synthetic-contracts',
    total:cases.length,passed:cases.filter(test=>test.status==='passed').length,failed:cases.filter(test=>test.status==='failed').length,
    groups:Object.fromEntries(['grounding','decoders','criteria','privacy','scope'].map(group=>[group,cases.filter(test=>test.group===group).length])),
    liveProviderEvaluation:false,providerNetworkCalls:0,durableMemoryWrites:0,
    semanticAccuracyMeasured:false,humanReviewCompleted:false,
    boundary:'Fixed synthetic contracts only. This does not measure a live model, semantic extraction accuracy, costs, latency, external fact verification or real-world outcomes.',
    cases,
  };
}
