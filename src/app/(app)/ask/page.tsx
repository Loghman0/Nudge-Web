import { notFound } from "next/navigation";
import { SerializedDecideClient } from "./decide-client";
import { loadComparison,loadComparisonSeed } from "./actions";
import { loadComparisonSettings } from "./settings-actions";
export default async function DecidePage({searchParams}:{searchParams:Promise<{a?:string;b?:string;resume?:string;copy?:string;basis?:string}>}) {
  const {a,b,resume,copy,basis}=await searchParams;
  const id=resume??copy;
  if(id && !/^[0-9a-f-]{36}$/i.test(id))notFound();
  const result=resume?await loadComparison(resume):null;
  const loadedSeed=copy?await loadComparisonSeed(copy):null;
  const seed=loadedSeed&&basis==="criteria"?{...loadedSeed,context:{...loadedSeed.context,comparisonBasis:"criteria" as const}}:loadedSeed;
  if((resume&&!result)||(copy&&!seed))notFound();
  const initial=seed?.options??[a,b].filter((v):v is string=>Boolean(v?.trim()));
  const initialSettings=await loadComparisonSettings();
  return <div className="mx-auto max-w-2xl"><SerializedDecideClient key={resume?`resume:${resume}`:copy?`copy:${copy}:${basis??"journal"}`:"new"} initialOptions={initial} resultJson={JSON.stringify(result)} seedJson={JSON.stringify(seed)} initialSettings={initialSettings}/></div>;
}
