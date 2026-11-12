import Link from 'next/link';
import {createClient} from '@/lib/supabase/server';
import {redirect} from 'next/navigation';
import {readVerifications,readEarlierPattern} from '@/lib/discover/loaders';
import {DiscoverChecksClient} from '../discover-checks-client';
export default async function EarlierChecksPage(){
 const client=await createClient();const {data:{user}}=await client.auth.getUser();if(!user)redirect('/login');
 const [verifications,insight]=await Promise.all([readVerifications(client,user.id,20),readEarlierPattern(client,user.id)]);
 return <div className="mx-auto max-w-2xl space-y-6"><h1 className="font-display text-3xl">Check an earlier preference</h1><p className="text-ink-muted">Review what Nudge learned from earlier decisions. New questions live in Today.</p><DiscoverChecksClient key={insight?.prefKey??'no-pattern'} insight={insight} verifications={verifications}/><Link href="/dashboard" className="inline-block py-3 text-accent underline">Go to today’s question</Link></div>;
}
