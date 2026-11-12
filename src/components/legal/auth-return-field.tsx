"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {safeReturnPath} from "@/lib/auth/return-path";
/** Keep form markup stable during hydration; read the destination afterward. */
export function AuthReturnField({fallback="/dashboard"}:{fallback?:string}){
 const [next,setNext]=useState(fallback);
 useEffect(()=>{const update=()=>setNext(safeReturnPath(new URLSearchParams(window.location.search).get("next"),fallback));update();window.addEventListener("popstate",update);return ()=>window.removeEventListener("popstate",update);},[fallback]);
 return <input type="hidden" name="next" value={next}/>;
}
export function AuthSwitchLink({href,children}:{href:string;children:React.ReactNode}){
 const [target,setTarget]=useState(href);
 useEffect(()=>{const next=new URLSearchParams(window.location.search).get("next");setTarget(next?`${href}?next=${encodeURIComponent(safeReturnPath(next))}`:href);},[href]);
 return <Link href={target} className="font-medium text-ink hover:underline">{children}</Link>;
}
