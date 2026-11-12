import {createClient} from '@supabase/supabase-js';
import {accountAuthenticator} from '@/lib/api/v1/account-auth';
import {createAccountHandler} from '@/lib/api/v1/account-handler';
import {buildAccountExport} from '@/lib/services/account-export';
import {getAi} from '@/lib/services/ai';
import {readAiAccountingConfig} from '@/lib/services/ai/accounting-config';
import {POLICY_VERSION,MINIMUM_AGE} from '@/lib/legal/config';
export const dynamic='force-dynamic';
const dependencies={exportData:buildAccountExport,policyVersion:POLICY_VERSION,minimumAge:MINIMUM_AGE,
 aiAvailable:getAi()!==null&&readAiAccountingConfig()!==null&&!(process.env.NUDGE_AI_DEVELOPMENT_FREE==='true'&&process.env.NUDGE_PUBLIC_LAUNCH==='true'),
 deleteAccount:async(id:string)=>{
  if(!process.env.SUPABASE_SERVICE_ROLE_KEY)return false;
  const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  return !(await admin.auth.admin.deleteUser(id,false)).error;
 }};
export const GET=createAccountHandler({...dependencies,authenticate:accountAuthenticator(true)});
export const POST=createAccountHandler({...dependencies,authenticate:accountAuthenticator()});
export const PATCH=POST;
export const DELETE=POST;
