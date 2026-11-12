import {writeFile,mkdir,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const DOMAINS = ['rest','time','values','relationships','work','learning','money','food','culture','play','creativity','childhood','uncertainty','community','places','movement','digital','future'];
const INPUT_FIELDS = ['id','version','familyId','domain','subdomain','prompt','format','choices','scale','ranking','purpose','depth','sensitivity','estimatedSeconds','status','source','allowedResponses','signals','tags'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const text = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const slug = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 96;
const hash = value => createHash('sha256').update(value).digest('hex');

/** Stable object-key ordering; array order and every string value remain material. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const candidateHash = value => hash(canonicalJson(value));
export const normalize = value => typeof value === 'string' ? value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim() : '';
const words = value => new Set(normalize(value).split(' ').filter(Boolean));
export function similarity(a,b) {
  const x=words(a), y=words(b), intersection=[...x].filter(value => y.has(value)).length;
  return intersection/(x.size+y.size-intersection||1);
}

/** Generated content cannot select trusted provenance, preview status or inference rules. */
export function reviewCandidate(q, bank=[]) {
  const errors=[];
  if (!object(q)) return ['Not a question object'];
  if (!only(q,INPUT_FIELDS)) errors.push('Unknown or protected fields are not accepted');
  if (!slug(q.id)||q.version!==1) errors.push('Use a new slug and version 1');
  if (!text(q.prompt,12,240)) errors.push('Prompt must be 12–240 characters without control characters');
  if (!['choice','scale','ranking','text'].includes(q.format)) errors.push('Unsupported response format');
  if (!DOMAINS.includes(q.domain)) errors.push('Unknown domain');
  if (!slug(q.familyId)||!slug(q.subdomain)) errors.push('Family and subdomain must be bounded slugs');
  if (![0,1,2].includes(q.depth)||!['ordinary','optional'].includes(q.sensitivity)||!['evidence','playful'].includes(q.purpose)||!Number.isInteger(q.estimatedSeconds)||q.estimatedSeconds<5||q.estimatedSeconds>90) errors.push('Invalid depth, sensitivity, purpose or time');
  if (['childhood','uncertainty'].includes(q.domain)&&q.sensitivity!=='optional') errors.push('This topic requires optional sensitivity');
  if (q.status!==undefined&&q.status!=='draft') errors.push('Generated questions must remain drafts');
  if (q.source!==undefined&&q.source!=='generated') errors.push('Generated questions cannot claim authored provenance');
  if (q.signals!==undefined&&(!Array.isArray(q.signals)||q.signals.length!==0)) errors.push('Generated inference rules require separate engineering review; signals must be empty');
  if (q.tags!==undefined&&(!Array.isArray(q.tags)||q.tags.length>12||q.tags.some(tag=>!text(tag,1,60))||new Set(q.tags).size!==q.tags.length)) errors.push('Use at most 12 distinct short tags');
  if (!Array.isArray(q.allowedResponses)||!q.allowedResponses.includes('skip')||new Set(q.allowedResponses).size!==q.allowedResponses.length||q.allowedResponses.some(value=>!['both','depends','neither','skip'].includes(value))) errors.push('Include distinct supported neutral responses and skip');

  const choicesValid=Array.isArray(q.choices)&&q.choices.length>=2&&q.choices.length<=5
    &&q.choices.every(choice=>only(choice,['id','label'])&&slug(choice.id)&&text(choice.label,1,90))
    &&new Set(q.choices.map(choice=>choice.id)).size===q.choices.length
    &&new Set(q.choices.map(choice=>normalize(choice.label))).size===q.choices.length;
  if (['choice','ranking'].includes(q.format)&&!choicesValid) errors.push('Use 2–5 distinct short choices');
  if (!['choice','ranking'].includes(q.format)&&q.choices!==undefined) errors.push('Choices do not belong to this format');
  if (q.format==='scale') {
    const s=q.scale;
    if (!only(s,['min','max','step','minLabel','maxLabel'])||![s.min,s.max,s.step].every(Number.isFinite)
      ||s.min>=s.max||s.step<=0||(s.max-s.min)/s.step<1||(s.max-s.min)/s.step>10
      ||Math.abs((s.max-s.min)/s.step-Math.round((s.max-s.min)/s.step))>1e-8
      ||!text(s.minLabel,1,90)||!text(s.maxLabel,1,90)||normalize(s.minLabel)===normalize(s.maxLabel)) errors.push('Invalid bounded scale');
  } else if (q.scale!==undefined) errors.push('Scale settings do not belong to this format');
  if (q.format==='ranking') {
    const r=q.ranking;
    if (!only(r,['min','max','allowTies'])||!Number.isInteger(r.min)||!Number.isInteger(r.max)
      ||r.min<1||r.min>r.max||!choicesValid||r.max>q.choices.length||typeof r.allowTies!=='boolean') errors.push('Invalid ranking limits');
  } else if (q.ranking!==undefined) errors.push('Ranking settings do not belong to this format');

  const visibleText=[q.prompt,...(Array.isArray(q.choices)?q.choices.map(choice=>choice?.label):[]),q.scale?.minLabel,q.scale?.maxLabel,...(Array.isArray(q.tags)?q.tags:[])].filter(value=>typeof value==='string').join(' ');
  if (/\b(?:diagnos\w*|disorder|trauma|suicid\w*|sexual|abuse|bank account|full address|real name|which race|which religion|prove you|normal people|always|never)\b/i.test(visibleText)) errors.push('Tone or sensitive-content review required');
  if (Array.isArray(bank)&&bank.some(old=>object(old)&&(old.id===q.id||(typeof old.prompt==='string'&&(normalize(old.prompt)===normalize(q.prompt)||similarity(old.prompt,q.prompt)>.78))))) errors.push('Duplicate or near-duplicate');
  return errors;
}

function draftCandidate(candidate) {
  const q=Object.fromEntries(INPUT_FIELDS.filter(key=>Object.hasOwn(candidate,key)).map(key=>[key,candidate[key]]));
  return {...q,status:'draft',source:'generated',signals:[]};
}
const order=(a,b)=>a.id<b.id?-1:a.id>b.id?1:a.hash<b.hash?-1:a.hash>b.hash?1:0;
const batchHash=questions=>candidateHash(questions.map(q=>({id:q.id,hash:candidateHash(q)})).sort(order));
const bankHash=bank=>candidateHash(bank.map(q=>({id:q.id,version:q.version,hash:candidateHash(q)})).sort(order));
const validReviewTime=(value,now)=>typeof value==='string'
  &&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  &&Number.isFinite(Date.parse(value))&&Date.parse(value)<=now.getTime()
  &&new Date(value).toISOString().replace('.000Z','Z')===value.replace('.000Z','Z');

export function buildReviewPackage(candidates,bank) {
  if (!Array.isArray(candidates)||!candidates.length||candidates.length>1000) throw new Error('Use batches of 1–1000 candidates');
  if (!Array.isArray(bank)) throw new Error('Catalog must be an array');
  const entries=candidates.map(raw=>({raw,id:typeof raw?.id==='string'?raw.id:'',hash:candidateHash(raw)})).sort(order);
  const idCounts=new Map();
  for (const entry of entries) if(entry.id) idCounts.set(entry.id,(idCounts.get(entry.id)??0)+1);
  const accepted=[],records=[];
  for (const entry of entries) {
    const errors=reviewCandidate(entry.raw,[...bank,...accepted]);
    if ((idCounts.get(entry.id)??0)>1) errors.push('Repeated candidate ID in this batch');
    const candidate=errors.length?null:draftCandidate(entry.raw);
    records.push({id:entry.id||null,hash:candidate?candidateHash(candidate):entry.hash,errors,editorDecision:null,editor:null,reviewedAt:null});
    if(candidate) accepted.push(candidate);
  }
  return {candidates:accepted,review:{formatVersion:1,batchHash:batchHash(accepted),catalogHash:bankHash(bank),records},sample:accepted.filter((_,index)=>index%10===0)};
}

/** Records editor declarations; it cannot authenticate identity or prove human review.
 * The approved artifact remains an offline draft, never a database publication. */
export function approveReviewPackage(candidates,review,bank,now=new Date()) {
  if (!Array.isArray(candidates)||!candidates.length||candidates.length>1000||candidates.some(q=>!object(q))||!Array.isArray(bank)||!object(review)||review.formatVersion!==1||!Array.isArray(review.records)) throw new Error('Invalid review package');
  if (review.catalogHash!==bankHash(bank)) throw new Error('Published catalog changed; run review again');
  if (review.batchHash!==batchHash(candidates)) throw new Error('Candidate content changed; run review again');
  const seen=new Set(),approved=[],declarations=[];
  const candidatesByHash=new Map(candidates.map(q=>[candidateHash(q),q]));
  for (const record of review.records) {
    if (!object(record)||!Array.isArray(record.errors)) throw new Error('Invalid editor record');
    if (record.editorDecision==='approve'&&(record.errors.length||!candidatesByHash.has(record.hash))) throw new Error('Cannot approve a rejected or missing candidate');
  }
  for (const q of [...candidates].sort((a,b)=>order({id:a.id,hash:candidateHash(a)},{id:b.id,hash:candidateHash(b)}))) {
    if (seen.has(q.id)) throw new Error('Repeated candidate ID');
    seen.add(q.id);
    const errors=reviewCandidate(q,[...bank,...approved]);
    if (errors.length) throw new Error(`Candidate ${q.id}: ${errors.join('; ')}`);
    if(q.status!=='draft'||q.source!=='generated'||!Array.isArray(q.signals)||q.signals.length) throw new Error('Candidate is not a generated draft');
    const digest=candidateHash(q),matches=review.records.filter(record=>record.id===q.id&&record.hash===digest);
    if(matches.length!==1||matches[0].errors.length) throw new Error(`Missing or ambiguous matching review: ${q.id}`);
    const record=matches[0];
    if(!['approve','reject'].includes(record.editorDecision)||!text(record.editor,1,120)||!validReviewTime(record.reviewedAt,now)) throw new Error(`Record a decision, reviewer and past UTC review time for ${q.id}`);
    if(record.editorDecision==='approve') {
      approved.push({...q,review:{type:'editor_approved',version:1,reviewer:record.editor,reviewedAt:record.reviewedAt}});
      declarations.push({id:q.id,candidateHash:digest,editor:record.editor,reviewedAt:record.reviewedAt});
    }
  }
  if(!approved.length) throw new Error('No candidates were approved');
  return {artifactVersion:1,status:'approved_draft',batchHash:review.batchHash,catalogHash:review.catalogHash,candidates:approved,declarations};
}
/** Generate briefs, not claims of unique or reviewed questions. Streamable work units
 * let an operator supply offline model batches without sending any user records. */
export function* generationBriefs(taxonomy,limit=200){
 const contexts=['a free afternoon','a small shared project','a low-stakes surprise','a familiar routine','trying something new','choosing a comfortable place','a short journey','a playful experiment','helping a friend','making something','a spare ten minutes','an ordinary purchase','a rainy day','finishing a task','a quiet evening','an unexpected invitation','learning a small skill','a weekend plan','a group activity','an everyday tool','a shared space','a small celebration','an unhurried morning','a change of plan'];
 const angles=['starting','prioritizing','exploring','simplifying','sharing','adapting','finishing','reflecting'];let count=0;
 const capacity=4*contexts.length*angles.length*4*taxonomy.reduce((total,domain)=>total+domain.subdomains.length,0);
 if(!Number.isSafeInteger(limit)||limit<1||limit>Math.min(250000,capacity))throw new Error(`Choose 1–${Math.min(250000,capacity)} briefs for this taxonomy`);
 for(let variant=0;variant<4;variant++)for(const context of contexts)for(const angle of angles)for(const domain of taxonomy)for(const subdomain of domain.subdomains)for(const format of ['choice','scale','ranking','text']){
  if(count++>=limit)return;
  const spec={domain:domain.id,subdomain,context,angle,format,variant,depth:variant===0?0:variant<3?1:2,sensitivity:domain.optional?'optional':'ordinary'};
  yield generationBriefFromSpec(spec);
 }
}
/** Shared canonical construction: an offline runner never accepts custom prompts. */
export function generationBriefFromSpec(spec){
 const shape={id:'new-question-slug',version:1,familyId:'shared-topic-slug',domain:spec.domain,subdomain:spec.subdomain,prompt:'A concrete question in 12–240 characters?',format:spec.format,purpose:'playful',depth:spec.depth,sensitivity:spec.sensitivity,estimatedSeconds:20,status:'draft',source:'generated',signals:[],allowedResponses:['depends','neither','skip'],
  ...(['choice','ranking'].includes(spec.format)?{choices:[{id:'first',label:'One balanced option'},{id:'second',label:'Another balanced option'}]}:{}),
  ...(spec.format==='scale'?{scale:{min:0,max:4,step:1,minLabel:'One end',maxLabel:'The other end'}}:{}),
  ...(spec.format==='ranking'?{ranking:{min:1,max:2,allowTies:true}}:{})};
 return {jobId:hash(JSON.stringify(spec)).slice(0,24),spec,prompt:`Write one brief, curious self-discovery question for ${JSON.stringify(spec)}. Return only a JSON object with this structure, replacing example wording and slugs: ${JSON.stringify(shape)}. Use one recognizable everyday situation or clearly bounded recent experience. Ask about one thing at a time. Use 3–5 distinct, plausible choices where applicable, labels under 90 characters and an easy skip. Write natural first-person responses that people could honestly choose, including disengagement, frustration, convenience or ambivalence when relevant. Give each option a credible reason; do not make one option obviously mature or virtuous and the others defective. Do not assume everyone enjoys puzzles, crafting, spending money or socializing. A single answer is a report about its context, never proof of a stable personality trait. No diagnoses, identity probing, personal-data requests, moral verdicts, leading answers or claims about personality. Signals must be empty. status must be draft; source generated; version 1. Do not include review, preview, legacyQuestionId or user/account fields. Give a shared familyId to paraphrases. Include both/depends/neither where meaningful. The operator validates and reviews before publication. No user answers are supplied.`};
}
async function readJson(file) {
 const handle=await open(file,'r');
 try {
  if((await handle.stat()).size>8*1024*1024) throw new Error('Review files must not exceed 8 MiB');
  return JSON.parse(await handle.readFile('utf8'));
 } finally {await handle.close();}
}
export async function run(args){
 const [command,input,output]=args;const root=process.cwd(),bank=await readJson(path.join(root,'data/discovery-catalog.json'));
 if(command==='briefs'){
  const taxonomy=[...new Map(bank.map(q=>[q.domain,{id:q.domain,subdomains:[...new Set(bank.filter(x=>x.domain===q.domain).map(x=>x.subdomain))],optional:['childhood','uncertainty'].includes(q.domain)}])).values()];
  const limit=Number(input??200);if(!Number.isInteger(limit)||limit<1||limit>250000)throw new Error('Choose 1–250000 briefs');
  if(!output)throw new Error('Provide a new output file');
  // Validate the finite work space before creating an output artifact. Never
  // silently return fewer briefs than the operator requested.
  const briefs=generationBriefs(taxonomy,limit),first=briefs.next();
  const handle=await open(output,'wx');
  try{if(!first.done)await handle.write(`${JSON.stringify(first.value)}\n`);for(const brief of briefs)await handle.write(`${JSON.stringify(brief)}\n`);}finally{await handle.close();}
  return;
 }
 if(command==='review'){
  if(!input||!output)throw new Error('Provide candidate JSON and a new review-directory path');
  const result=buildReviewPackage(await readJson(input),bank);
  // Never overwrite editor decisions from an earlier run.
  await mkdir(output);
  for(const [name,value] of Object.entries(result))await writeFile(path.join(output,`${name}.json`),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  return;
 }
 if(command==='approve'){
  if(!input||!output)throw new Error('Provide a review directory and a new approved-artifact JSON path');
  const [candidates,review]=await Promise.all([readJson(path.join(input,'candidates.json')),readJson(path.join(input,'review.json'))]);
  const artifact=approveReviewPackage(candidates,review,bank);
  await writeFile(output,JSON.stringify(artifact,null,2)+'\n',{flag:'wx'});return;
 }
 throw new Error('Commands: briefs <count> <new-output.jsonl> | review <candidate.json> <new-review-directory> | approve <review-directory> <new-approved-artifact.json>. Approval never publishes to the app or database.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).catch(error=>{console.error(error instanceof Error?error.message:'Could not complete the offline review step');process.exitCode=1;});
}
