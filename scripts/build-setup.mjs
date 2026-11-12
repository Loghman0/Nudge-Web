import { readFile,writeFile,readdir } from 'node:fs/promises';
const root = new URL('../supabase/',import.meta.url);
const names=(await readdir(new URL('migrations/',root))).filter(n=>n.endsWith('.sql')).sort();
const parts=await Promise.all(names.map(n=>readFile(new URL(`migrations/${n}`,root),'utf8')));
const destination=new URL('nudge_complete_setup.sql',root);
const expected=
  '-- GENERATED FROM migrations/. FRESH DATABASE ONLY. Do not rerun over an existing installation.\n'+
  '-- Existing installations: apply only missing migrations in order. See README; never rerun the baseline.\n\n'+parts.join('\n\n');
if(process.argv.includes('--check')) {
  const actual=await readFile(destination,'utf8').catch(()=>null);
  if(actual!==expected){console.error('Generated supabase/nudge_complete_setup.sql is stale. Run node scripts/build-setup.mjs.');process.exitCode=1;}
  else console.log('supabase/nudge_complete_setup.sql is current.');
} else await writeFile(destination,expected);
