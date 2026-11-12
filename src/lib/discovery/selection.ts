import { DISCOVERY_CATALOG } from './catalog';
import type { DiscoveryQuestion, DiscoverySelection, DiscoverySelectionInput } from './types';
import {discoveryMoodFit} from './mood';
export function selectDiscoveryQuestion(input:DiscoverySelectionInput,catalog:readonly DiscoveryQuestion[]=DISCOVERY_CATALOG):DiscoverySelection{
  const now=input.now??Date.now(),random=input.random??Math.random;
  if(!input.continueAfterPause&&((input.consecutiveSkips??0)>=2||(input.sessionAnswers??0)>=3))return {question:null,reason:'pause',selectorVersion:1,score:0};
  const answered=new Set(input.answers.map(answer=>answer.questionId));
  const recent=new Set((input.exposures??[]).filter(exposure=>now-Date.parse(exposure.servedAt)<30*86400000).map(exposure=>exposure.familyId));
  const counts=new Map<string,number>();
  for(const answer of input.answers){const q=catalog.find(q=>q.id===answer.questionId);if(q&&answer.response.kind!=='skip')counts.set(q.domain,(counts.get(q.domain)??0)+1);}
  const last=(input.exposures??[]).slice(-2),sameRun=last.length===2&&last[0].domain===last[1].domain?last[0].domain:null;
  const maxDepth=Math.min(input.maxDepth??0,input.mode==='light'?0:input.mode==='curious'?1:2);
  let candidates=catalog.filter(q=>q.status==='published'&&!answered.has(q.id)&&!recent.has(q.familyId)&&!input.suppressedQuestionIds?.includes(q.id)
    &&(!input.topic||q.domain===input.topic)&&!input.mutedTopics?.includes(q.domain)
    &&(q.sensitivity==='ordinary'||input.allowedOptional===true)&&(q.format!=='text'||input.allowText===true)
    &&q.depth<=maxDepth&&!(q.signals??[]).some(rule=>input.forgottenAttributes?.includes(rule.attributeKey)));
  if(!input.topic&&sameRun&&candidates.some(q=>q.domain!==sameRun))candidates=candidates.filter(q=>q.domain!==sameRun);
  if(!candidates.length)return {question:null,reason:'exhausted',selectorVersion:1,score:0};
  const scored=candidates.map(q=>{
    const need=(q.signals??[]).some(rule=>input.learningNeeds?.includes(rule.attributeKey))?1:0;
    const coverage=1/(1+(counts.get(q.domain)??0));
    const relevant=input.relevantDomains?.includes(q.domain)?1:0;
    const energy=input.mode==='reflect'?1:input.mode==='curious'?1-q.estimatedSeconds/120:1-q.estimatedSeconds/60;
    const time=input.localHour===undefined ? .5 : (input.localHour>=22||input.localHour<7)?1-q.estimatedSeconds/60:.5;
    return {q,score:.25*need+.20*coverage+.15*relevant+.15*Math.max(0,energy)+.10+.05*Math.max(0,time)+.10-.25*Math.min(1,(input.sessionAnswers??0)/12)+.45*discoveryMoodFit(q,input.mood)};
  });
  if(random()<.2){
    const min=Math.min(...scored.map(({q})=>counts.get(q.domain)??0));
    const under=scored.filter(({q})=>(counts.get(q.domain)??0)===min),domains=[...new Set(under.map(({q})=>q.domain))];
    // Explore under-covered areas, with a visible mood preference rather than an
    // unrelated uniform domain on one fifth of requests. Every eligible area stays reachable.
    let domain=domains[Math.min(domains.length-1,Math.floor(random()*domains.length))];
    if(input.mood&&input.mood!=='mixed'){
      const weights=domains.map(d=>Math.exp(3*Math.max(...under.filter(({q})=>q.domain===d).map(({q})=>discoveryMoodFit(q,input.mood)))));
      let cursor=random()*weights.reduce((sum,weight)=>sum+weight,0);
      for(let index=0;index<domains.length;index++){cursor-=weights[index];if(cursor<=0){domain=domains[index];break;}}
    }
    const pool=under.filter(({q})=>q.domain===domain);
    // Explore under-covered domains, while still preferring a comfortable format
    // within that domain. With no mood, preserve the existing uniform behavior.
    let picked=pool[pool.length-1];
    if(!input.mood||input.mood==='mixed')picked=pool[Math.min(pool.length-1,Math.floor(random()*pool.length))];
    else{
      const weights=pool.map(item=>Math.exp(2*discoveryMoodFit(item.q,input.mood)));
      let cursor=random()*weights.reduce((sum,weight)=>sum+weight,0);
      for(let index=0;index<pool.length;index++){cursor-=weights[index];if(cursor<=0){picked=pool[index];break;}}
    }
    return {question:picked.q,reason:'explore',selectorVersion:1,score:picked.score};
  }
  // Mood must not turn a profile-building session into a fixed-topic funnel.
  // Keep the whole eligible bank reachable; the ordinary no-mood path is unchanged.
  const hasMood=!!input.mood&&input.mood!=='mixed',temperature=.15;
  const top=scored.sort((a,b)=>b.score-a.score||a.q.id.localeCompare(b.q.id)).slice(0,hasMood?scored.length:20),weights=top.map(item=>Math.exp((item.score-top[0].score)/temperature));
  let cursor=random()*weights.reduce((a,b)=>a+b,0),chosen=top[top.length-1];
  for(let i=0;i<top.length;i++){cursor-=weights[i];if(cursor<=0){chosen=top[i];break;}}
  return {question:chosen.q,reason:input.relevantDomains?.includes(chosen.q.domain)?'relevant':'coverage',selectorVersion:1,score:chosen.score};
}
