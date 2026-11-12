import type {DecisionCategory} from '@/lib/types';
import { parseMeaning, type DecisionMeaning } from './decision-understanding';
import { parseCriteria, type CriteriaContext } from './comparison-criteria';

const categories: readonly DecisionCategory[] = ['food','entertainment','travel','shopping','lifestyle','work','social','health','career','relationships','finance','hobbies','other'];
export function isDecisionCategory(value: unknown): value is DecisionCategory {
  return typeof value === 'string' && categories.includes(value as DecisionCategory);
}
export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
interface Context extends DecisionMeaning, CriteriaContext {mood?:string;budget?:string;company?:string;category?:DecisionCategory;expectedOutcome?:string;appliedSetting?:{id:string;generation:number}}
type Parsed = {options:string[];title:string;context:Context;error?:never}|{error:string;options?:never;title?:never;context?:never};
/** Serialized action arguments are untrusted even when the caller uses TypeScript. */
export function parseComparisonInput(options:unknown,title:unknown,context:unknown):Parsed {
  if(!Array.isArray(options)||options.length>8||!options.every(v=>typeof v==='string'&&v.length<=80)) return {error:'Use up to eight options of at most 80 characters.'};
  if(typeof title!=='string'||title.length>120) return {error:'Keep the title within 120 characters.'};
  if(!context||typeof context!=='object'||Array.isArray(context)) return {error:'The comparison context is invalid.'};
  const raw=context as Record<string,unknown>;const cleaned:Context={};
  if(raw.appliedSetting!==undefined){
    const setting=raw.appliedSetting;
    if(!setting||typeof setting!=='object'||Array.isArray(setting)||Object.keys(setting).length!==2
      ||!isRequestId((setting as Record<string,unknown>).id)||!Number.isSafeInteger((setting as Record<string,unknown>).generation)
      ||Number((setting as Record<string,unknown>).generation)<0)return {error:'The saved setting is invalid. Apply it again.'};
    cleaned.appliedSetting=setting as {id:string;generation:number};
  }
  for(const name of ['mood','budget','company','expectedOutcome'] as const) {
    const value=raw[name];if(value===undefined)continue;
    const limit=name==='expectedOutcome'?300:80;
    if(typeof value!=='string'||value.length>limit) return {error:'The comparison context contains an invalid field.'};
    cleaned[name]=value.trim();
  }
  if(raw.category!==undefined){if(!isDecisionCategory(raw.category))return {error:'Choose a valid category.'};cleaned.category=raw.category;}
  const labels=options.map(v=>v.trim()).filter(Boolean);
  if(labels.length<2)return {error:'Add at least two distinct options to compare.'};
  if(new Set(labels.map(label=>label.toLowerCase())).size!==labels.length)
    return {error:'Each option needs a different name. Rename or remove duplicate options.'};
  const meaning = parseMeaning(raw, labels);
  if (meaning.error) return {error:meaning.error};
  Object.assign(cleaned, meaning.value);
  const criteria = parseCriteria(raw, labels);
  if (criteria.error) return {error:criteria.error};
  Object.assign(cleaned, criteria.value);
  return {options:labels,title:title.trim(),context:cleaned};
}
