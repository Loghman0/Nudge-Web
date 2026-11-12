import type { DiscoveryObservation } from '@/lib/discovery/types';
export interface DecisionSuggestion {id:string;kind:'criterion';label:string;statement:string;scope:string;evidenceIds:string[];questionIds:string[];observedAt:string|null;requiresConfirmation:true}
/** Explicit scoped rules only. Never infer option facts, weights, or a winner. */
export function suggestDecisionCriteria(observations:DiscoveryObservation[],context:{domain:string;category?:string;goal?:string},now=new Date()):DecisionSuggestion[]{
  const domain=context.domain.trim().toLowerCase();
  // A named game or private project needs its own context; an everyday-life
  // mapping cannot silently transfer to an unfamiliar setting.
  const everyday=['everyday life','real life','daily life','work','study','food','money','travel','learning','rest'];
  if(!everyday.includes(domain))return [];
  const seen=new Set<string>();
  return observations.filter(o=>o.state!=='mixed'&&o.allowedUses.includes('suggest_criterion')&&o.criterion
    &&o.criterion.decisionDomains.some(d=>d===domain||d===context.category)
    &&(!o.answeredAt||now.getTime()-Date.parse(o.answeredAt)<180*86400000))
    .sort((a,b)=>Number(b.state==='user_confirmed')-Number(a.state==='user_confirmed')||b.evidenceIds.length-a.evidenceIds.length)
    .filter(o=>{const key=o.criterion!.label.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;}).slice(0,3)
    .map(o=>({id:o.id,kind:'criterion',label:o.criterion!.label,statement:o.statement,scope:o.scope,evidenceIds:o.evidenceIds,questionIds:o.questionIds,observedAt:o.answeredAt,requiresConfirmation:true}));
}
