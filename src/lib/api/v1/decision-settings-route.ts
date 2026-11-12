import type {createApiAuthenticator} from './auth';
import {decodeComparisonSettingsState,parseComparisonSetting} from '@/lib/services/comparison-settings';
type Auth=ReturnType<typeof createApiAuthenticator>;
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers});
class SettingsError extends Error{constructor(public status:number,public code:string,message:string){super(message);}}
const fail=(status:number,code:string,message:string):never=>{throw new SettingsError(status,code,message);};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const generation=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
function check(error:{code?:string;message?:string}|null){
 if(!error)return;
 if(/generation|stale|memory changed|no longer exists/i.test(error.message??''))fail(409,'changed','Your memory or saved setting changed. Reload before making another change.');
 if(error.code==='23505'||/up to 20|duplicate|unique/i.test(error.message??''))fail(409,'limit','Use a unique name within this setting and keep at most 20 saved settings.');
 fail(503,'unavailable','Could not confirm this change. Reload your saved settings before trying again.');
}
async function body(request:Request){
 if(request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')fail(415,'invalid_request','Send this change as JSON.');
 const reader=request.body?.getReader();if(!reader)fail(400,'invalid_request','Review the saved setting before continuing.');
 let length=0;const chunks:Uint8Array[]=[];
 try{while(true){const part=await reader!.read();if(part.done)break;length+=part.value.length;if(length>65536){await reader!.cancel();fail(413,'too_large','This saved setting is too long.');}chunks.push(part.value);}}finally{reader!.releaseLock();}
 try{const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value as Record<string,unknown>;}catch{fail(400,'invalid_request','Review the saved setting before continuing.');}
}
/** Owner identity is supplied only by the verified cookie/bearer session. */
export function createDecisionSettingsHandler(authenticate:Auth){return async(request:Request)=>{
 try{
  const identity=await authenticate(request);if(!identity.ok)return reply({error:{code:identity.code,message:identity.message}},identity.status);
  const db=identity.client;
  if(request.method==='GET'){
   const query=new URL(request.url).searchParams;
   if([...query.keys()].some(key=>!['id','generation'].includes(key)||query.getAll(key).length!==1))fail(400,'invalid_request','Choose a valid saved setting.');
   const id=query.get('id'),expected=query.get('generation');
   if((id===null)!==(expected===null)||id!==null&&(!uuid(id)||!/^\d{1,10}$/.test(expected!)||!generation(Number(expected))))fail(400,'invalid_request','Reload saved settings before applying one.');
   const result=await db.rpc('get_comparison_settings_state');check(result.error);
   const state=decodeComparisonSettingsState(result.data);if(!state)fail(503,'unavailable','Could not load saved settings. Try reloading.');
   if(id!==null){
    if(state!.generation!==Number(expected))fail(409,'changed','Your memory changed. Reload saved settings before applying one.');
    const setting=state!.settings.find(row=>row.id===id);if(!setting)fail(404,'not_found','This saved setting is no longer available.');
    return reply({setting,generation:state!.generation});
   }
   return reply({state});
  }
  if(!['POST','DELETE'].includes(request.method))return reply({error:{code:'method_not_allowed',message:'Use the displayed saved-setting action.'}},405);
  const input=await body(request);
  if(request.method==='POST'){
   const parsed=parseComparisonSetting(input);if(!parsed.value)fail(400,'invalid_request',parsed.error??'Review this setting.');
   const value=parsed.value!;
   const {data,error}=await db.rpc('save_comparison_setting',{p_id:value.id,p_name:value.name,p_domain:value.domain,p_category:value.category,p_goal:value.goal,p_aliases:value.aliases.map(alias=>({...alias})),p_generation:value.generation});check(error);
   if(!uuid(data))fail(503,'unavailable','Could not confirm whether this setting saved. Reload before creating another.');
   return reply({saved:true,id:data});
  }
  if(Object.keys(input!).some(key=>!['id','generation'].includes(key))||!uuid(input!.id)||!generation(input!.generation))fail(400,'invalid_request','Reload saved settings before deleting.');
  check((await db.rpc('delete_comparison_setting',{p_id:input!.id as string,p_generation:input!.generation as number})).error);
  return reply({saved:true});
 }catch(error){if(error instanceof SettingsError)return reply({error:{code:error.code,message:error.message}},error.status);return reply({error:{code:'unavailable',message:'Could not finish this step. Reload saved settings before trying again.'}},503);}
};}
