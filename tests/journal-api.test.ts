import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/types/database";
import { createApiAuthenticator } from "../src/lib/api/v1/auth";
import { createJournalGetHandler, createJournalDecisionGetHandler } from "../src/lib/api/v1/journal-route";
import { parseJournalQuery } from "../src/lib/services/journal-read";
import { buildComparisonSnapshot } from "../src/lib/services/comparison-snapshot";
import { DEFAULT_WEIGHTS } from "../src/lib/services/decision-engine";

const decisionId = "00000000-0000-4000-8000-000000000001";
const runId = "00000000-0000-4000-8000-000000000002";
const endpoint = "https://nudge.test/api/v1/decisions";
function setup(options: { user?: boolean; authError?: {status:number}; absent?: boolean; failure?: boolean;
  terms?: string; requireTerms?: boolean; rows?: number; count?: number; snapshot?: boolean; mismatchedSnapshot?: boolean } = {}) {
  const calls: unknown[][] = [], tokens: (string|undefined)[] = [];
  let cookies = 0;
  const snapshot = buildComparisonSnapshot({scoringRunId:runId,asOf:Date.parse("2026-10-24T12:00:00Z"),
    config:{configCategory:"default",version:1,weights:DEFAULT_WEIGHTS},ranked:["A","B"].map(label=>({label,tags:[],score:.5,breakdown:{preferenceMatch:.5,historySuccess:.5,novelty:.5}})),
    preferences:[],history:[],confidence:"low",coldStart:true,evidenceState:"insufficient"});
  const record = { id:decisionId,question:"Recorded choice",category:"other",status:"open",comparison_revision:1,
    context:{domain:"everyday life",goal:"My goal",comparisonBasis:"journal",scoring_run_id:runId,scored_at:snapshot.scoredAt,engine_version:2,
      engine_config:snapshot.engineConfig,confidence:"low",cold_start:true,evidence_state:"insufficient"},
    decision_options:snapshot.options.map((option,index)=>({id:String(index),label:option.label,rank:2-index,score:.5,score_breakdown:option.breakdown})),
    decision_reflections:[{rating:4,notes:"My journal note"}] };
  const query = {
    select:(...args:unknown[])=>{calls.push(["select",...args]);return query;},
    eq:(...args:unknown[])=>{calls.push(["eq",...args]);return query;},
    ilike:(...args:unknown[])=>{calls.push(["ilike",...args]);return query;},
    order:(...args:unknown[])=>{calls.push(["order",...args]);return query;},
    range:async(...args:unknown[])=>{calls.push(["range",...args]);return {data:Array.from({length:options.rows??2},()=>({id:decisionId})),count:options.count??5,error:options.failure?{message:"Private diagnostics"}:null};},
    maybeSingle:async()=>({data:options.absent?null:record,error:options.failure?{message:"Private diagnostics"}:null}),
  };
  const profile = { select:()=>profile,eq:()=>profile,maybeSingle:async()=>({data:{terms_version:options.terms??"current"},error:null}) };
  const client = { auth:{getUser:async(token?:string)=>{tokens.push(token);return {data:{user:options.user===false?null:{id:"verified-owner"}},error:options.authError??null};}},
    from:(table:string)=>{calls.push(["from",table]);return table==="profiles"?profile:query;},
    rpc:async(name:string,args:unknown)=>{calls.push(["rpc",name,args]);return {data:options.snapshot?[{decision_id:decisionId,comparison_revision:options.mismatchedSnapshot?2:1,scoring_run_id:runId,snapshot}]:[],error:null};},
  } as unknown as SupabaseClient<Database>;
  const auth = createApiAuthenticator({cookieClient:async()=>{cookies++;return client;},bearerClient:()=>client},
    {readOnly:true,requireCurrentTerms:options.requireTerms??false,policyVersion:"current"});
  return { list:createJournalGetHandler(auth),detail:createJournalDecisionGetHandler(auth),auth,calls,tokens,get cookies(){return cookies;} };
}
const detailContext=(id=decisionId)=>({params:Promise.resolve({id})});
async function body(response:Response){
  assert.equal(response.headers.get("cache-control"),"private, no-store, max-age=0");
  assert.equal(response.headers.get("pragma"),"no-cache");
  assert.equal(response.headers.get("x-content-type-options"),"nosniff");
  assert.equal(response.headers.get("access-control-allow-origin"),null);
  const value=await response.json();assert.equal(value.apiVersion,"1");return value;
}
describe("owner-scoped v1 journal reads",()=>{
  it("allows verified cookie GETs without Origin and rejects methods that could write",async()=>{
    const h=setup();const response=await h.list(new Request(endpoint));assert.equal(response.status,200);await body(response);
    assert.equal(h.cookies,1);assert.deepEqual(h.tokens,[undefined]);
    for(const method of ["POST","PUT","PATCH","DELETE"]){
      const denied=setup();const result=await denied.auth(new Request(endpoint,{method,headers:{authorization:"Bearer token"}}));
      assert.equal(result.ok,false);assert.equal(denied.cookies,0);assert.equal(denied.tokens.length,0);assert.equal(denied.calls.length,0);
    }
  });
  it("verifies bearer identity without cookie fallback and keeps outages distinct from missing sessions",async()=>{
    const valid=setup();const response=await valid.list(new Request(endpoint,{headers:{authorization:"Bearer native-token"}}));
    assert.equal(response.status,200);assert.deepEqual(valid.tokens,["native-token"]);assert.equal(valid.cookies,0);
    for(const [options,status] of [[{user:false},401],[{user:false,authError:{status:503}},503]] as const){
      const h=setup(options);const result=await h.list(new Request(endpoint,{headers:{authorization:"Bearer expired"}}));
      assert.equal(result.status,status);assert.equal(h.cookies,0);assert.equal(h.calls.length,0);
    }
    const malformed=setup();assert.equal((await malformed.list(new Request(endpoint,{headers:{authorization:"Bearer a b"}}))).status,401);assert.equal(malformed.calls.length,0);
  });
  it("enforces public-launch terms before journal reads",async()=>{
    const h=setup({requireTerms:true,terms:"old"});const response=await h.list(new Request(endpoint));
    assert.equal(response.status,403);assert.equal((await body(response)).error.code,"needs_terms");assert.deepEqual(h.calls,[["from","profiles"]]);
  });
  it("bounds filters, rejects duplicate/unknown values and scopes queries to verified identity",async()=>{
    for(const query of ["limit=0","limit=51","limit=1.5","offset=-1","offset=100001","status=deleted","category=constructor","limit=2&limit=3","user_id=forged","q="+"x".repeat(121)]){
      assert.equal(parseJournalQuery(new URLSearchParams(query)),null);
      const h=setup();const response=await h.list(new Request(endpoint+"?"+query));assert.equal(response.status,400);assert.equal((await body(response)).error.code,"invalid_query");assert.equal(h.calls.length,0);
    }
    const h=setup();const response=await h.list(new Request(endpoint+"?limit=4&offset=1&status=open&category=other&q="+encodeURIComponent("%_\\")));
    assert.equal(response.status,200);const result=await body(response);
    assert.ok(h.calls.some(call=>JSON.stringify(call)===JSON.stringify(["eq","user_id","verified-owner"])));
    assert.ok(h.calls.some(call=>JSON.stringify(call)===JSON.stringify(["ilike","question","%\\%\\_\\\\% ".trim()])));
    assert.deepEqual(h.calls.filter(call=>call[0]==="order"),[["order","created_at",{ascending:false}],["order","id",{ascending:true}]]);
    assert.deepEqual(result.data.pagination,{offset:1,limit:4,total:5,nextOffset:3});assert.equal(result.data.consistency,"live");
  });
  it("advances by actual rows under smaller server caps and fails instead of looping on an incomplete page",async()=>{
    const h=setup({rows:1,count:3});const result=await body(await h.list(new Request(endpoint+"?limit=50")));
    assert.equal(result.data.pagination.nextOffset,1);
    const empty=await setup({rows:0,count:3}).list(new Request(endpoint));assert.equal(empty.status,503);
    const end=await body(await setup({rows:0,count:3}).list(new Request(endpoint+"?offset=3")));assert.equal(end.data.pagination.nextOffset,null);
  });
  it("separates invalid identifiers, absent/foreign decisions and database errors",async()=>{
    const invalid=setup();assert.equal((await invalid.detail(new Request(endpoint),detailContext("bad"))).status,400);assert.equal(invalid.calls.length,0);
    const absent=setup({absent:true});const response=await absent.detail(new Request(endpoint),detailContext());assert.equal(response.status,404);
    assert.deepEqual(absent.calls.filter(call=>call[0]==="eq"),[["eq","user_id","verified-owner"],["eq","id",decisionId]]);
    const failed=await setup({failure:true}).detail(new Request(endpoint),detailContext());assert.equal(failed.status,503);assert.doesNotMatch(JSON.stringify(await body(failed)),/Private diagnostics/);
  });
  it("suppresses stale scores and derived confidence when saved evidence is absent or mismatched",async()=>{
    for(const options of [{},{snapshot:true,mismatchedSnapshot:true}]){
      const h=setup(options);const result=await body(await h.detail(new Request(endpoint),detailContext()));
      assert.equal(result.data.decision.saved_explanation.state,"unavailable");
      assert.ok(result.data.decision.decision_options.every((option:any)=>option.score===null&&option.score_breakdown===null));
      assert.equal(result.data.decision.context.confidence,undefined);assert.equal(result.data.decision.context.evidence_state,undefined);
      assert.equal(result.data.decision.context.goal,"My goal");assert.equal(result.data.decision.decision_reflections[0].notes,"My journal note");
      assert.deepEqual(h.calls.filter(call=>call[0]==="from"),[["from","decisions"]]);
    }
  });
  it("restores an exact saved explanation and returns stable option order without current memory queries",async()=>{
    const h=setup({snapshot:true});const result=await body(await h.detail(new Request(endpoint),detailContext()));
    assert.equal(result.data.decision.saved_explanation.state,"saved");assert.equal(result.data.decision.saved_explanation.snapshot.scoringRunId,runId);
    assert.deepEqual(result.data.decision.decision_options.map((option:any)=>option.label),["B","A"]);
    assert.ok(result.data.decision.decision_options.every((option:any)=>option.score===.5));
    assert.deepEqual(h.calls.filter(call=>call[0]==="rpc"),[["rpc","read_my_comparison_evidence",{p_decision_id:decisionId}]]);
  });
});
