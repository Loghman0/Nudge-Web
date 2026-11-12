import {createClient as createSupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/types/database';
import {createClient} from '@/lib/supabase/server';
import {createApiAuthenticator} from './auth';
/** Account access/export/deletion and terms review stay available when terms change. */
export function accountAuthenticator(readOnly=false){
 return createApiAuthenticator({cookieClient:createClient,bearerClient:token=>createSupabaseClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${token}`}}})},{requireCurrentTerms:false,policyVersion:'',readOnly});
}
