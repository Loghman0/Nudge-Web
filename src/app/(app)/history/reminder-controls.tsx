"use client";
import { useEffect,useRef,useState,useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { scheduleReflection } from "./reminder-actions";
import { journalDate } from "@/lib/services/calendar";
import { resolveLocalReminderTime } from "@/lib/services/reminder-local-time";
export function ReminderControls({decisionId,dueAt,enabled=true,link=true,saveAction=scheduleReflection}:{decisionId:string;dueAt?:string|null;enabled?:boolean;link?:boolean;saveAction?:typeof scheduleReflection}) {
  const [date,setDate]=useState("");const [message,setMessage]=useState<string|null>(null);
  const [pending,startTransition]=useTransition();const [active,setActive]=useState(enabled);
  const [due,setDue]=useState(dueAt);
  const inFlight=useRef(false);
  const [deviceZone,setDeviceZone]=useState('UTC');
  useEffect(()=>setDeviceZone(Intl.DateTimeFormat().resolvedOptions().timeZone),[]);
  useEffect(()=>{setDue(dueAt);setActive(enabled);},[decisionId,dueAt,enabled]);
  function save(value:string|null,on=true){if(inFlight.current)return;inFlight.current=true;startTransition(async()=>{
    setMessage(null);try{const result=await saveAction(decisionId,value,on);if(result.error){setMessage(result.error);return;}
      setDue(result.reminder?result.reminder.dueAt:value);setActive(result.reminder?.enabled??on);setMessage(on?"Check-in scheduled. It will appear when it is due.":"Check-ins turned off for this decision.");
    }catch{setMessage("Couldn't save the reminder. Please try again.");}finally{inFlight.current=false;}
  });}
  return <div className="mt-3 space-y-2 rounded-xl border border-line p-3">
    <p className="text-sm font-medium">When should Nudge check in?</p>
    <p className="text-xs text-ink-muted">{active ? due ? `Scheduled for ${journalDate(due,deviceZone,true)}` : "Tomorrow by default" : "Reminders are off"}</p>
    <div className="flex flex-wrap gap-2">
      {link && <Link href={`/history?decision=${decisionId}`}><Button variant="secondary">Reflect now</Button></Link>}
      <Button variant="secondary" disabled={pending} onClick={()=>save(new Date(Date.now()+86400000).toISOString())}>Tomorrow</Button>
      <Button variant="secondary" disabled={pending} onClick={()=>save(new Date(Date.now()+7*86400000).toISOString())}>In a week</Button>
      <Button variant="ghost" disabled={pending} onClick={()=>save(null,false)}>Turn off</Button>
    </div>
    <label className="block text-xs">Custom time (your device timezone)
      <Input type="datetime-local" className="mt-1" value={date} disabled={pending} onChange={e=>setDate(e.target.value)} /></label>
    <Button variant="secondary" disabled={pending || !date} onClick={()=>{const resolved=resolveLocalReminderTime(date);if(!resolved.value){setMessage(resolved.error??"Choose a valid date.");return;}save(resolved.value);}}>Set custom check-in</Button>
    {message && <p role="status" className="text-xs text-ink-muted">{message}</p>}
  </div>;
}
