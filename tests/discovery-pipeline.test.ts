import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {reviewCandidate,buildReviewPackage,approveReviewPackage,candidateHash,generationBriefs} from '../scripts/discovery-pipeline.mjs';

const question=(id='creative-pause')=>({id,version:1,familyId:'creative-pause',domain:'creativity',subdomain:'starting',prompt:'When a small creative project stalls, what would you try next?',format:'choice',choices:[{id:'a',label:'Make one rough version'},{id:'b',label:'Step away for a moment'}],purpose:'evidence',depth:0,sensitivity:'ordinary',estimatedSeconds:15,allowedResponses:['depends','neither','skip'],status:'draft',source:'generated',signals:[]});
const second=()=>({...question('food-small-plan'),familyId:'food-small-plan',domain:'food',subdomain:'preparation',prompt:'Which part of preparing a simple picnic sounds more enjoyable?',choices:[{id:'a',label:'Putting together familiar snacks'},{id:'b',label:'Arranging a colorful selection'}]});
const reviewTime='2026-10-29T12:00:00Z',now=new Date('2026-10-30T12:00:00Z');
function declareApproved(bundle:ReturnType<typeof buildReviewPackage>){for(const record of bundle.review.records){if(!record.errors.length){record.editorDecision='approve' as never;record.editor='Synthetic test editor' as never;record.reviewedAt=reviewTime as never;}}return bundle;}

test('Question pipeline rejects malformed nested content without crashing and preserves four valid formats',()=>{
  assert.deepEqual(reviewCandidate(question(),[]),[]);
  for(const choices of [null,{},'choices',[null,{id:'b',label:'B'}],[{id:'a',label:'A'},null],[{},{}],[{id:'a',label:'A'},{id:'a',label:'B'}],[{id:'a',label:'A'},{id:'b',label:' a '}],[{id:'a',label:'A',weight:1},{id:'b',label:'B'}]])assert.ok(reviewCandidate({...question(),choices},[]).length,JSON.stringify(choices));
  for(const raw of [null,[],true,'question',42])assert.ok(reviewCandidate(raw,[]).length);
  for(const allowedResponses of [null,{},['skip','skip'],['skip','invented']])assert.ok(reviewCandidate({...question(),allowedResponses},[]).length);
  const scale={...question(),format:'scale',choices:undefined,scale:{min:1,max:5,step:1,minLabel:'A quieter space',maxLabel:'A livelier space'}};
  assert.deepEqual(reviewCandidate(scale,[]),[]);
  for(const patch of [{step:0},{step:10},{step:1.5},{minLabel:''},{max:NaN},{extra:'value'}])assert.ok(reviewCandidate({...scale,scale:{...scale.scale,...patch}},[]).length);
  assert.deepEqual(reviewCandidate({...question(),format:'ranking',ranking:{min:1,max:2,allowTies:true}},[]),[]);
  assert.deepEqual(reviewCandidate({...question(),format:'text',choices:undefined},[]),[]);
});

test('Generated candidates cannot inject trusted provenance, privacy fields or inference rules',()=>{
  for(const field of ['review','preview','legacyQuestionId','user_id','__proto__','constructor']){
    const result=buildReviewPackage([{...question(),[field]:{type:'editor_approved'}}],[]);
    assert.equal(result.candidates.length,0,field);assert.match(result.review.records[0].errors.join(' '),/protected/);
  }
  for(const patch of [{status:'published'},{source:'starter'},{signals:{}},{signals:[{attributeKey:'clinical.claim'}]},{domain:'childhood',sensitivity:'ordinary'}])assert.ok(reviewCandidate({...question(),...patch},[]).length);
  assert.ok(reviewCandidate({...question(),choices:[{id:'a',label:'Reveal your bank account'},{id:'b',label:'Share your full address'}]},[]).some(e=>e.includes('sensitive')));
});

test('Deduplication and review package are stable when the input order changes',()=>{
  const near={...question('z-creative-pause'),prompt:'When a small creative project stalls, what would you try next today?'};
  const input=[question(),near,second()];
  assert.deepEqual(buildReviewPackage(input,[]),buildReviewPackage([...input].reverse(),[]));
  assert.equal(buildReviewPackage(input,[]).candidates.length,2);
  assert.equal(buildReviewPackage([question(),{...question(),prompt:second().prompt}],[]).candidates.length,0,'Repeated IDs reject both versions');
  assert.equal(buildReviewPackage([{...question('new-id'),prompt:question().prompt.toUpperCase()}],[question()]).candidates.length,0);
  assert.equal(candidateHash({a:1,b:[2,3]}),candidateHash({b:[2,3],a:1}));
  assert.notEqual(candidateHash({a:[1,2]}),candidateHash({a:[2,1]}));
});

test('Approval requires an explicit matching decision, reviewer and real past UTC date',()=>{
  const initial=buildReviewPackage([question()],[]);
  assert.throws(()=>approveReviewPackage(initial.candidates,initial.review,[],now),/Record a decision/);
  for(const patch of [{editor:''},{reviewedAt:'2028-01-01T12:00:00Z'},{reviewedAt:'2026-02-30T12:00:00Z'},{reviewedAt:'yesterday'},{editorDecision:'looks-good'}]){
    const bundle=declareApproved(buildReviewPackage([question()],[]));Object.assign(bundle.review.records[0],patch);
    assert.throws(()=>approveReviewPackage(bundle.candidates,bundle.review,[],now),/Record a decision/);
  }
  const valid=declareApproved(buildReviewPackage([question()],[]));
  const result=approveReviewPackage(valid.candidates,valid.review,[],now);
  assert.equal(result.status,'approved_draft');assert.equal(result.candidates[0].status,'draft');assert.deepEqual(result.candidates[0].signals,[]);
  assert.equal(result.candidates[0].review.reviewer,'Synthetic test editor');assert.equal(result.declarations[0].candidateHash,candidateHash(valid.candidates[0]));
});

test('Approval invalidates changed content, changed catalog, ambiguous records and rejected candidates',()=>{
  const bundle=declareApproved(buildReviewPackage([question()],[]));
  assert.throws(()=>approveReviewPackage([{...bundle.candidates[0],prompt:second().prompt}],bundle.review,[],now),/content changed/);
  assert.throws(()=>approveReviewPackage(bundle.candidates,bundle.review,[second()],now),/catalog changed/);
  const duplicated=structuredClone(bundle.review);duplicated.records.push(duplicated.records[0]);assert.throws(()=>approveReviewPackage(bundle.candidates,duplicated,[],now),/ambiguous/);
  const mismatched=structuredClone(bundle.review);mismatched.records[0].hash='0'.repeat(64);assert.throws(()=>approveReviewPackage(bundle.candidates,mismatched,[],now),/missing candidate/);
  const rejected=declareApproved(buildReviewPackage([question(),{...second(),status:'published'}],[]));
  const bad=rejected.review.records.find(r=>r.errors.length)!;Object.assign(bad,{editorDecision:'approve',editor:'Synthetic test editor',reviewedAt:reviewTime});
  assert.throws(()=>approveReviewPackage(rejected.candidates,rejected.review,[],now),/rejected or missing/);
});

test('Brief generation is deterministic and never creates review evidence',()=>{
  const taxonomy=[{id:'food',subdomains:['preparation'],optional:false}];
  const a=[...generationBriefs(taxonomy,12)],b=[...generationBriefs(taxonomy,12)];assert.deepEqual(a,b);assert.equal(a.length,12);assert.equal(new Set(a.map(job=>job.jobId)).size,12);
  assert.ok(a.every(job=>job.prompt.includes('No user answers are supplied')&&job.prompt.includes('Do not include review')));
  for(const limit of [0,-1,1.5,3073])assert.throws(()=>[...generationBriefs(taxonomy,limit)],/Choose 1–3072 briefs/);
});

test('CLI review and approval leave the live catalog untouched and refuse to overwrite review records',async()=>{
  const parent=resolve(tmpdir()),fixture=await mkdtemp(join(parent,'nudge-discovery-pipeline-'));
  try{
    await mkdir(join(fixture,'data'));await writeFile(join(fixture,'data','discovery-catalog.json'),'[]');
    const input=join(fixture,'candidate.json'),reviewDir=join(fixture,'review'),output=join(fixture,'approved.json');
    await writeFile(input,JSON.stringify([question()]));
    const script=fileURLToPath(new URL('../scripts/discovery-pipeline.mjs',import.meta.url));
    const run=(...args:string[])=>spawnSync(process.execPath,[script,...args],{cwd:fixture,encoding:'utf8'});
    const briefs=join(fixture,'too-many-briefs.jsonl');
    assert.equal(run('briefs','250000',briefs).status,1);await assert.rejects(access(briefs),'Unavailable brief counts must fail before creating an output');
    const scanned=run('review',input,reviewDir);assert.equal(scanned.status,0,scanned.stderr);
    const original=await readFile(join(reviewDir,'review.json'),'utf8');assert.equal(run('review',input,reviewDir).status,1);assert.equal(await readFile(join(reviewDir,'review.json'),'utf8'),original);
    assert.equal(run('approve',reviewDir,output).status,1);await assert.rejects(access(output));
    const records=JSON.parse(original);Object.assign(records.records[0],{editorDecision:'approve',editor:'Synthetic test editor',reviewedAt:reviewTime});await writeFile(join(reviewDir,'review.json'),JSON.stringify(records));
    const approved=run('approve',reviewDir,output);assert.equal(approved.status,0,approved.stderr);assert.equal(JSON.parse(await readFile(output,'utf8')).status,'approved_draft');
    assert.equal(run('approve',reviewDir,output).status,1);assert.equal(await readFile(join(fixture,'data','discovery-catalog.json'),'utf8'),'[]');
  }finally{
    const target=resolve(fixture),within=relative(parent,target);if(isAbsolute(within)||within.startsWith('..')||!within.startsWith('nudge-discovery-pipeline-'))throw new Error('Unexpected test fixture path');
    await rm(target,{recursive:true,force:true});
  }
});
