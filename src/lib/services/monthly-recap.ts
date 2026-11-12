import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/types/database';
import type {AiProvider,MonthlySummaryInput} from './ai/provider';
import {getAccountedAi} from './ai/accounting';
import {reserveAiRequest} from './ai/privacy';
import {withAiDeadline} from './ai/deadline';
import {AI_LIMITS,checkRateLimit} from './rate-limit';
import {POLICY_VERSION} from '@/lib/legal/config';
import {firstRelated} from './relations';

export type RecapReason='off'|'unavailable'|'capacity'|'no_data'|'failed'|'timed_out'|'changed';
export interface RecapResult{text:string|null;reason?:RecapReason;sampleSize?:number;sampled?:boolean;windowStart?:string;asOf?:string}
interface Dependencies{
 now?:()=>number;
 provider?:(db:SupabaseClient<Database>,userId:string)=>Promise<Pick<AiProvider,'summarizeMonth'>|null>;
 allowed?:(userId:string)=>boolean;
 reserve?:(db:SupabaseClient<Database>)=>Promise<boolean>;
 deadlineMs?:number;
}
const validGeneration=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
/** Shared owner-bound service: only explicit callers generate prose, never background reads. */
export async function generateOwnerRecap(db:SupabaseClient<Database>,userId:string,deps:Dependencies={}):Promise<RecapResult>{
 try{
  const read=()=>db.from('profiles').select('ai_enabled,memory_generation,terms_version').eq('id',userId).single();
  const initial=await read();if(initial.error||!initial.data||!validGeneration(initial.data.memory_generation))return {text:null,reason:'failed'};
  if(initial.data.ai_enabled!==true)return {text:null,reason:'off'};
  if(initial.data.terms_version!==POLICY_VERSION)return {text:null,reason:'changed'};
  const generation=initial.data.memory_generation;
  const current=async()=>{const state=await read();return !state.error&&!!state.data&&state.data.ai_enabled===true&&state.data.memory_generation===generation&&state.data.terms_version===POLICY_VERSION;};
  const provider=await (deps.provider??((client,owner)=>getAccountedAi(client,owner,'recap')))(db,userId);
  if(!provider)return {text:null,reason:'unavailable'};
  const now=(deps.now??Date.now)();if(!Number.isFinite(now))return {text:null,reason:'failed'};
  const asOf=new Date(now).toISOString(),windowStart=new Date(now-30*86400000).toISOString();
  const {data,error}=await db.from('decisions')
   .select('question,category,status,decided_at,selected_option_id,decision_options!decision_options_decision_id_fkey(id,label),decision_reflections(rating,has_regrets)')
   .eq('user_id',userId).gte('decided_at',windowStart).lte('decided_at',asOf).in('status',['decided','reflected'])
   .order('decided_at',{ascending:false}).order('id').limit(101);
  if(error||!Array.isArray(data))return {text:null,reason:'failed'};
  const sampled=data.length>100;
  const rows=data.slice(0,100).map(d=>{
   const reflection=firstRelated(d.decision_reflections),options=d.decision_options??[];
   if(typeof d.question!=='string'||typeof d.category!=='string'||!Array.isArray(options)
    ||(reflection?.rating!=null&&(!Number.isFinite(reflection.rating)||reflection.rating<1||reflection.rating>5))
    ||(reflection?.has_regrets!=null&&typeof reflection.has_regrets!=='boolean'))throw new Error('Invalid outcome data');
   return {question:d.question,category:d.category,chosen:options.find(o=>o.id===d.selected_option_id)?.label??null,rating:reflection?.rating??null,regret:reflection?.has_regrets??null};
  });
  if(rows.length<3)return {text:null,reason:'no_data'};
  if(!await current())return {text:null,reason:'changed'};
  const allowed=deps.allowed??(owner=>checkRateLimit(owner,'recap',AI_LIMITS.recap.limit,AI_LIMITS.recap.windowMs).allowed);
  if(!allowed(userId)||!await (deps.reserve??(client=>reserveAiRequest(client,'recap')))(db))return {text:null,reason:'capacity'};
  // Check again after reservation before sending any personal summary.
  if(!await current())return {text:null,reason:'changed'};
  const byCategory=new Map<string,number>();for(const row of rows)byCategory.set(row.category,(byCategory.get(row.category)??0)+1);
  const rated=rows.filter(row=>typeof row.rating==='number');
  const input:MonthlySummaryInput={windowDays:30,totalDecisions:rows.length,sampled,
   topCategories:[...byCategory].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,3).map(([category,count])=>({category,count})),
   bestRated:rated.filter(row=>row.rating!>=4&&row.chosen).slice(0,3).map(row=>({question:row.question,chosen:row.chosen!,rating:row.rating!})),
   regretted:rows.filter(row=>row.regret===true&&row.chosen).slice(0,3).map(row=>({question:row.question,chosen:row.chosen!})),
   averageRating:rated.length?Math.round(rated.reduce((sum,row)=>sum+row.rating!,0)/rated.length*10)/10:null};
  const text=await withAiDeadline(signal=>provider.summarizeMonth(input,{signal}),deps.deadlineMs??8000);
  if(!await current())return {text:null,reason:'changed'};
  if(typeof text!=='string'||!text.trim()||text.length>6000)return {text:null,reason:'failed'};
  return {text:text.trim(),sampleSize:rows.length,sampled,windowStart,asOf};
 }catch(error){return {text:null,reason:error instanceof Error&&error.name==='TimeoutError'?'timed_out':'failed'};}
}
