import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {readEarlierPattern} from '../src/lib/discover/loaders';

function fixture(rows:unknown[],error:unknown=null){
  const calls:unknown[][]=[];
  const query:any={};
  for(const method of ['select','eq','in','gte','order'])query[method]=(...args:unknown[])=>{calls.push([method,...args]);return query;};
  query.limit=(size:number)=>{calls.push(['limit',size]);return Promise.resolve({data:rows,error});};
  return {db:{from:(table:string)=>{calls.push(['from',table]);return query;}} as any,calls};
}
describe('earlier decision pattern review',()=>{
  it('keeps reviewed, domain-scoped and discovery evidence out of generic inferred patterns',async()=>{
    const {db,calls}=fixture([
      {key:'learned.food.scope.private.soup',value:'Private Soup',evidence_count:20,metadata:{}},
      {key:'discovery.food.snack',value:'Discovery snack',evidence_count:10,metadata:{}},
      {key:'learned.food.tea',value:'Tea',evidence_count:8,metadata:{manual_polarity:'neutral'}},
      {key:'learned.food.coffee',value:'Coffee',evidence_count:7,metadata:{manual_polarity:'like'}},
      {key:'learned.food.soup',value:'Soup',evidence_count:3,metadata:{}},
    ]);
    assert.deepEqual(await readEarlierPattern(db,'owner'),{prefKey:'learned.food.soup',label:'Soup',evidence:3});
    assert.ok(calls.some(call=>call[0]==='eq'&&call[1]==='user_id'&&call[2]==='owner'));
    assert.ok(calls.some(call=>call[0]==='eq'&&call[1]==='status'&&call[2]==='active'));
    assert.ok(calls.some(call=>call[0]==='eq'&&call[1]==='polarity'&&call[2]==='like'));
  });
  it('returns an honest empty state when nothing needs review',async()=>{
    assert.equal(await readEarlierPattern(fixture([]).db,'owner'),null);
  });
  it('reports a failed read instead of pretending there are no patterns',async()=>{
    await assert.rejects(readEarlierPattern(fixture([],{code:'PGRST202'}).db,'owner'),/database update/);
  });
});
