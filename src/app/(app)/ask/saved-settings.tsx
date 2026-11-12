"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { DecisionCategory } from "@/lib/types";
import { unavailableComparisonSettings, type ComparisonAlias, type ComparisonSettingsState, type SavedComparisonSetting } from "@/lib/services/comparison-settings";
import { deleteComparisonSetting, loadComparisonSettings, saveComparisonSetting } from "./settings-actions";

const defaultActions = { loadComparisonSettings, saveComparisonSetting, deleteComparisonSetting };
const categories: DecisionCategory[] = ["food", "entertainment", "travel", "shopping", "lifestyle", "work", "social", "health", "career", "relationships", "finance", "hobbies", "other"];
type Editor = { id: string | null; name: string; domain: string; category: DecisionCategory; goal: string; aliases: ComparisonAlias[] };

export function SavedSettings({ initialState = unavailableComparisonSettings, domain, category, goal, onApply, onInvalidated, onPendingChange, actions = defaultActions }: {
  initialState?: ComparisonSettingsState; domain: string; category: DecisionCategory | null; goal: string;
  onApply: (setting: SavedComparisonSetting) => void; onInvalidated: () => void; onPendingChange?: (pending: boolean) => void; actions?: typeof defaultActions;
}) {
  const id = useId();
  const [state, setState] = useState(initialState);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  function clearStale() { setState(unavailableComparisonSettings); setEditor(null); onInvalidated(); }
  function run(work: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true; onPendingChange?.(true); setMessage(""); setError("");
    startTransition(async () => { try { await work(); } catch { setError("Couldn't load saved settings. Your comparison draft is still here."); } finally { busy.current = false; onPendingChange?.(false); } });
  }
  function accept(next: ComparisonSettingsState) {
    if (state.generation !== null && next.generation !== state.generation) { setEditor(null); onInvalidated(); }
    setState(next);
  }
  function reload() { run(async () => { const next = await actions.loadComparisonSettings(); accept(next); if (!next.available) setError("Saved settings are currently unavailable. You can still compare options."); }); }
  function apply(settingId: string) { run(async () => {
    // Recheck ownership, deletion and the privacy generation before using cached vocabulary.
    const current = await actions.loadComparisonSettings();
    if (!current.available) { setError("Couldn't check this saved setting. Try again, or enter the meaning yourself."); return; }
    if (current.generation !== state.generation) { clearStale(); setError("Your saved memory changed. Reload settings before applying one."); return; }
    accept(current);
    const setting = current.settings.find(value => value.id === settingId);
    if (!setting) { setEditor(null); onInvalidated(); setError("This setting was deleted. Your option drafts are still here."); return; }
    onApply(setting); setMessage(`Applied ${setting.name}. Review the setting and meanings, then confirm before comparing.`);
  }); }
  function save() { if (!editor || state.generation === null) return; run(async () => {
    const response = await actions.saveComparisonSetting({ ...editor, generation: state.generation });
    if (response.stale) { clearStale(); setError(response.error ?? "Your memory changed. Reload settings."); return; }
    if (response.error) { setError(response.error); return; }
    if (!response.state?.available) { setEditor(null); setState(unavailableComparisonSettings); setError("The setting was submitted, but the saved list couldn't be loaded. Reload before trying again."); return; }
    accept(response.state); setEditor(null); setMessage("Setting saved. Apply it explicitly when you want to use it.");
  }); }
  function remove(setting: SavedComparisonSetting) { if (state.generation === null) return; run(async () => {
    const response = await actions.deleteComparisonSetting(setting.id, state.generation!);
    if (response.stale) { clearStale(); setError(response.error ?? "Your memory changed. Reload settings."); return; }
    if (response.error) { setError(response.error); return; }
    if (response.state) accept(response.state);
    if (editor?.id === setting.id) setEditor(null);
    onInvalidated(); setMessage("Saved setting deleted. Your option drafts are still here.");
  }); }
  function edit(value: Partial<Editor>) { setEditor(previous => previous ? { ...previous, ...value } : null); }
  return <details className="group">
    <summary className="min-h-11 cursor-pointer py-3 text-sm text-ink-muted">Saved comparison settings and meanings (optional)</summary>
    <Card className="mt-3 space-y-4">
      <p className="text-sm">Reuse your own settings and definitions. You’ll review them each time.</p>
      <details><summary className="min-h-11 cursor-pointer py-3 text-xs text-ink-muted">What gets saved?</summary><p className="text-xs text-ink-muted">Only the name, setting, decision type, goal and meanings entered here. Options, measurements and journal notes are not copied. Definitions belong to this setting and are not verified facts. Forgetting learned memory clears these settings.</p></details>
      {!state.available ? <p role="status" className="text-sm text-ink-muted">Saved settings are currently unavailable. Your comparison still works.</p> : <>
        {state.settings.length === 0 && <p className="text-sm text-ink-muted">No saved settings yet.</p>}
        <ul className="space-y-3">{state.settings.map(setting => <li key={setting.id} className="rounded-xl border border-line p-3">
          <p className="break-words text-sm font-medium">{setting.name}</p><p className="break-words text-xs text-ink-muted">{setting.domain} · {setting.aliases.length} saved meanings</p>
          <div className="mt-2 flex flex-wrap gap-2"><Button variant="secondary" disabled={pending} onClick={() => apply(setting.id)} aria-label={`Apply ${setting.name}`}>Apply</Button>
            <Button variant="ghost" disabled={pending} onClick={() => { setEditor({ id: setting.id, name: setting.name, domain: setting.domain, category: setting.category, goal: setting.goal, aliases: setting.aliases.map(value => ({ ...value })) }); setError(""); setMessage(""); }} aria-label={`Edit ${setting.name}`}>Edit</Button>
            <Button variant="ghost" disabled={pending} onClick={() => remove(setting)} aria-label={`Delete ${setting.name}`}>Delete</Button></div>
        </li>)}</ul>
        {!editor && <Button variant="secondary" disabled={pending || state.settings.length >= 20} onClick={() => { setEditor({ id: null, name: "", domain, category: category ?? "other", goal, aliases: [] }); setError(""); setMessage(""); }}>Create a saved setting</Button>}
        {state.settings.length >= 20 && <p className="text-xs text-ink-muted">You have 20 settings. Edit or delete one before adding another.</p>}
      </>}
      <Button variant="ghost" disabled={pending} onClick={reload}>Reload saved settings</Button>
      {editor && <fieldset className="space-y-3" disabled={pending}>
        <legend className="text-sm font-medium">{editor.id ? "Edit saved setting" : "New saved setting"}</legend>
        <div><label htmlFor={`${id}-name`} className="text-sm">Preset name</label><Input id={`${id}-name`} value={editor.name} maxLength={80} onChange={event => edit({ name: event.target.value })} placeholder="A name you recognize" /></div>
        <div><label htmlFor={`${id}-domain`} className="text-sm">Setting for these meanings</label><Input id={`${id}-domain`} value={editor.domain} maxLength={100} onChange={event => edit({ domain: event.target.value })} placeholder="A game and version, project, sport, or Everyday life" />
          <p className="mt-1 text-xs text-ink-muted">Use a separate setting for different games, versions, projects or real life.</p></div>
        <div><label htmlFor={`${id}-category`} className="text-sm">Decision type for this setting</label><select id={`${id}-category`} className="mt-1 w-full rounded-xl border border-line bg-surface p-3 text-sm" value={editor.category} onChange={event => edit({ category: event.target.value as DecisionCategory })}>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select></div>
        <div><label htmlFor={`${id}-goal`} className="text-sm">Usual goal (optional)</label><Input id={`${id}-goal`} value={editor.goal} maxLength={300} onChange={event => edit({ goal: event.target.value })} /></div>
        {editor.aliases.map((alias, index) => <div key={index} className="space-y-2 rounded-xl border border-line p-3">
          <label htmlFor={`${id}-term-${index}`} className="block text-sm">Term {index + 1}</label><Input id={`${id}-term-${index}`} value={alias.term} maxLength={80} onChange={event => edit({ aliases: editor.aliases.map((value, position) => position === index ? { ...value, term: event.target.value } : value) })} />
          <label htmlFor={`${id}-meaning-${index}`} className="block text-sm">Your meaning for term {index + 1}</label><textarea id={`${id}-meaning-${index}`} className="w-full rounded-xl border border-line bg-surface p-3 text-sm" value={alias.meaning} maxLength={500} onChange={event => edit({ aliases: editor.aliases.map((value, position) => position === index ? { ...value, meaning: event.target.value } : value) })} />
          <Button variant="ghost" onClick={() => edit({ aliases: editor.aliases.filter((_, position) => position !== index) })}>Remove term {index + 1}</Button>
        </div>)}
        <Button variant="secondary" disabled={editor.aliases.length >= 12} onClick={() => edit({ aliases: [...editor.aliases, { term: "", meaning: "" }] })}>Add a term meaning</Button>
        <p className="text-xs text-ink-muted">An exact option label, ignoring letter case and exterior spaces, can receive its saved meaning. Other terms remain unapplied. Existing details stay for your review.</p>
        <div className="flex flex-wrap gap-2"><Button onClick={save}>{pending ? "Saving…" : "Save setting"}</Button><Button variant="ghost" onClick={() => setEditor(null)}>Cancel editing</Button></div>
      </fieldset>}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {message && <p role="status" className="text-sm text-ink-muted">{message}</p>}
    </Card>
  </details>;
}
