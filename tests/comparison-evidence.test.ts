import {describe,it} from "node:test";
import assert from "node:assert/strict";
import {attachComparisonReasons} from "../src/lib/services/comparison-evidence";
import {rankCandidates} from "../src/lib/services/decision-engine";
import type {Preference} from "../src/lib/types";

describe("comparison revision evidence",()=>{
  const pref:Preference={id:"p",user_id:"u",key:"food.soup",value:"soup",polarity:"like",strength:.8,source:"explicit",evidence_count:1};
  const at=Date.parse("2026-10-15T00:00:00Z");
  const ranked=rankCandidates([{label:"Soup",tags:["food.soup"]}],[pref],[],undefined,at);
  const saved=(scoringRunId?:string)=>({scoringRunId,options:[{label:"Soup",score:ranked[0].score,reasons:["Saved relative fit score."]}]});
  it("adds only the current scoring attempt's reasons",()=>{
    const result=attachComparisonReasons(saved("current"),"current",ranked,[pref],[],at);
    assert.ok(result.options[0].reasons.some(reason=>reason.includes("taste for soup")));
  });
  it("retains reasons after PostgreSQL REAL rounds the score to float32",()=>{
    const stored=saved("current");
    stored.options[0].score=Math.fround(ranked[0].score);
    assert.notEqual(stored.options[0].score,ranked[0].score);
    const result=attachComparisonReasons(stored,"current",ranked,[pref],[],at);
    assert.ok(result.options[0].reasons.some(reason=>reason.includes("taste for soup")));
    assert.equal(result.options[0].score,stored.options[0].score);
  });
  it("keeps persisted explanations when identical scores belong to another or legacy revision",()=>{
    for(const run of ["previous",undefined]){
      const prior=saved(run);
      assert.equal(attachComparisonReasons(prior,"current",ranked,[pref],[],at),prior);
    }
    const changed=saved("current");changed.options[0].score=.1;
    assert.deepEqual(attachComparisonReasons(changed,"current",ranked,[pref],[],at).options[0].reasons,["Saved relative fit score."]);
  });
});
