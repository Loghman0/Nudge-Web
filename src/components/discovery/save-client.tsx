'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {clearGuestDraft,parseGuestDraft,readGuestDraft,writeGuestDraft,type GuestDiscoveryDraft} from '@/lib/discovery/guest-draft';
import {PREVIEW_VERSIONS as PREVIEW_QUESTIONS} from '@/lib/discovery/preview-catalog';
import {describeDiscoveryResponse} from '@/lib/discovery/validation';
import type {DiscoveryProfile} from '@/lib/discovery/contracts';
import {discoveryRequest} from './client-api';
import {Button} from '@/components/ui/button';
export function SaveDiscoveryPreview(){
 const [draft,setDraft]=useState<GuestDiscoveryDraft|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const router=useRouter();
 const inFlight=useRef(false);
 useEffect(()=>{setDraft(readGuestDraft(true)??readGuestDraft());setReady(true);},[]);
 async function save(){
  if(!draft||inFlight.current)return;inFlight.current=true;setBusy(true);setError('');
  try{
   // Recheck storage/expiry when saving, not only on mount. Another tab may
   // have discarded or replaced this preview while the review stayed open.
   let current=readGuestDraft(true)??readGuestDraft();
   if(!current||current.requestId!==draft.requestId||JSON.stringify(current.answers)!==JSON.stringify(draft.answers))throw new Error('This preview expired or changed on this device. Open a new preview before saving.');
   if(current.claimGeneration===undefined){
    const profile=await discoveryRequest<DiscoveryProfile>('profile');
    current={...current,claimGeneration:profile.generation};
   }
   if(!parseGuestDraft(JSON.stringify(current)))throw new Error('This preview has expired. Start a new preview or go to Today.');
   // Pin the first generation before transport. A lost response must never
   // make a retry silently adopt a later privacy-reset generation.
   if(!writeGuestDraft(current,true))throw new Error('Your browser blocked saving this preview. Allow local storage, then try again.');
   writeGuestDraft(current);setDraft(current);
   await discoveryRequest('claim',{requestId:current.requestId,expectedGeneration:current.claimGeneration,answers:current.answers});
   clearGuestDraft();router.replace('/dashboard');router.refresh();
  }catch(e){setError(e instanceof Error?e.message:'Could not save.');}
  finally{inFlight.current=false;setBusy(false);}
 }
 if(!ready)return <p role="status">Opening your preview…</p>;
 if(!draft?.answers.length)return <div className="space-y-4"><h1 className="font-display text-3xl">Your next discovery starts here.</h1><p>No preview is saved on this device. You can start with today’s question.</p><Link href="/dashboard" className="text-accent underline">Go to Today</Link></div>;
 return <div className="space-y-6"><h1 className="font-display text-3xl">Keep this first glimpse?</h1><p className="text-ink-muted">Save these answers to your private profile. You can edit, exclude, export, or delete them in About you.</p><ul className="divide-y divide-line">{draft.answers.map(a=>{const q=PREVIEW_QUESTIONS.find(q=>q.id===a.questionId&&q.version===a.questionVersion)!;return <li key={a.questionId} className="py-4"><p>{q.prompt}</p><p className="mt-1 text-sm text-ink-muted">{describeDiscoveryResponse(q,a.response)}</p></li>;})}</ul>{error&&<p role="alert">{error}</p>}<div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={save}>{busy?'Saving…':'Save to my profile'}</Button><Button variant="ghost" disabled={busy} onClick={()=>{clearGuestDraft();router.replace('/dashboard');}}>Discard preview</Button></div></div>;
}
