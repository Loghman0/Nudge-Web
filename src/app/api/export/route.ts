import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {buildAccountExport} from '@/lib/services/account-export';

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0" };
/** Export the caller's decision memory and account records, with explicit scope. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401, headers });
  try {
    const payload=await buildAccountExport(supabase,user);
    return new NextResponse(JSON.stringify(payload,null,2), { headers: {
      ...headers, "content-type": "application/json",
      "content-disposition": `attachment; filename="nudge-export-${new Date().toISOString().slice(0,10)}.json"`,
    } });
  } catch {
    return NextResponse.json({ error: "Couldn't create a complete export. Please try again." }, { status: 500, headers });
  }
}
