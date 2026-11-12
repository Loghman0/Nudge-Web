import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/types/database';
import type {ComparisonCriterion} from './comparison-criteria';
import {loadDiscoveryProfile,usableDiscoveryObservations} from './discovery';
import {suggestDecisionCriteria} from './decision-personalization';
export interface CriterionSource {
 criterionId:string;suggestionId:string;generation:number;
 answers:{answerId:string;answerRevision:number;questionId:string;questionVersion:number}[];
}
export class CriterionSourceChanged extends Error {
 constructor(){super('A suggested criterion has changed. Remove it or choose it again from your current reflections.');}
}
/** References are untrusted; only current, owner-scoped evidence may be saved. */
export async function resolveCriterionSources(client:SupabaseClient<Database>,criteria:ComparisonCriterion[],context:{domain:string;category?:string},generation:number):Promise<CriterionSource[]>{
 const accepted=criteria.filter(c=>c.discoverySuggestion);if(!accepted.length)return [];
 const profile=await loadDiscoveryProfile(client);
 if(profile.generation!==generation)throw new CriterionSourceChanged();
 const suggestions=suggestDecisionCriteria(usableDiscoveryObservations(profile),context);
 return accepted.map(c=>{
  const reference=c.discoverySuggestion!;
  const suggestion=suggestions.find(s=>s.id===reference.id);
  if(reference.generation!==generation||!suggestion||suggestion.label!==c.label)throw new CriterionSourceChanged();
  const answers=suggestion.evidenceIds.map(id=>profile.answers.find(a=>a.id===id&&a.useInProfile));
  if(!answers.length||answers.length>80||answers.some(a=>!a))throw new CriterionSourceChanged();
  return {criterionId:c.id,suggestionId:suggestion.id,generation,answers:answers.map(a=>({answerId:a!.id,answerRevision:a!.revision,questionId:a!.questionId,questionVersion:a!.questionVersion}))};
 });
}
