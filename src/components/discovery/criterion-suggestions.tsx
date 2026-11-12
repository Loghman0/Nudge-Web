'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import type {DecisionSuggestion} from '@/lib/services/decision-personalization';
import {discoveryRequest} from './client-api';
import {Button} from '@/components/ui/button';
interface Suggestions {generation:number;suggestions:DecisionSuggestion[]}
export function DiscoveryCriterionSuggestions({domain,category,onUse}:{domain:string;category:string|null;onUse:(suggestion:DecisionSuggestion,generation:number)=>void}){
 const [suggestions,setSuggestions]=useState<DecisionSuggestion[]>([]),[used,setUsed]=useState<string[]>([]),[error,setError]=useState(''),[pending,setPending]=useState<string|null>(null);
 const context=JSON.stringify({domain,category:category??undefined}),currentContext=useRef(context),inFlight=useRef(false);currentContext.current=context;
 useEffect(()=>{let active=true;setSuggestions([]);setUsed([]);setError('');if(domain.trim())discoveryRequest<Suggestions>('suggestions',{domain,category:category??undefined}).then(r=>{if(active)setSuggestions(r.suggestions);}).catch(()=>{});return()=>{active=false;};},[domain,category]);
 async function useSuggestion(id:string){
  if(inFlight.current)return;inFlight.current=true;setPending(id);setError('');const startedContext=context;
  try{const fresh=await discoveryRequest<Suggestions>('suggestions',{domain,category:category??undefined});if(currentContext.current!==startedContext)return;
   const selected=fresh.suggestions.find(v=>v.id===id);if(!selected){setSuggestions(fresh.suggestions);setError('This reflection changed. Choose from your current suggestions.');return;}
   onUse(selected,fresh.generation);setUsed(u=>[...u,id]);
  }catch{if(currentContext.current===startedContext)setError('Could not verify this suggestion. Try again.');}
  finally{inFlight.current=false;setPending(null);}
 }
 if(!suggestions.length)return error?<p role="alert" className="text-sm">{error}</p>:null;
 return <aside className="space-y-3 rounded-2xl border border-line bg-surface-raised p-4"><h3 className="text-sm font-medium">From what you’ve shared</h3><p className="text-sm text-ink-muted">These may matter here. Choose what fits this decision.</p>{suggestions.map(s=><div key={s.id} className="border-t border-line pt-3"><p className="text-sm">{s.statement}</p><p className="mt-1 text-xs text-ink-muted">In {s.scope.toLowerCase()}</p><Button className="mt-2" variant="secondary" disabled={pending!==null||used.includes(s.id)} onClick={()=>useSuggestion(s.id)}>{used.includes(s.id)?'Added':pending===s.id?'Checking…':`Use ${s.label}`}</Button></div>)}{error&&<p role="alert" className="text-sm">{error}</p>}<Link className="inline-block py-2 text-xs text-accent underline" href="/profile">Review the source answers</Link></aside>;
}

