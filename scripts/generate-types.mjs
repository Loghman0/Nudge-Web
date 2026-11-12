import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const id=process.env.SUPABASE_PROJECT_ID;
if(!id||!/^[a-z0-9]{8,40}$/.test(id))throw new Error('Set SUPABASE_PROJECT_ID to the intended project reference before generating types.');
// Explicit CLI installation avoids an implicit unpinned download. A failed
// command must never truncate the checked-in contract.
const result=spawnSync('supabase',['gen','types','typescript','--project-id',id,'--schema','public'],{encoding:'utf8',shell:false});
if(result.error)throw new Error('Install the Supabase CLI, then retry. Existing database types were not changed.');
if(result.status!==0||!result.stdout?.includes('export type'))throw new Error('Type generation failed. Existing database types were not changed.');
await writeFile(new URL('../src/lib/types/database.ts',import.meta.url),result.stdout);
console.log('Generated database contract successfully.');
