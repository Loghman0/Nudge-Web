import {createClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/types/database';
import {createFcmSender,readFcmConfiguration} from '@/lib/services/fcm-sender';
import {createNativePushWorker} from '@/lib/services/native-push-worker';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request){
 const env=process.env,config=readFcmConfiguration(env);
 const db=env.NEXT_PUBLIC_SUPABASE_URL&&env.SUPABASE_SERVICE_ROLE_KEY?createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(5000)})}}):null;
 const send=config?createFcmSender(config):null;
 return createNativePushWorker({db,secret:env.CHECKINS_CRON_SECRET,send,sendDaily:send??undefined})(request);
}
