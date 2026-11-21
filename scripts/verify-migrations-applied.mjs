// Read-only check that the approved migrations exist in the hosted database.
// Uses the service-role key from Web/.env.local; prints no secrets and writes nothing.
import {readFile} from 'node:fs/promises';
const env=await readFile(new URL('../.env.local',import.meta.url),'utf8');
const get=key=>env.split(/\r?\n/).find(line=>line.startsWith(key+'='))?.slice(key.length+1).trim();
const url=get('NEXT_PUBLIC_SUPABASE_URL'),key=get('SUPABASE_SERVICE_ROLE_KEY');
if(!url||!key){console.error('Missing Supabase URL or service-role key in .env.local');process.exit(1);}
const headers={apikey:key,Authorization:`Bearer ${key}`};
async function count(table,filter,select='question_id'){
 const response=await fetch(`${url}/rest/v1/${table}?${filter}&select=${select}`,{headers:{...headers,Prefer:'count=exact',Range:'0-0'}});
 if(!response.ok)return {error:`${response.status} ${await response.text()}`};
 return {count:response.headers.get('content-range')};
}
const editionThree=await readFile(new URL('../scripts/lib/discovery-edition-three.mjs',import.meta.url),'utf8');
const ids=[...editionThree.matchAll(/priorityChoice\('([a-z0-9-]+)'|scale\('([a-z0-9-]+)'/g)].map(m=>m[1]??m[2]);
const checks=[
 ['00023 play-humor v3',await count('discovery_question_versions','question_id=eq.play-humor&version=eq.3')],
 [`00025 edition three (${ids.length} families)`,await count('discovery_question_versions',`question_id=in.(${ids.join(',')})&version=eq.1`)],
 ['00024 account_exit_reasons',await count('account_exit_reasons','id=neq.00000000-0000-0000-0000-000000000000','id')],
];
for(const [name,result] of checks)console.log(result.error?`${name}: UNREADABLE ${result.error}`:`${name}: ${result.count}`);