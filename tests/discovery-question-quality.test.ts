import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PREVIEW_QUESTIONS,getDiscoveryQuestion,parseDiscoveryAnswers,deriveDiscoveryObservations} from '../src/lib/discovery';
import {parseGuestDraft} from '../src/lib/discovery/guest-draft';
import {previewQuestionsForEdition} from '../src/lib/discovery/preview-catalog';

test('Every revised starter answer has a literal, contextual reflection without personality verdicts',()=>{
 assert.equal(PREVIEW_QUESTIONS.length,6);
 for(const q of PREVIEW_QUESTIONS){
  assert.equal(q.version,2);assert.equal(q.choices?.length,5);
  for(const choice of q.choices!){
   assert.ok(choice.label.length<=90);
   const [o,...others]=deriveDiscoveryObservations([{questionId:q.id,questionVersion:q.version,response:{kind:'choice',optionId:choice.id}}]);
   assert.ok(o,`${q.id}/${choice.id} must not silently lose the answer`);assert.deepEqual(others,[]);
   assert.ok(o.scope.length>10);assert.match(o.statement,/^You (said|chose|recalled)/);
   assert.doesNotMatch(o.statement,/you are|you're|aggressive|lazy|impatient|disorder|personality/i);
   assert.equal(o.state,'you_said');
  }
 }
 const frustration=deriveDiscoveryObservations([{questionId:'learning-puzzle',questionVersion:2,response:{kind:'choice',optionId:'d'}}])[0];
 assert.match(frustration.statement,/recalled getting frustrated/);assert.equal(frustration.criterion,undefined);
});
test('Prior question definitions and drafts keep their meaning through the edition change',()=>{
 const old=getDiscoveryQuestion('learning-puzzle',1)!,current=getDiscoveryQuestion('learning-puzzle')!;
 assert.match(old.prompt,/puzzle box/);assert.match(old.choices![3].label,/Study it/);
 assert.doesNotMatch(current.prompt,/puzzle box/);assert.match(current.choices![3].label,/frustrated/);
 const response={questionId:old.id,questionVersion:1,response:{kind:'choice' as const,optionId:'d'}};
 assert.ok(parseDiscoveryAnswers([response],{previewOnly:true}).value);
 assert.match(deriveDiscoveryObservations([response])[0].statement,/study the puzzle/);
 const first=previewQuestionsForEdition(1)[0];
 const draft={version:1,createdAt:Date.now(),requestId:'00000000-0000-4000-8000-000000000001',answers:[{questionId:first.id,questionVersion:1,response:{kind:'choice',optionId:'a'}}]};
 assert.equal(parseGuestDraft(JSON.stringify(draft))?.questionEdition,1);
 assert.equal(parseGuestDraft(JSON.stringify({...draft,questionEdition:2})),null,'An old answer cannot be relabeled as a new edition');
 assert.equal(parseGuestDraft(JSON.stringify({...draft,answers:[]}))?.questionEdition,2);
});
