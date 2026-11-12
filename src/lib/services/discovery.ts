import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database,Json} from '@/lib/types/database';
import {DISCOVERY_CATALOG,getDiscoveryQuestion,buildDiscoveryInsights,deriveDiscoveryObservations,discoveryDomain} from '@/lib/discovery';
import {DEFAULT_DISCOVERY_SETTINGS,type DiscoveryProfile,type DiscoveryFeedback} from '@/lib/discovery/contracts';
import type {DiscoveryResponse,DiscoveryExposure} from '@/lib/discovery/types';
export class DiscoveryError extends Error {constructor(public status:number,public code:string,message:string){super(message);}}
export function checkDiscoveryError(error:{code?:string;message?:string}|null){
  if(!error)return;
  if(error.code==='PT409')throw new DiscoveryError(409,'changed','Your saved answers changed. Reload and review before saving.');
  if(error.code==='PT404')throw new DiscoveryError(404,'not_found','This answer is no longer available.');
  if(error.code==='PT429')throw new DiscoveryError(429,'rate_limit','Take a moment, then try again.');
  throw new DiscoveryError(503,'unavailable','Questions could not be saved or loaded. Your draft is still here. Please try again.');
}
interface State {generation:number;today:string;capabilities?:{writtenAnswers:boolean;optionalTopics:boolean};suppressedQuestionIds?:string[];answers:{id:string;question_id:string;question_version:number;response:DiscoveryResponse;revision:number;active:boolean;answered_at:string}[];feedback:{insight_id:string;feedback:DiscoveryFeedback}[];exposures:{daily:boolean;local_day:string;question_version:number;question_id:string;family_id:string;served_at:string;state:DiscoveryExposure['state']}[];settings:{muted_topics?:string[];optional_topics?:boolean;max_depth?:0|1|2;written_answers?:boolean;metrics_enabled?:boolean}}
export async function loadDiscoveryProfile(client:SupabaseClient<Database>):Promise<DiscoveryProfile>{
  const {data,error}=await client.rpc('read_discovery_state');checkDiscoveryError(error);
  const raw=data as unknown as State;
  if(!raw||!Number.isInteger(raw.generation)||!Array.isArray(raw.answers))throw new DiscoveryError(503,'unavailable','Questions are not ready yet. Please try again.');
  const answers:DiscoveryProfile['answers']=raw.answers.flatMap(a=>{const question=getDiscoveryQuestion(a.question_id,a.question_version);return question?[{id:a.id,questionId:a.question_id,questionVersion:a.question_version,question,response:a.response,revision:a.revision,active:a.active,useInProfile:a.active&&!(raw.suppressedQuestionIds??[]).includes(a.question_id),answeredAt:a.answered_at}]:[];});
  const feedback=new Map(raw.feedback.map(f=>[f.insight_id,f.feedback]));
  const answerDates=new Map(answers.map(a=>[a.id,Date.parse(a.answeredAt)]));
  const latestEvidence=(ids:string[])=>Math.max(0,...ids.map(id=>answerDates.get(id)??0));
  const insights=buildDiscoveryInsights(answers).map(i=>({...i,feedback:feedback.get(i.id),state:feedback.get(i.id)==='fits'&&i.state!=='mixed'?'user_confirmed' as const:i.state})).sort((a,b)=>latestEvidence(b.evidenceIds)-latestEvidence(a.evidenceIds)||a.id.localeCompare(b.id));
  const settings=raw.settings??{};
  return {available:true,generation:raw.generation,today:raw.today,suppressedQuestionIds:raw.suppressedQuestionIds??[],capabilities:{writtenAnswers:raw.capabilities?.writtenAnswers===true&&process.env.NUDGE_DISCOVERY_WRITTEN_READY==="true",optionalTopics:raw.capabilities?.optionalTopics===true&&process.env.NUDGE_DISCOVERY_OPTIONAL_READY==="true"},answers,insights,counts:{answers:answers.filter(a=>a.useInProfile&&a.response.kind!=='skip').length,domains:new Set(answers.filter(a=>a.useInProfile&&a.response.kind!=='skip').map(a=>a.question.domain)).size,confirmed:insights.filter(i=>i.feedback==='fits').length},
    settings:{...DEFAULT_DISCOVERY_SETTINGS,mutedTopics:(settings.muted_topics??[]).flatMap(v=>discoveryDomain(v)??[]),optionalTopics:settings.optional_topics??false,maxDepth:settings.max_depth??0,writtenAnswers:settings.written_answers??false,metricsEnabled:settings.metrics_enabled??false},
    exposures:raw.exposures.map(e=>({questionId:e.question_id,questionVersion:e.question_version,daily:e.daily,localDay:e.local_day,familyId:e.family_id,servedAt:e.served_at,state:e.state,domain:getDiscoveryQuestion(e.question_id)?.domain}))};
}
export function usableDiscoveryObservations(profile:DiscoveryProfile){
  const feedback=new Map(profile.insights.map(i=>[i.id,i.feedback]));
  return deriveDiscoveryObservations(profile.answers).filter(o=>!['not_me','sometimes'].includes(feedback.get(o.id)??'')).map(o=>({...o,state:feedback.get(o.id)==='fits'&&o.state!=='mixed'?'user_confirmed' as const:o.state}));
}
/** Ask about uncovered decision inputs without repeatedly probing corrections. */
export function discoveryLearningNeeds(profile:DiscoveryProfile):string[]{
  const covered=new Set(profile.insights.map(i=>i.attributeKey).filter((key):key is string=>!!key));
  return [...new Set(DISCOVERY_CATALOG.flatMap(q=>q.signals?.filter(rule=>rule.criterion&&!covered.has(rule.attributeKey)).map(rule=>rule.attributeKey)??[]))];
}
export async function exportDiscoveryData(client:SupabaseClient<Database>){
  const result:Record<string,Json[]>={answers:[],revisions:[],exposures:[],feedback:[],settings:[],metrics:[]};
  for(let offset=0;offset<=1000000;offset+=200){
    const {data,error}=await client.rpc('export_discovery_data',{p_offset:offset});checkDiscoveryError(error);
    const page=data as Record<string,Json[]>;if(!page)throw new Error('Missing discovery export');
    let any=false;for(const key of Object.keys(result)){if(!Array.isArray(page[key]))throw new Error('Incomplete discovery export');result[key].push(...page[key]);any ||= page[key].length>0;}
    if(!any)return {...result,questions:result.answers.map(a=>{const row=a as {question_id:string;question_version:number};return getDiscoveryQuestion(row.question_id,row.question_version);})};
  }
  throw new Error('Discovery export exceeded the supported limit');
}


