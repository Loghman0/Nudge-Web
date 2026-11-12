"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isRequestId } from "@/lib/services/comparison-input";
const genericFailure="Couldn't save that change. Please try again.";
function message(error:{code?:string;message?:string}){
 if(error.code==="PGRST202"||error.code==="42883")return "Circles need the public-launch database update. Apply the supplied SQL, then reload.";
 const allowed=["This invitation is no longer valid","This circle is full","Poll options must be distinct","You can own up to 20 circles","Close an existing vote before opening another","This vote is closed or unavailable","You cannot close this vote","Owners must delete the circle instead of leaving","Circle not found"];
 return error.code==="P0001"&&allowed.includes(error.message??"")?error.message!:genericFailure;
}
function creationFailure(error:{code?:string;message?:string},uncertain:string){const known=message(error);return known===genericFailure?{error:uncertain,reloadRequired:true}:{error:known};}
export async function createDecisionCircle(form:FormData){
 const raw=form.get("name"),name=typeof raw==="string"?raw.trim():"";if(!name||name.length>80)return {error:"Enter a name of 1 to 80 characters."};
 const uncertain="Couldn't confirm whether the circle was created. Reload Circles before trying again to avoid a duplicate.";
 let db:Awaited<ReturnType<typeof createClient>>;
 try{db=await createClient();const {data,error}=await db.rpc("create_circle",{p_name:name});if(error)return creationFailure(error,uncertain);if(!isRequestId(data))return {error:uncertain,reloadRequired:true};}
 catch{return {error:uncertain,reloadRequired:true};}
 try{await db.rpc("evaluate_achievements");}catch{/* The circle is already created. */}revalidatePath("/groups");return {};
}
export async function joinDecisionCircle(form:FormData){
 const code=String(form.get("code")??"").trim();const db=await createClient();
 const {data,error}=await db.rpc("join_decision_circle",{code});if(error||!data)return {error:error?message(error):"This invitation is no longer valid."};
 revalidatePath("/groups");redirect(`/groups/${data}`);
}
export async function leaveCircle(groupId:string){const db=await createClient();const {error}=await db.rpc("manage_circle",{p_group_id:groupId,p_action:"leave"});if(error)return {error:message(error)};revalidatePath("/groups");redirect("/groups");}
export async function createPoll(groupId:string,form:FormData){
 const rawQuestion=form.get("question"),rawOptions=[1,2,3,4,5].map(i=>form.get(`option_${i}`));
 if(typeof rawQuestion!=="string"||rawOptions.some(value=>value!==null&&typeof value!=="string"))return {error:"Add a question and two to five short options."};
 const question=rawQuestion.trim(),options=rawOptions.map(value=>typeof value==="string"?value.trim():"").filter(Boolean);
 if(!question||question.length>200||options.length<2||options.some(v=>v.length>100))return {error:"Add a question and two to five short options."};
 if(new Set(options.map(v=>v.toLowerCase())).size!==options.length)return {error:"Poll options must be distinct."};
 const uncertain="Couldn't confirm whether the vote was opened. Reload this circle before trying again to avoid a duplicate.";
 let db:Awaited<ReturnType<typeof createClient>>;
 try{db=await createClient();const {data,error}=await db.rpc("create_circle_poll",{p_group_id:groupId,p_question:question,p_options:options});if(error)return creationFailure(error,uncertain);if(!isRequestId(data))return {error:uncertain,reloadRequired:true};}
 catch{return {error:uncertain,reloadRequired:true};}
 try{await db.rpc("evaluate_achievements");}catch{/* The vote is already open. */}revalidatePath(`/groups/${groupId}`);return {};
}
export async function votePoll(groupId:string,pollId:string,optionId:string){const db=await createClient();const {error}=await db.rpc("cast_circle_vote",{p_poll_id:pollId,p_option_id:optionId});if(error)return {error:message(error)};revalidatePath(`/groups/${groupId}`);return {};}
export async function closePoll(groupId:string,pollId:string){const db=await createClient();const {error}=await db.rpc("close_circle_poll",{p_group_id:groupId,p_poll_id:pollId});if(error)return {error:message(error)};revalidatePath(`/groups/${groupId}`);return {};}
export async function rotateCircleInvite(groupId:string){const db=await createClient();const {error}=await db.rpc("manage_circle",{p_group_id:groupId,p_action:"rotate_invite"});if(error)return {error:message(error)};revalidatePath(`/groups/${groupId}`);revalidatePath("/groups");return {};}
export async function deleteCircle(groupId:string,form:FormData){if(form.get("confirmation")!=="DELETE")return {error:"Type DELETE to remove this circle and its shared polls."};const db=await createClient();const {error}=await db.rpc("manage_circle",{p_group_id:groupId,p_action:"delete"});if(error)return {error:message(error)};revalidatePath("/groups");redirect("/groups");}
