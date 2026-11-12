"use client";
import Link from "next/link";
import { useEffect,useId,useRef,useState,useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addProfileNotes,confirmProfileMemories,setAiPreference,deleteMyAccount } from "./actions";
import { MEMORY_KINDS,type ProfileMemoryDraft,type ReviewedMemory } from "@/lib/services/profile-memory-review";
export function PrivacyControls({aiEnabled,accepted,aiAvailable=true,saveNotes=addProfileNotes,confirmNotes=confirmProfileMemories,changeAiPreference=setAiPreference}:{aiEnabled:boolean;accepted:boolean;aiAvailable?:boolean;saveNotes?:typeof addProfileNotes;confirmNotes?:typeof confirmProfileMemories;changeAiPreference?:typeof setAiPreference}){
  const id=useId();
  const [enabled,setEnabled]=useState(aiEnabled),[message,setMessage]=useState<string|null>(null),[pending,start]=useTransition();
  const [notes,setNotes]=useState(""),[noteMessage,setNoteMessage]=useState<string|null>(null),[noteError,setNoteError]=useState<string|null>(null),[savingNotes,startNotes]=useTransition();
  const [draft,setDraft]=useState<ProfileMemoryDraft|null>(null),[entries,setEntries]=useState<(ReviewedMemory&{selected:boolean})[]>([]),[reviewed,setReviewed]=useState(false);
  const [confirming,startConfirm]=useTransition();
  const noteInFlight=useRef(false);
  const confirmationIntent=useRef<{key:string;id:string}|null>(null);
  function discardDraft(){setDraft(null);setEntries([]);setReviewed(false);confirmationIntent.current=null;}
  function changeEntry(index:number,value:Partial<ReviewedMemory&{selected:boolean}>){setEntries(previous=>previous.map((entry,position)=>position===index?{...entry,...value}:entry));setReviewed(false);confirmationIntent.current=null;setNoteError(null);}
  useEffect(()=>{setEnabled(aiEnabled);if(!aiEnabled){setDraft(null);setEntries([]);setReviewed(false);confirmationIntent.current=null;}},[aiEnabled]);
  const selected=entries.filter(entry=>entry.selected);
  function suggest(){
    if(noteInFlight.current||notes.trim().length<3)return;noteInFlight.current=true;discardDraft();
    startNotes(async()=>{setNoteMessage(null);setNoteError(null);try{
      const result=await saveNotes(notes);if(result.error){setNoteError(result.error);return;}
      if(result.draft){setDraft(result.draft);setEntries(result.draft.suggestions.map(entry=>({...entry,selected:false})));setReviewed(false);setNoteMessage("Suggestions are ready to review. Nothing has been saved.");}
    }catch{setNoteError("Couldn't process these notes. Your text is still here; please try again.");}finally{noteInFlight.current=false;}});
  }
  function confirm(){
    if(noteInFlight.current||!draft||!reviewed||!selected.length)return;
    const memories=selected.map(({kind,content})=>({kind,content}));
    const key=JSON.stringify({generation:draft.generation,memories});
    if(confirmationIntent.current?.key!==key)confirmationIntent.current={key,id:crypto.randomUUID()};
    const input={requestId:confirmationIntent.current.id,generation:draft.generation,reviewed:true as const,memories};
    noteInFlight.current=true;
    startConfirm(async()=>{setNoteMessage(null);setNoteError(null);try{
      const result=await confirmNotes(input);
      if(result.stale)discardDraft();
      if(result.error){setNoteError(result.error);return;}
      if(result.saved){discardDraft();setNotes("");setNoteMessage(`${result.saved} ${result.saved===1?'reviewed memory':'reviewed memories'} saved. You can edit or remove them in Memories above.`);}
    }catch{setNoteError("Couldn't confirm these memories. Your review is still here. Try again to check the same save request.");}finally{noteInFlight.current=false;}});
  }
  return <section className="space-y-3"><h2 className="font-medium">AI assistance</h2><p className="text-sm text-ink-muted">Optional AI can process comparison questions, notes you explicitly submit here and limited decision summaries with the configured provider. Memory suggestions need your review before you save them. Comparison scores and reasons work without it. Saving a reflection does not send its notes to AI. Read the <Link href="/privacy" className="underline">Privacy policy</Link> before enabling.</p>
    {!aiAvailable&&<p className="text-sm text-ink-muted">AI assistance is unavailable on this deployment. Personal comparisons and your journal still work.</p>}
    {!accepted&&<p className="text-sm"><Link className="underline" href="/consent">Review the current terms first</Link></p>}
    <Button disabled={pending||savingNotes||confirming||!accepted||(!aiAvailable&&!enabled)} variant="secondary" onClick={()=>start(async()=>{setMessage(null);discardDraft();try{const result=await changeAiPreference(!enabled);if(result.error){setMessage(result.error);return;}setEnabled(!enabled);setMessage(enabled?"AI assistance turned off. Saved comparison settings and explanations were cleared; your journal and other stored memories remain.":"AI assistance enabled. Saved comparison settings and explanations were cleared; your journal remains.");}catch{setMessage("Couldn't save your AI choice. Please try again.");}})}>{pending?"Saving…":enabled?"Turn off AI assistance":"Enable optional AI assistance"}</Button>
    <p className="text-xs text-ink-muted">Currently {enabled?"on":"off"}. Changing this setting clears saved comparison settings and explanations. Your journal remains. Turning AI off stops new requests; it cannot recall requests already sent.</p>{message&&<p role="status" className="text-sm">{message}</p>}
    {enabled&&accepted&&aiAvailable&&<div className="space-y-3 border-t border-line pt-3">
      <form className="space-y-2" onSubmit={event=>{event.preventDefault();suggest();}}>
        <label htmlFor={`${id}-notes`} className="block text-sm">Optional notes to review</label><textarea id={`${id}-notes`} className="min-h-24 w-full rounded-xl border border-line bg-surface-raised p-3 text-sm" value={notes} onChange={event=>{setNotes(event.target.value);discardDraft();setNoteError(null);setNoteMessage(null);}} maxLength={2000} disabled={savingNotes||confirming} placeholder="A goal, recurring habit or practical constraint you want to record" />
        <p className="text-xs text-ink-muted">Suggest memories sends only this text to the configured AI provider. Up to six suggestions stay in this page until you select, edit and confirm them. Nothing is saved automatically. Onboarding text is not imported. These notes do not directly change comparison scores.</p>
        <Button type="submit" variant="secondary" disabled={savingNotes||confirming||pending||notes.trim().length<3}>{savingNotes?'Suggesting memories…':'Suggest memories'}</Button>
      </form>
      {draft&&<form className="space-y-3 rounded-xl border border-line p-3" onSubmit={event=>{event.preventDefault();confirm();}}>
        <h3 className="text-sm font-medium">Review suggested memories</h3><p className="text-xs text-ink-muted">AI suggestions can be wrong. Select only the statements you want Nudge to remember, edit their wording or type, then confirm your review. Suggestions are not verified facts.</p>
        {entries.map((entry,index)=><fieldset key={index} disabled={confirming} className="space-y-2 rounded-xl border border-line p-3">
          <legend className="text-sm">Memory {index+1}</legend>
          <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={entry.selected} onChange={event=>changeEntry(index,{selected:event.target.checked})}/>Save memory {index+1}</label>
          <label htmlFor={`${id}-kind-${index}`} className="block text-sm">Type for memory {index+1}</label><select id={`${id}-kind-${index}`} className="w-full rounded-xl border border-line bg-surface-raised p-2 text-sm" value={entry.kind} onChange={event=>changeEntry(index,{kind:event.target.value as ReviewedMemory["kind"]})}>{MEMORY_KINDS.map(kind=><option key={kind} value={kind}>{kind}</option>)}</select>
          <label htmlFor={`${id}-memory-${index}`} className="block text-sm">Memory text {index+1}</label><textarea id={`${id}-memory-${index}`} className="min-h-20 w-full rounded-xl border border-line bg-surface-raised p-3 text-sm" value={entry.content} maxLength={300} onChange={event=>changeEntry(index,{content:event.target.value})}/>
        </fieldset>)}
        <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" disabled={confirming} checked={reviewed} onChange={event=>setReviewed(event.target.checked)}/>I reviewed the selected memories and want to save them.</label>
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={confirming||!reviewed||!selected.length||selected.some(entry=>!entry.content.trim())}>{confirming?'Saving reviewed memories…':'Save selected memories'}</Button><Button type="button" variant="ghost" disabled={confirming} onClick={()=>{discardDraft();setNoteMessage("Suggestions discarded. Nothing was saved.");setNoteError(null);}}>Discard suggestions</Button></div>
      </form>}
      {noteError&&<p role="alert" className="text-sm text-red-600 dark:text-red-400">{noteError}</p>}{noteMessage&&<p role="status" className="text-sm">{noteMessage}</p>}
    </div>}
  </section>;
}
export function DeleteAccount(){
  const [open,setOpen]=useState(false),[confirmation,setConfirmation]=useState(""),[error,setError]=useState<string|null>(null),[pending,start]=useTransition();
  if(!open)return <Button variant="ghost" onClick={()=>setOpen(true)} className="text-red-600">Delete my account</Button>;
  return <section className="mt-4 space-y-3 rounded-xl border border-red-500/30 p-4"><h3 className="font-medium">Delete your account permanently</h3><p className="text-sm text-ink-muted">This removes your live journal, learning, saved comparison settings and explanations, reminders, subscriptions, votes and account. Your owned circles and their shared polls are also deleted for every member. Polls you created in other circles are removed. Export anything you need first. Restricted provider backups and logs expire under the retention policy.</p>
    <label className="block text-sm">Type DELETE to confirm<Input value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="off" className="mt-2"/></label>
    {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}<div className="flex gap-2"><Button disabled={pending||confirmation!=="DELETE"} onClick={()=>start(async()=>{setError(null);try{const result=await deleteMyAccount(confirmation);if(result?.error)setError(result.error);}catch(err){if(err instanceof Error && "digest" in err && String((err as {digest?:string}).digest).startsWith("NEXT_REDIRECT"))throw err;setError("Couldn't delete your account. Please try again.");}})}>{pending?"Deleting…":"Permanently delete account"}</Button><Button variant="ghost" disabled={pending} onClick={()=>setOpen(false)}>Cancel</Button></div>
  </section>;
}
