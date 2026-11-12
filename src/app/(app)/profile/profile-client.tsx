"use client";

import { useEffect,useRef,useState, useTransition } from "react";
import { Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deleteDecisionHistory, eraseLearnedMemory, removePreference, updateBasics,
} from "./actions";

type BasicsProfile={full_name:string|null;country:string|null;language:string|null;occupation:string|null};
export function EditableBasics({
  profile,saveAction=updateBasics,
}: {
  profile: BasicsProfile;
  saveAction?:(data:FormData)=>Promise<{error?:string;profile?:BasicsProfile}>;
}) {
  const [editing, setEditing] = useState(false);
  const [error,setError]=useState<string|null>(null);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const [saved,setSaved]=useState(profile);
  const [draft,setDraft]=useState(profile);
  const {full_name,country,language,occupation}=profile;
  useEffect(()=>setSaved({full_name,country,language,occupation}),[full_name,country,language,occupation]);

  if (!editing) {
    return (
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Basics</h2>
          <button onClick={() => {setError(null);setDraft(saved);setEditing(true);}}
            className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink">
            <Pencil size={12} /> Edit
          </button>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          {([["Name", saved.full_name], ["Country", saved.country], ["Language", saved.language], ["Occupation", saved.occupation]] as const).map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-ink-faint">{k}</dt>
              <dd className="mt-0.5">{v ?? <span className="text-ink-faint">—</span>}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  return (
    <form
      action={(formData) => startTransition(async () => {
        if(inFlight.current)return;
        inFlight.current=true;
        setError(null);
        try{
          const result=await saveAction(formData);
          if(result.error||!result.profile){setError(result.error??"Couldn’t verify your saved profile. Please try again.");return;}
          setSaved(result.profile);setEditing(false);
        }
        catch{setError("Couldn’t save your profile. Please try again.");}
        finally{inFlight.current=false;}
      })}
      className="space-y-3"
    >
      <h2 className="text-sm font-medium">Basics</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {([['full_name','Name'],['country','Country'],['language','Language'],['occupation','Occupation']] as const).map(([name,label]) => (
          <label key={name} className="space-y-1 text-xs text-ink-muted">
            <span className="block">{label}</span>
            <Input name={name} value={draft[name] ?? ""} placeholder={label} disabled={pending} onChange={event=>{
              const value=event.target.value;setDraft(current=>({...current,[name]:value}));
            }} />
          </label>
        ))}
      </div>
      {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </form>
  );
}

export function RemovablePreference({
  id, label, strength, liked, removeAction=removePreference,
}: { id: string; label: string; strength?: number; liked: boolean; removeAction?:typeof removePreference }) {
  const [pending, startTransition] = useTransition();
  const inFlight=useRef(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className={`group inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs capitalize ${
      liked ? "border-accent/30 bg-accent-soft/50" : "border-line text-ink-muted"
    } ${pending ? "opacity-40" : ""}`}>
      {label}{liked && strength !== undefined ? ` · ${Math.round(strength * 100)}%` : ""}
      <button
        aria-label={`Forget ${label}`}
        disabled={pending}
        onClick={() => startTransition(async () => {
          if(inFlight.current)return;
          inFlight.current=true;setError(null);
          try {
            const result = await removeAction(id);
            setError(result?.error ?? null);
          } catch { setError("Couldn't forget that preference. Please try again."); }
          finally { inFlight.current=false; }
        })}
        className="text-ink-faint transition-opacity hover:text-ink md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
      >
        <X size={12} />
      </button>
      {error && <span role="alert" className="text-red-600">{error}</span>}
    </span>
  );
}

export function DangerZone() {
  const [pending, startTransition] = useTransition();

  const [error, setError] = useState<string | null>(null);
  function confirmAnd(message: string, action: () => Promise<{ error?: string } | void>) {
    if (window.confirm(message)) startTransition(async () => {
      setError(null);
      try { const result = await action(); setError(result?.error ?? null); }
      catch { setError("Couldn't complete that action. Please try again."); }
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <a href="/api/export" download
        className="inline-flex h-9 items-center rounded-full border border-line px-4 text-xs font-medium text-ink-muted transition-colors hover:text-ink">
        Download my data (JSON)
      </a>
      <button
        disabled={pending}
        onClick={() => confirmAnd("Erase everything Nudge has learned about you? Your decisions stay as a journal but will no longer influence recommendations. Preferences, evidence, answers, extracted memories, saved comparison settings and explanations are erased. This cannot be undone.", eraseLearnedMemory)}
        className="inline-flex min-h-11 items-center rounded-full border border-red-500/30 px-4 text-xs font-medium text-red-700 dark:text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50">
        Erase learned memory
      </button>
      <button
        disabled={pending}
        onClick={() => confirmAnd("Delete your entire decision history, including reflections and saved explanations? Learned preferences and saved comparison settings remain; use Erase learned memory to clear those too. This cannot be undone.", deleteDecisionHistory)}
        className="inline-flex min-h-11 items-center rounded-full border border-red-500/30 px-4 text-xs font-medium text-red-700 dark:text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50">
        Delete decision history
      </button>
      {error && <p role="alert" className="w-full text-sm text-red-600">{error}</p>}
    </div>
  );
}

