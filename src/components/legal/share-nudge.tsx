"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
export function ShareNudge(){
  const [message,setMessage]=useState("");
  async function share(){try{
    const url=new URL("/",window.location.origin).href;
    if(navigator.share)await navigator.share({title:"Nudge",text:"Remember your decisions. Make better ones.",url});
    else{await navigator.clipboard.writeText(url);setMessage("Nudge link copied.");}
  }catch(error){if(!(error instanceof Error && error.name==="AbortError"))setMessage("Copy the app's address from your browser to share Nudge.");}}
  return <span><Button variant="ghost" onClick={share}>Share Nudge</Button>{message&&<span role="status" className="ml-2 text-xs text-ink-muted">{message}</span>}</span>;
}
