import type {SupabaseClient,User} from '@supabase/supabase-js';
import type {Database} from '@/lib/types/database';
import type {createApiAuthenticator} from './auth';
import {recentDeletionUser} from '@/lib/auth/recent-deletion-session';
type Client=SupabaseClient<Database>;
export interface AccountDependencies{
 authenticate:ReturnType<typeof createApiAuthenticator>;
 exportData:(client:Client,user:User)=>Promise<unknown>;
 deleteAccount:(id:string)=>Promise<boolean>;
 aiAvailable:boolean;policyVersion:string;minimumAge:number;now?:()=>number;
}
const headers={'Cache-Control':'private, no-store, max-age=0'};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers});
class AccountError extends Error{constructor(public status:number,public code:string,message:string){super(message);}}
function fail(status:number,code:string,message:string):never{throw new AccountError(status,code,message);}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
async function body(request:Request):Promise<Record<string,unknown>>{
 if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'invalid_request','Send this change as JSON.');
 const reader=request.body?.getReader();if(!reader)fail(400,'invalid_request','Review this change before saving.');
 let length=0,raw='';const decoder=new TextDecoder();
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>8192){await reader.cancel();fail(413,'too_large','This change is too long.');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
 try{const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();return parsed as Record<string,unknown>;}catch{fail(400,'invalid_request','Review this change before saving.');}
}
function check(error:unknown){if(error)fail(503,'unavailable','Could not finish this change. Reload your account before trying again.');}
export function createAccountHandler(deps:AccountDependencies){return async(request:Request,context:{params:Promise<{path:string[]}>})=>{
 try{
  const auth=await deps.authenticate(request);if(!auth.ok)return json({error:{code:auth.code,message:auth.message}},auth.status);
  const {client,userId}=auth,path=(await context.params).path.join('/');
  if(request.method==='GET'&&path==='profile'){
   const {data,error}=await client.from('profiles').select('full_name,country,language,occupation,timezone,ai_enabled,terms_version,memory_generation').eq('id',userId).single();check(error);if(!data)fail(404,'not_found','Account not found.');
   return json({profile:data,policyVersion:deps.policyVersion,minimumAge:deps.minimumAge,aiAvailable:deps.aiAvailable});
  }
  if(request.method==='GET'&&path==='checkins'){
   const {data,error}=await client.from('notifications').select('id,title,body,payload,read_at,created_at').eq('user_id',userId).order('created_at',{ascending:false}).limit(50);check(error);
   return json({checkins:(data??[]).map(item=>{const value=item.payload as {decision_id?:unknown}|null;return {...item,payload:value&&uuid(value.decision_id)?{decision_id:value.decision_id}:{}};})});
  }
  if(request.method==='GET'&&path==='export'){
   const identity=await client.auth.getUser(request.headers.get('authorization')?.match(/^Bearer ([^\s,]+)$/i)?.[1]);
   if(identity.error||!identity.data.user||identity.data.user.id!==userId)fail(401,'unauthenticated','Sign in again before exporting.');
   return json(await deps.exportData(client,identity.data.user));
  }
  if(request.method==='GET')return json({error:{code:'not_found',message:'This account page is unavailable.'}},404);
  const b=await body(request);if('userId'in b||'user_id'in b||'id'in b)fail(400,'invalid_request','Account identity comes from your sign-in.');
  if(path==='basics'&&request.method==='PATCH'){
   const fields={full_name:80,country:60,language:40,occupation:80},update:{full_name:string|null;country:string|null;language:string|null;occupation:string|null}={full_name:null,country:null,language:null,occupation:null};
   for(const key of Object.keys(fields)as(keyof typeof fields)[]){const value=b[key];if(value!==null&&typeof value!=='string'||typeof value==='string'&&value.length>fields[key])fail(400,'invalid_request','Check the profile fields and try again.');update[key]=typeof value==='string'?value.trim()||null:null;}
   const {data,error}=await client.from('profiles').update(update).eq('id',userId).select('full_name,country,language,occupation').single();check(error);if(!data)fail(404,'not_found','Account not found.');return json({saved:true});
  }
  if(path==='timezone'&&request.method==='POST'){
   if(typeof b.timezone!=='string'||b.timezone.length>64)fail(400,'invalid_request','Choose a valid time zone.');
   try{new Intl.DateTimeFormat('en-US',{timeZone:b.timezone});}catch{fail(400,'invalid_request','Choose a valid time zone.');}
   check((await client.rpc('set_timezone',{p_timezone:b.timezone})).error);
   const result=await client.from('profiles').select('timezone').eq('id',userId).single();check(result.error);if(result.data?.timezone!==b.timezone)fail(400,'invalid_request','This time zone is unavailable. Try UTC or a nearby city.');return json({saved:true});
  }
  if(path==='ai'&&request.method==='POST'){
   if(typeof b.enabled!=='boolean')fail(400,'invalid_request','Choose whether to use AI assistance.');
   if(b.enabled&&!deps.aiAvailable)fail(503,'unavailable','AI assistance is unavailable on this deployment.');
   const {error}=await client.rpc('set_ai_enabled',{p_enabled:b.enabled});if(error)fail(403,'needs_terms','Review the current terms before enabling AI assistance.');return json({saved:true});
  }
  if(path==='terms'&&request.method==='POST'){
   if(b.version!==deps.policyVersion||b.accepted!==true||b.eligible!==true)fail(400,'invalid_request','Read the current terms and confirm your choice.');
   check((await client.rpc('accept_legal_terms',{p_version:deps.policyVersion,p_age_eligible:true})).error);return json({saved:true});
  }
  if(path==='reset'&&request.method==='POST'){
   if(b.confirmation!=='FORGET')fail(400,'invalid_request','Type FORGET to confirm this reset.');
   check((await client.rpc('erase_learned_memory')).error);return json({saved:true});
  }
  if(path==='history'&&request.method==='DELETE'){
   if(b.confirmation!=='DELETE HISTORY')fail(400,'invalid_request','Type DELETE HISTORY to confirm.');
   check((await client.from('decisions').delete().eq('user_id',userId)).error);return json({saved:true});
  }
  if(path.startsWith('checkins/')&&request.method==='PATCH'){
   const id=path.slice(9);if(id!=='all'&&!uuid(id))fail(400,'invalid_request','This check-in is unavailable.');
   const query=client.from('notifications').update({read_at:new Date((deps.now??Date.now)()).toISOString()}).eq('user_id',userId).is('read_at',null);
   check((await(id==='all'?query:query.eq('id',id))).error);return json({saved:true});
  }
  if(path==='exit-reasons'&&request.method==='POST'){
   if(b.kind!=='pause'&&b.kind!=='delete')fail(400,'invalid_request','Choose pause or delete.');
   if(!Array.isArray(b.reasons)||b.reasons.length>10||b.reasons.some(reason=>typeof reason!=='string'||reason.length>220))fail(400,'invalid_request','Check the reasons and try again.');
   check((await client.from('account_exit_reasons').insert({user_id:userId,kind:b.kind,reasons:b.reasons as string[]})).error);
   return json({saved:true});
  }
  if(path==='delete'&&request.method==='DELETE'){
   if(b.confirmation!=='DELETE')fail(400,'invalid_request','Type DELETE to confirm.');
   const token=request.headers.get('authorization')?.match(/^Bearer ([^\s,]+)$/i)?.[1];
   const user=await recentDeletionUser(client.auth,(deps.now??Date.now)(),token);
   if(!user||user.id!==userId)fail(403,'reauthenticate','For account security, sign in with Google again, then retry deletion within 10 minutes.');
   if(!await deps.deleteAccount(user.id))fail(503,'unavailable','Could not delete your account. Try again or contact support.');return json({deleted:true});
  }
  return json({error:{code:'not_found',message:'This account action is unavailable.'}},404);
 }catch(error){if(error instanceof AccountError)return json({error:{code:error.code,message:error.message}},error.status);return json({error:{code:'unavailable',message:'Could not finish this account step. Reload before trying again.'}},503);}
};}
