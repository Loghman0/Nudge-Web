import {before,after,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase,asUser,USER_A,USER_B} from './helpers/database';
import {assessCriteria,parseCriteria,criteriaForOptions,type ComparisonCriterion} from '../src/lib/services/comparison-criteria';

describe('criteria snapshots through the existing atomic database contract',()=>{
  let db:PGlite,id:string;
  const labels=['Option A','Option B'];
  const criteria:ComparisonCriterion[]=[{id:'time',label:'Duration',unit:'minutes',weight:1,direction:'lower',low:0,high:60,values:{'Option A':{value:30},'Option B':{value:15,sourceUrl:'https://example.invalid/synthetic',note:'Version 1 test rules'}}}];
  const context={domain:'synthetic rules v1',meaningConfirmed:true,comparisonBasis:'criteria',criteria,criteriaConfirmed:true,criteriaVersion:1};
  const assessment=assessCriteria(criteria,labels);
  const args=[JSON.stringify(context),JSON.stringify(assessment.options.map(o=>({label:o.label,score:o.low,breakdown:{criteriaLow:o.low,criteriaHigh:o.high,coverage:o.coverage}})))];
  before(async()=>{db=await createTestDatabase();});
  after(async()=>{await db.close();});
  it('persists the exact confirmed inputs and sources with a stable idempotent request',async()=>{
    const request='00000000-0000-4000-8000-000000001010';
    const create=()=>asUser(db,USER_A,tx=>tx.query<{id:string}>(`select create_comparison_once($1,'{"fixture":"criteria"}','other','Synthetic criteria',$2::jsonb,null,$3::jsonb,0) id`,[request,...args]));
    id=(await create()).rows[0].id;assert.equal((await create()).rows[0].id,id);
    const saved=(await db.query<{context:Record<string,unknown>}>("select context from decisions where id=$1",[id])).rows[0].context;
    assert.deepEqual(saved,context);
    const decoded=parseCriteria(saved,labels);assert.ok(!decoded.error);
    assert.deepEqual(assessCriteria(decoded.value!.criteria!,labels),assessment);
  });
  it('enforces ownership and revision checks while retaining all original options',async()=>{
    const options=(await db.query<{id:string;label:string;score:number;score_breakdown:Record<string,number>}>("select id,label,score,score_breakdown from decision_options where decision_id=$1 order by rank",[id])).rows.map(o=>({id:o.id,label:o.label,score:o.score,breakdown:o.score_breakdown}));
    await assert.rejects(asUser(db,USER_B,tx=>tx.query("select rerank_comparison($1,0,$2::jsonb,$3::jsonb,0)",[id,JSON.stringify(options),JSON.stringify(context)])),/not found|changed|open/i);
    const expanded=criteriaForOptions(criteria,[...labels,'Option C']);
    const next=assessCriteria(expanded,[...labels,'Option C']);
    assert.equal(next.leader,null);
    const scored=next.options.map(o=>({id:options.find(p=>p.label===o.label)?.id??null,label:o.label,score:o.low,breakdown:{criteriaLow:o.low,criteriaHigh:o.high,coverage:o.coverage}}));
    const nextContext={...context,criteria:expanded};
    await asUser(db,USER_A,tx=>tx.query("select rerank_comparison($1,0,$2::jsonb,$3::jsonb,0)",[id,JSON.stringify(scored),JSON.stringify(nextContext)]));
    await assert.rejects(asUser(db,USER_A,tx=>tx.query("select rerank_comparison($1,0,$2::jsonb,$3::jsonb,0)",[id,JSON.stringify(scored),JSON.stringify(nextContext)])),/changed/i);
    const saved=(await db.query<{context:Record<string,unknown>;comparison_revision:number}>("select context,comparison_revision from decisions where id=$1",[id])).rows[0];
    assert.equal(saved.comparison_revision,1);
    const parsed=parseCriteria(saved.context,[...labels,'Option C']);assert.equal(parsed.value!.criteria![0].values['Option C'].value,null);
    assert.equal(assessCriteria(parsed.value!.criteria!,[...labels,'Option C']).outcome,'uncertain');
  });
});
