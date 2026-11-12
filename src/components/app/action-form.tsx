"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
type ActionFormProps={action:(form:FormData)=>Promise<{error?:string;reloadRequired?:boolean}|void>;children:React.ReactNode;className?:string};
export function ActionForm(props:ActionFormProps){const router=useRouter();return <GuardedActionForm {...props} onSaved={()=>router.refresh()}/>;}
export function GuardedActionForm({action,children,className,onSaved}:ActionFormProps&{onSaved?:()=>void}){
 const inFlight=useRef(false),formRef=useRef<HTMLFormElement>(null),refreshed=useRef(0);
 const [state,setState]=useState<{error?:string;reloadRequired?:boolean;confirmedSaves:number}>({confirmedSaves:0});
 const [pending,startTransition]=useTransition();
 function submit(form:FormData){startTransition(async()=>{
  try{const result=await action(form)??{};if(!result.error)formRef.current?.reset();setState(previous=>({...result,confirmedSaves:previous.confirmedSaves+(result.error?0:1)}));}
  catch(error){if(error instanceof Error&&"digest" in error)throw error;setState(previous=>({error:"Couldn't confirm that change. Reload before retrying in case it was saved.",reloadRequired:true,confirmedSaves:previous.confirmedSaves}));}
  finally{inFlight.current=false;}
 });}
 // Refresh after the action state commits. A refresh queued inside the still
 // pending server action can be superseded by that action's older route patch.
 useEffect(()=>{if(state.confirmedSaves>refreshed.current){refreshed.current=state.confirmedSaves;try{onSaved?.();}catch{/* The save remains acknowledged. */}}},[state.confirmedSaves,onSaved]);
 return <form ref={formRef} method="post" onSubmit={event=>{event.preventDefault();if(inFlight.current||state.reloadRequired)return;inFlight.current=true;submit(new FormData(event.currentTarget));}} className={className} aria-busy={pending}><fieldset disabled={pending||state.reloadRequired} className="contents">{children}</fieldset>{state.error&&<p role="alert" className="w-full text-sm text-red-600">{state.error}</p>}{state.reloadRequired&&<button type="button" className="text-sm text-accent underline" onClick={()=>window.location.reload()}>Reload to check saved changes</button>}</form>;
}
