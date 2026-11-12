'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {DISCOVERY_DOMAINS,DISCOVERY_MOODS,discoveryMood,validateDiscoveryResponse,type DiscoveryMood,type DiscoveryQuestion,type DiscoveryResponse} from '@/lib/discovery';
import type {DiscoveryProfile} from '@/lib/discovery/contracts';
import {QuestionRenderer} from './question-renderer';
import {discoveryRequest} from './client-api';
import {Button} from '@/components/ui/button';
interface NextQuestion {question:DiscoveryQuestion|null;reason:string;generation:number;answered?:boolean}
export function DailyDiscovery(){
 const [profile,setProfile]=useState<DiscoveryProfile|null>(null),[question,setQuestion]=useState<DiscoveryQuestion|null>(null),[value,setValue]=useState<DiscoveryResponse|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false),[stopped,setStopped]=useState(false),[empty,setEmpty]=useState(''),[topic,setTopic]=useState(''),[mode,setMode]=useState('light'),[count,setCount]=useState(0),[skips,setSkips]=useState(0);
 const [mood,setMood]=useState<DiscoveryMood|null>(null);
 const initialId=useRef(''),inFlight=useRef(false);
 const pendingSave=useRef<{intent:string;payload:Record<string,unknown>}|null>(null);
 const pendingReservation=useRef<{intent:string;payload:Record<string,unknown>}|null>(null);
 const open=useCallback(async(p:DiscoveryProfile,options:{daily?:boolean;change?:boolean;topic?:string;continued?:boolean;session?:number;skipCount?:number}={})=>{
  const body={expectedGeneration:p.generation,daily:options.daily??false,change:options.change??false,topic:options.topic||null,mode,...(mood?{mood}:{}),localHour:new Date().getHours(),sessionAnswers:options.session??0,consecutiveSkips:options.skipCount??0,continueAfterPause:options.continued??false};
  const intent=JSON.stringify(body);
  if(pendingReservation.current?.intent!==intent)pendingReservation.current={intent,payload:{...body,requestId:options.daily&&!options.change?initialId.current:crypto.randomUUID()}};
  const result=await discoveryRequest<NextQuestion>('next',pendingReservation.current.payload);
  pendingReservation.current=null;pendingSave.current=null;
  setQuestion(result.question);setValue(null);setDone(result.answered??false);setStopped(false);setEmpty(result.reason);
 },[mode,mood]);
 useEffect(()=>{let active=true;initialId.current ||= crypto.randomUUID();setBusy(true);inFlight.current=true;discoveryRequest<DiscoveryProfile>('profile').then(async p=>{if(active){setProfile(p);await open(p,{daily:true});}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active){inFlight.current=false;setBusy(false);}});return()=>{active=false;};},[]); // Initial reservation is idempotent across Strict Mode effects.
 async function save(){
  if(!value||!question||!profile||inFlight.current)return;
  const parsed=validateDiscoveryResponse(question,value);if(!parsed.value){setError(parsed.error??'Choose an answer.');return;}
  const body={expectedGeneration:profile.generation,answers:[{questionId:question.id,questionVersion:question.version,response:parsed.value}]},intent=JSON.stringify(body);
  if(pendingSave.current?.intent!==intent)pendingSave.current={intent,payload:{...body,requestId:crypto.randomUUID()}};
  inFlight.current=true;setBusy(true);setError('');let saved=false;
  try{await discoveryRequest('answers',pendingSave.current.payload);saved=true;pendingSave.current=null;setCount(c=>c+1);setSkips(s=>value.kind==='skip'?s+1:0);setDone(true);setProfile(await discoveryRequest<DiscoveryProfile>('profile'));}
  catch(e){setError(saved?'Your answer was saved, but your updated profile could not load. Reload to refresh it.':e instanceof Error?e.message:'Could not save.');}
  finally{inFlight.current=false;setBusy(false);}
 }
 async function more(change=false){
  if(!profile||inFlight.current)return;inFlight.current=true;setBusy(true);setError('');
  const continueAfterPause=count>=3||skips>=2||stopped;
  try{const fresh=await discoveryRequest<DiscoveryProfile>('profile');setProfile(fresh);await open(fresh,{change,daily:change,topic,continued:continueAfterPause,session:count,skipCount:skips});if(continueAfterPause){setCount(0);setSkips(0);}}
  catch(e){setError(e instanceof Error?e.message:'Could not open a question. Your current answer is still here.');}
  finally{inFlight.current=false;setBusy(false);}
 }
 return <section className="space-y-6" aria-label="Your daily question"><div className="flex flex-wrap items-start justify-between gap-3"><h1 className="font-display text-4xl">What feels like you today?</h1><Link href="/profile" className="py-3 text-sm text-accent underline">Your reflections</Link></div>
 <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-end">
  <label className="flex flex-col gap-2 text-sm">Mood (optional)<select disabled={busy} value={mood??''} onChange={e=>setMood(discoveryMood(e.target.value))} className="min-h-12 rounded-xl border border-line bg-surface p-2"><option value="">No preference</option>{DISCOVERY_MOODS.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
  <label className="flex flex-col gap-2 text-sm">Pace<select disabled={busy} value={mode} onChange={e=>setMode(e.target.value)} className="min-h-12 rounded-xl border border-line bg-surface p-2"><option value="light">Keep it light</option><option value="curious">Curious</option><option value="reflect">Ready to reflect</option></select></label>
  <label className="flex flex-col gap-2 text-sm">Topic<select disabled={busy} value={topic} onChange={e=>setTopic(e.target.value)} className="min-h-12 max-w-56 rounded-xl border border-line bg-surface p-2"><option value="">Surprise me</option>{DISCOVERY_DOMAINS.filter(d=>!profile?.settings.mutedTopics.includes(d.id)&&(!d.optional||(profile?.settings.optionalTopics&&profile?.capabilities.optionalTopics))).map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
  <Button variant="secondary" disabled={busy||!profile} onClick={()=>more(true)}>Change question</Button>
 </div>
 {error&&<div role="alert" className="rounded-xl border border-line p-4"><p>{error}</p><Button className="mt-2" variant="secondary" disabled={busy} onClick={()=>window.location.reload()}>Reload questions</Button></div>}
 {!profile&&!error&&<p role="status">Opening your questions…</p>}
 {stopped?<div className="rounded-2xl border border-line p-6"><h2 className="font-display text-2xl">That’s enough for today.</h2><p className="mt-2 text-ink-muted">Your answers will be here when you return.</p><Button className="mt-4" variant="secondary" disabled={busy} onClick={()=>more()}>Keep exploring</Button></div>:done?<div className="rounded-2xl border border-line bg-surface-raised p-6"><p className="font-display text-2xl">A small piece of your story, saved.</p><p className="mt-2 text-ink-muted">{count>=3||skips>=2?'A good place to pause.':'You can leave it here, or explore a little more.'}</p><div className="mt-5 flex flex-wrap gap-3"><Button disabled={busy} onClick={()=>more()}>{count>=3||skips>=2?'Another three':'One more question'}</Button><Button variant="ghost" disabled={busy} onClick={()=>setStopped(true)}>Stop for now</Button></div><Link href="/profile" className="mt-4 inline-block text-sm text-accent underline">See what your answers say</Link></div>:question?<div className="space-y-5 rounded-3xl border border-line bg-surface-raised p-5 md:p-8"><QuestionRenderer key={question.id} question={question} value={value} onChange={setValue} disabled={busy}/><Button disabled={!value||busy} onClick={save}>{busy?'Saving…':'Save answer'}</Button></div>:profile&&!busy&&!error?<p>{empty==='pause'?'A good place to pause.':'You’ve reached the available questions for these settings. Try another topic or adjust question preferences in About you.'}</p>:null}
 <div className="flex flex-wrap gap-5 border-t border-line pt-5 text-sm"><Link className="text-accent underline" href="/ask">Have a decision in mind?</Link><Link className="text-accent underline" href="/history">Open your journal</Link><Link className="text-accent underline" href="/profile#question-settings">Question preferences</Link></div>
 </section>;
}
