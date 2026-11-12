"use client";

import { useId } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ComparisonCriterion, CriterionValue } from "@/lib/services/comparison-criteria";

export function CriteriaEditor({labels, criteria, confirmed, onChange, onConfirm}: {
  labels:string[]; criteria:ComparisonCriterion[]; confirmed:boolean;
  onChange:(value:ComparisonCriterion[])=>void; onConfirm:(value:boolean)=>void;
}) {
  const prefix=useId();
  const numberValue=(value:number)=>Number.isFinite(value)?value:"";
  function update(id:string, patch:Partial<ComparisonCriterion>){onChange(criteria.map(c=>c.id===id?{...c,...patch,...(patch.label!==undefined?{discoverySuggestion:undefined}:{})}:c));}
  function cell(c:ComparisonCriterion,label:string,patch:Partial<CriterionValue>){update(c.id,{values:{...c.values,[label]:{...(Object.hasOwn(c.values,label)?c.values[label]:{value:null}),...patch}}});}
  return <Card className="space-y-5" aria-label="Your comparison criteria">
    <div><h2 className="text-lg font-medium">Your comparison criteria</h2>
      <p className="mt-1 text-sm text-ink-muted">What matters to this choice? Add a measurement, its range and each option’s value. Leave unknown values blank.</p>
      <details><summary className="min-h-11 cursor-pointer py-3 text-xs text-ink-muted">About values and sources</summary><p className="text-xs text-ink-muted">Source links and notes are saved for review; Nudge does not open links or verify their claims. Include the applicable version, date or rules. Every value must fit the range you set.</p></details></div>
    {criteria.map((c,index)=><fieldset key={c.id} className="space-y-3 rounded-xl border border-line p-3">
      <legend className="px-1 text-sm font-medium">Criterion {index+1}</legend>
      <label className="block text-sm">Name<Input value={c.label} maxLength={100} onChange={e=>update(c.id,{label:e.target.value})} placeholder="e.g. Time needed" /></label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm">Unit<Input value={c.unit} maxLength={40} onChange={e=>update(c.id,{unit:e.target.value})} placeholder="e.g. minutes" /></label>
        <label className="text-sm">Better value<select className="mt-1 w-full rounded-xl border border-line bg-surface p-3" value={c.direction} onChange={e=>update(c.id,{direction:e.target.value as "higher"|"lower"})}><option value="higher">Higher</option><option value="lower">Lower</option></select></label>
        <label className="text-sm">Lowest possible<Input type="number" step="any" value={numberValue(c.low)} onChange={e=>update(c.id,{low:e.target.value===""?NaN:Number(e.target.value)})} /></label>
        <label className="text-sm">Highest possible<Input type="number" step="any" value={numberValue(c.high)} onChange={e=>update(c.id,{high:e.target.value===""?NaN:Number(e.target.value)})} /></label>
        <label className="text-sm">Importance (1–5)<Input type="number" min={1} max={5} step={1} value={numberValue(c.weight)} onChange={e=>update(c.id,{weight:e.target.value===""?NaN:Number(e.target.value)})} /></label>
      </div>
      {labels.map((label,optionIndex)=>{const value=Object.hasOwn(c.values,label)?c.values[label]:{value:null};return <div key={label} className="space-y-2 border-t border-line pt-3">
        <label className="block text-sm" htmlFor={`${prefix}-${index}-${optionIndex}-value`}>{label}: value</label>
        <Input id={`${prefix}-${index}-${optionIndex}-value`} type="number" step="any" value={value.value==null?"":numberValue(value.value)} placeholder="Unknown" onChange={e=>cell(c,label,{value:e.target.value===""?null:Number(e.target.value)})} />
        <label className="block text-sm">{label}: source link (optional)<Input type="url" maxLength={2048} value={value.sourceUrl??""} placeholder="https://…" onChange={e=>cell(c,label,{sourceUrl:e.target.value})} /></label>
        <label className="block text-sm">{label}: evidence or version note (optional)<textarea className="mt-1 w-full rounded-xl border border-line bg-surface p-3 text-sm" maxLength={500} value={value.note??""} onChange={e=>cell(c,label,{note:e.target.value})} /></label>
      </div>;})}
      <Button variant="ghost" onClick={()=>onChange(criteria.filter(row=>row.id!==c.id))}>Remove criterion {index+1}</Button>
    </fieldset>)}
    <Button variant="secondary" disabled={criteria.length>=5} onClick={()=>onChange([...criteria,{id:crypto.randomUUID(),label:"",unit:"",weight:1,direction:"higher",low:0,high:100,values:{}}])}>Add criterion</Button>
    <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={confirmed} onChange={e=>onConfirm(e.target.checked)} />I reviewed these values, ranges and sources. Use them as my comparison inputs.</label>
    <details><summary className="min-h-11 cursor-pointer py-3 text-xs text-ink-muted">How scores handle uncertainty</summary><p className="text-xs text-ink-muted">Scores use weighted ranges, with lower values reversed when lower is better. Unknowns span the full range. A leader is shown only if its lowest score exceeds every other option’s highest score.</p></details>
  </Card>;
}
