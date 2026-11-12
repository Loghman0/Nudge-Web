"use server";
import {createClient} from '@/lib/supabase/server';
import {generateOwnerRecap,type RecapResult} from '@/lib/services/monthly-recap';
export type {RecapResult} from '@/lib/services/monthly-recap';
export async function generateMonthlyRecap():Promise<RecapResult>{
 const db=await createClient();const {data:{user}}=await db.auth.getUser();
 if(!user)return {text:null,reason:'failed'};
 return generateOwnerRecap(db,user.id);
}
