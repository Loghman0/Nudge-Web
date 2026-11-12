import {timingSafeEqual} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/types/database';
import type {DailyQuestionDelivery,FcmOutcome,NativeDelivery} from './fcm-sender';
import {deliverDailyQuestions} from './native-daily-questions';
import {isInstallationId} from './native-push-input';
function delivery(v:unknown):v is NativeDelivery{
 if(!v||typeof v!=='object')return false;const r=v as Record<string,unknown>;
 return ['delivery_id','claim_token','notification_id','device_id','recipient_user_id','decision_id'].every(k=>isInstallationId(r[k]))&&Number.isInteger(r.device_revision)&&Number(r.device_revision)>0&&typeof r.token==='string'&&r.token.length>=20&&r.token.length<=4096&&/^[A-Za-z0-9:_.~-]+$/.test(r.token);
}
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export function createNativePushWorker(deps:{db:SupabaseClient<Database>|null;secret:string|undefined;send:((item:NativeDelivery)=>Promise<FcmOutcome>)|null;sendDaily?:(item:DailyQuestionDelivery)=>Promise<FcmOutcome>}){
 return async(request:Request)=>{
  if(!deps.secret||deps.secret.length<32||deps.secret.length>256||!deps.db)return reply({ok:false,stage:'configuration'},503);
  const supplied=Buffer.from(request.headers.get('x-nudge-cron-secret')??''),expected=Buffer.from(deps.secret);
  if(request.method!=='POST'||supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return reply({ok:false,error:'Not authorized'},401);
  const db=deps.db;
  try{
   const queued=await db.rpc('enqueue_due_reflection_prompts');if(queued.error||!Number.isSafeInteger(queued.data)||queued.data<0)return reply({ok:false,stage:'enqueue'},503);
   if(!deps.send)return reply({ok:true,enqueued:queued.data,nativeTransport:false,accepted:0});
   const daily=deps.sendDaily?deliverDailyQuestions(db,deps.sendDaily).catch(()=>({configured:true,accepted:0,error:true})):null;
   const claimed=await db.rpc('claim_native_push_deliveries',{p_limit:25});
   if(claimed.error||!Array.isArray(claimed.data)||claimed.data.length>25||!claimed.data.every(delivery))return reply({ok:false,stage:'claim'},503);
   let accepted=0,retried=0,gone=0,failed=0,expired=0,acknowledgementsFailed=0;
   async function send(item:NativeDelivery){
    let result:{outcome:FcmOutcome['outcome']|'expired';status:number|null}={outcome:'retry',status:null};
    try{
     const current=await db.rpc('native_push_delivery_current',{p_delivery_id:item.delivery_id,p_claim_token:item.claim_token});
     if(!current.error&&current.data===false)result={outcome:'expired',status:null};
     else if(!current.error&&current.data===true)result=await deps.send!(item);
    }catch{/* A bounded durable retry handles transient database/provider errors. */}
    if(result.outcome==='accepted')accepted++;else if(result.outcome==='gone')gone++;else if(result.outcome==='failed')failed++;else if(result.outcome==='expired')expired++;else retried++;
    try{const ack=await db.rpc('finish_native_push_delivery',{p_delivery_id:item.delivery_id,p_claim_token:item.claim_token,p_outcome:result.outcome,p_status:result.status});if(ack.error||ack.data!==true)acknowledgementsFailed++;}catch{acknowledgementsFailed++;}
   }
   for(let at=0;at<claimed.data.length;at+=5)await Promise.all(claimed.data.slice(at,at+5).map(send));
   const dailyQuestions=await daily;
   const ok=acknowledgementsFailed===0&&!(dailyQuestions&&'error' in dailyQuestions);
   return reply({ok,enqueued:queued.data,nativeTransport:true,claimed:claimed.data.length,accepted,retried,gone,failed,expired,acknowledgementsFailed,...(dailyQuestions?{dailyQuestions}:{})},ok?200:503);
  }catch{return reply({ok:false,stage:'worker'},503);}
 };
}
