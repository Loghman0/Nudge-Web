"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { correctBelief, editMemory, inspectEvidence, forgetBelief, searchMemory, loadMemories } from "./actions";
import { MEMORY_PAGE_SIZE, type MemoryPage, type StoredMemory } from "@/lib/services/profile-memories";
import { journalDate } from "@/lib/services/calendar";
import type { Json } from "@/lib/types/database";

type Node = { id: string; key: string; value: string | null; category_slug: string; polarity: string;
  confidence: number; source: string; evidence_count: number; last_reinforced_at: string | null; metadata?:Json };
type Evidence = Awaited<ReturnType<typeof inspectEvidence>>["evidence"];
function Belief({ node,timeZone }: { node: Node;timeZone:string|null }) {
  const label = node.value ?? node.key.split(".").pop()!.replace(/-/g," ");
  const domain=node.metadata && typeof node.metadata==="object" && !Array.isArray(node.metadata) && typeof node.metadata.decision_domain==="string"?node.metadata.decision_domain:null;
  const [forgotten,setForgotten] = useState(false);
  const [polarity,setPolarity] = useState(node.polarity);
  const [note,setNote] = useState(""); const [message,setMessage] = useState<string | null>(null);
  const [evidence,setEvidence] = useState<Evidence | null>(null);
  const [pending,startTransition] = useTransition();
  if(forgotten)return <p role="status" className="text-xs text-ink-muted">Belief forgotten.</p>;
  return <details className="rounded-xl border border-line p-3">
    <summary className="cursor-pointer text-sm"><span className="font-medium capitalize">{label}</span>
      <span className="ml-2 text-xs text-ink-muted">{polarity === "dislike" ? "Avoid" : polarity === "like" ? "Like" : "Neutral"} · {node.category_slug}</span></summary>
    <div className="mt-3 space-y-3 text-sm">
      {domain && <p className="text-xs text-ink-muted">Setting: {domain}</p>}
      <p className="text-xs text-ink-muted">Source: {node.source.replace(/_/g," ")} · {node.evidence_count} evidence events · {Math.round(node.confidence*100)}% belief confidence</p>
      {node.last_reinforced_at && <p className="text-xs text-ink-muted">Last learned: <time dateTime={node.last_reinforced_at}>{journalDate(node.last_reinforced_at,timeZone)}</time></p>}
      <p className="text-xs text-ink-muted">Your correction takes priority over future inferred signals. Past outcome records remain in your journal.</p>
      <label className="block text-xs">Correction note (optional)
        <Input value={note} onChange={e=>setNote(e.target.value)} maxLength={300} className="mt-1" /></label>
      <div className="flex flex-wrap gap-2" role="group" aria-label={`Correct ${label}`}>
        {(["like","dislike","neutral"] as const).map(value=><Button key={value} variant="secondary" disabled={pending}
          onClick={()=>startTransition(async()=>{setMessage(null);try{
            const result=await correctBelief(node.id,value,note); if(result.error){setMessage(result.error);return;}
            setPolarity(value);setEvidence(null);setMessage("Correction saved. Refresh a comparison to use your current memory.");
          }catch{setMessage("Couldn't save your correction. Try again.");}})}>{value === "like" ? "I like this" : value === "dislike" ? "I avoid this" : "Neutral for me"}</Button>)}
      </div>
      <Button variant="ghost" disabled={pending} onClick={()=>startTransition(async()=>{try{const result=await forgetBelief(node.id);if(result.error)setMessage(result.error);else setForgotten(true);}catch{setMessage("Couldn't forget that belief. Please try again.");}})}>Forget this belief</Button>
      <Button variant="ghost" disabled={pending} onClick={()=>startTransition(async()=>{
        try { const result=await inspectEvidence(node.id);setEvidence(result.evidence);setMessage(result.error ?? null); }
        catch { setMessage("Couldn't load the evidence. Please try again."); }
      })}>View recent evidence</Button>
      {evidence && <ul className="space-y-2 border-t border-line pt-2 text-xs">{evidence.length ? evidence.map(event=>
        <li key={event.id}>{event.kind.replace(/_/g," ")} · {journalDate(event.created_at,timeZone)} · {event.kind === "manual" ? "User correction" : event.direction<0 ? "Against evidence" : "Supporting evidence"}
          {event.source_decision_id && <Link className="ml-2 text-accent underline" href={`/history?decision=${event.source_decision_id}`}>View decision</Link>}
          {event.detail && typeof event.detail === "object" && !Array.isArray(event.detail) && typeof event.detail.note === "string" && <p className="mt-1">{event.detail.note}</p>}
        </li>) : <li>No evidence recorded yet.</li>}</ul>}
      {message && <p role="status" className="text-xs text-ink-muted">{message}</p>}
    </div>
  </details>;
}
type MemoryInspectorProps = { nodes: Node[];timeZone?:string|null;memoryGeneration?:number };
export function MemoryInspector(props: MemoryInspectorProps) {
  // A privacy change invalidates local search results and any pending old read.
  return <BeliefInspector key={props.memoryGeneration ?? 0} {...props} />;
}
function BeliefInspector({ nodes,timeZone='UTC' }: MemoryInspectorProps) {
  const [query,setQuery]=useState("");const [rows,setRows]=useState(nodes);
  const [offset,setOffset]=useState(0);const [activeQuery,setActiveQuery]=useState("");
  const [error,setError]=useState<string|null>(null);const [pending,startTransition]=useTransition();
  useEffect(()=>{if(offset===0&&!activeQuery)setRows(nodes);},[nodes,offset,activeQuery]);
  function search(nextOffset=0,q=query){startTransition(async()=>{setError(null);try{
    const result=await searchMemory(q,nextOffset);if(result.error){setError(result.error);return;}
    setRows(result.nodes);setOffset(nextOffset);setActiveQuery(q);
  }catch{setError("Couldn't search your memory. Please try again.");}});}
  return <Card><h2 className="text-sm font-medium">Inspect and correct your memory</h2>
    <p className="mt-1 text-xs text-ink-muted">See where a belief came from, inspect recent evidence, or tell Nudge what is true for you now. Correcting or forgetting a belief clears saved comparison settings and explanations; your journal remains.</p>
    <form className="mt-3 space-y-2" onSubmit={e=>{e.preventDefault();search();}}><label className="block text-xs">Find a belief<Input className="mt-1" maxLength={80} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by preference or category" /></label><Button variant="secondary" type="submit" disabled={pending}>Search memory</Button></form>
    <div className="mt-3 space-y-2">{rows.map(n=><Belief key={`${n.id}-${n.polarity}`} node={n} timeZone={timeZone} />)}
      {!rows.length && <p className="text-sm text-ink-muted">No beliefs match this search.</p>}</div>
    <div className="mt-3 flex gap-2"><Button variant="ghost" disabled={pending || offset===0} onClick={()=>search(Math.max(0,offset-20),activeQuery)}>Previous</Button><Button variant="ghost" disabled={pending || rows.length<20} onClick={()=>search(offset+20,activeQuery)}>Next beliefs</Button></div>
    {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
  </Card>;
}
export function EditableMemory({ memory, saveMemory=editMemory, onSaved }: { memory: { id: string; content: string; kind: string; confidence: number }; saveMemory?: typeof editMemory; onSaved?: () => void }) {
  const [editing,setEditing]=useState(false);const [deleted,setDeleted]=useState(false);
  const [content,setContent]=useState(memory.content);const [kind,setKind]=useState(memory.kind);
  const [committed,setCommitted]=useState({content:memory.content,kind:memory.kind});
  const inFlight=useRef(false);
  const [message,setMessage]=useState<string | null>(null);const [pending,startTransition]=useTransition();
  if(deleted)return <p role="status" className="text-xs text-ink-muted">Memory deleted.</p>;
  function save(remove=false){if(inFlight.current)return;inFlight.current=true;startTransition(async()=>{setMessage(null);try{
    const result=await saveMemory(memory.id,content,kind,remove);if(result.error){setMessage(result.error);return;}
    if(remove)setDeleted(true);else{setCommitted({content:content.trim(),kind});setContent(content.trim());setEditing(false);setMessage("Memory updated.");}
    onSaved?.();
  }catch{setMessage("Couldn't update that memory. Try again.");}finally{inFlight.current=false;}});}
  return <div className="rounded-xl border border-line p-3 text-sm">
    {editing ? <div className="space-y-2"><label className="block text-xs">Memory<textarea className="mt-1 min-h-20 w-full rounded-xl border border-line bg-surface-raised p-3 text-sm" value={content} onChange={e=>setContent(e.target.value)} maxLength={300}/></label>
      <label className="block text-xs">Type<select className="ml-2 rounded-sm border border-line bg-surface-raised p-1" value={kind} onChange={e=>setKind(e.target.value)}>{["fact","goal","habit","constraint"].map(v=><option key={v}>{v}</option>)}</select></label>
      <div className="flex gap-2"><Button disabled={pending || !content.trim()} onClick={()=>save()}>Save</Button><Button variant="ghost" disabled={pending} onClick={()=>{setContent(committed.content);setKind(committed.kind);setEditing(false);setMessage(null);}}>Cancel</Button></div>
    </div> : <><span className="text-xs uppercase text-ink-muted">{committed.kind}</span><p className="mt-1">{committed.content}</p>
      <div className="mt-2 flex gap-2"><Button variant="ghost" disabled={pending} onClick={()=>setEditing(true)}>Edit</Button><Button variant="ghost" disabled={pending} onClick={()=>save(true)}>Delete memory</Button></div></>}
    {message && <p role="status" className="mt-2 text-xs text-ink-muted">{message}</p>}
  </div>;
}

type MemoryLibraryProps = { initial: StoredMemory[]; initialHasMore: boolean; memoryGeneration?:number; load?: (query?: string, offset?: number) => Promise<MemoryPage> };
export function MemoryLibrary(props: MemoryLibraryProps) {
  return <ExtractedMemoryLibrary key={props.memoryGeneration ?? 0} {...props} />;
}
function ExtractedMemoryLibrary({ initial, initialHasMore, load=loadMemories }: MemoryLibraryProps) {
  const [rows,setRows]=useState(initial),[query,setQuery]=useState(""),[activeQuery,setActiveQuery]=useState("");
  const [offset,setOffset]=useState(0),[hasMore,setHasMore]=useState(initialHasMore),[error,setError]=useState<string|null>(null);
  const [pending,start]=useTransition();const inFlight=useRef(false);const currentPage=useRef({offset:0,query:""});
  useEffect(()=>{if(currentPage.current.offset===0&&!currentPage.current.query){setRows(initial);setHasMore(initialHasMore);}},[initial,initialHasMore]);
  function search(nextOffset=0,nextQuery=query){
    if(inFlight.current)return;inFlight.current=true;
    start(async()=>{setError(null);try{
      let page=await load(nextQuery,nextOffset);
      if(page.error){setError(page.error);return;}
      // Deleting the last row on a page returns to the preceding live page.
      if(!page.memories.length&&nextOffset>0){nextOffset=Math.max(0,nextOffset-MEMORY_PAGE_SIZE);page=await load(nextQuery,nextOffset);if(page.error){setError(page.error);return;}}
      setRows(page.memories);setHasMore(page.hasMore);setOffset(nextOffset);setActiveQuery(nextQuery);currentPage.current={offset:nextOffset,query:nextQuery};
    }catch{setError("Couldn't load your memories. Please try again.");}finally{inFlight.current=false;}});
  }
  return <Card>
    <h2 className="text-sm font-medium">Memories</h2>
    <p className="mt-1 text-xs text-ink-muted">Browse, search, correct or remove extracted facts, goals, habits and constraints. These notes are separate from the preferences used to rank comparisons. Editing or deleting one clears saved comparison settings and explanations; your journal remains.</p>
    <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={event=>{event.preventDefault();search();}}>
      <label className="block flex-1 text-xs">Find an extracted memory<Input className="mt-1" value={query} onChange={event=>setQuery(event.target.value)} maxLength={80} placeholder="Search memory text" /></label>
      <Button type="submit" variant="secondary" disabled={pending}>Search memories</Button>
    </form>
    <div className="mt-3 space-y-2">{rows.map(memory=><EditableMemory key={memory.id} memory={memory} onSaved={()=>search(offset,activeQuery)} />)}</div>
    {!rows.length&&<p className="mt-3 text-sm text-ink-muted">{activeQuery?'No extracted memories match this search.':'No extracted memories yet. If you enable optional AI, you can explicitly submit notes below.'}</p>}
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button variant="ghost" disabled={pending||offset===0} onClick={()=>search(Math.max(0,offset-MEMORY_PAGE_SIZE),activeQuery)}>Previous memories</Button>
      <Button variant="ghost" disabled={pending||!hasMore} onClick={()=>search(offset+MEMORY_PAGE_SIZE,activeQuery)}>Next memories</Button>
      <Button variant="ghost" disabled={pending} onClick={()=>search(offset,activeQuery)}>Refresh memories</Button>
      <span role="status" className="text-xs text-ink-muted">{pending?'Loading memories…':rows.length?`Showing ${offset+1}–${offset+rows.length}`:'No results'}</span>
    </div>
    {error&&<p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
  </Card>;
}
