import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/types/database';
import {POLICY_VERSION} from '@/lib/legal/config';
import type {DailyQuestionDelivery,FcmOutcome} from './fcm-sender';
import {isInstallationId} from './native-push-input';

export async function deliverDailyQuestions(db:SupabaseClient<Database>,send:(item:DailyQuestionDelivery)=>Promise<FcmOutcome>){
 const claims=await db.rpc('claim_native_daily_questions',{p_policy_version:POLICY_VERSION});
 // During a rolling deployment, existing check-ins keep working before the migration is present.
 if(claims.error?.code==='PGRST202')return {configured:false,accepted:0};
 if(claims.error||!Array.isArray(claims.data)||claims.data.length>10)throw Error('Daily question claim unavailable');
 let accepted=0;
 await Promise.all(claims.data.map(async claim=>{
  if(!claim||typeof claim!=='object'||Array.isArray(claim)||!isInstallationId(claim.id)||!isInstallationId(claim.claimToken))throw Error('Invalid daily question claim');
  const ids={p_id:claim.id,p_claim_token:claim.claimToken};
  const current=await db.rpc('read_native_daily_question',{...ids,p_policy_version:POLICY_VERSION});
  if(current.error)throw Error('Daily question verification unavailable');
  let retry=false;
  if(current.data!==null){
   const item=current.data;
   if(typeof item!=='object'||Array.isArray(item)||typeof item.token!=='string'||!/^[A-Za-z0-9:_.~-]{20,4096}$/.test(item.token)||!isInstallationId(item.userId)||typeof item.questionId!=='string'||!/^[a-z0-9-]{1,96}$/.test(item.questionId)||typeof item.questionVersion!=='number'||!Number.isSafeInteger(item.questionVersion)||item.questionVersion<1||typeof item.prompt!=='string'||!item.prompt||item.prompt.length>440)throw Error('Invalid daily question payload');
   const delivery=await send({kind:'daily_question',id:claim.id,token:item.token,userId:item.userId,questionId:item.questionId,questionVersion:item.questionVersion,prompt:item.prompt});
   if(delivery.outcome==='accepted')accepted++;
   retry=delivery.outcome==='retry';
  }
  const finished=await db.rpc('finish_native_daily_question',{...ids,p_retry:retry});
  if(finished.error||finished.data!==true)throw Error('Daily question acknowledgement unavailable');
 }));
 return {configured:true,accepted};
}
