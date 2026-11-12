import {readFile,readdir,lstat,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {createSourceArchive,inspectSourceArchive} from './release-archive.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const directories=['src','public','licenses','scripts','sql','data','docs','supabase/migrations','supabase/functions','.github'];
const files=['.env.example','staging.env.example','.gitignore','.node-version','package.json','package-lock.json','next.config.ts','next-env.d.ts','postcss.config.mjs','tailwind.config.ts','tsconfig.json','tsconfig.tests.json','playwright.config.ts','supabase/config.toml','supabase/nudge_complete_setup.sql','README.md','THIRD_PARTY_NOTICES.md'];
const entries=[];
async function add(name) {
  if(name==='docs/reference')return;
  const file=path.join(root,name);let stat;try{stat=await lstat(file);}catch(error){if(error.code==='ENOENT'&&name==='.github')return;throw error;}
  if(stat.isSymbolicLink())throw new Error('Release cannot contain symlinks: '+name);
  if(stat.isDirectory()){for(const child of (await readdir(file)).sort())await add(name+'/'+child);return;}
  entries.push({name,data:await readFile(file)});
}
// Tests ship with source so reviewers can reproduce the advertised checks.
for(const name of [...files,...directories,'tests','e2e'])await add(name);
const local=await readFile(path.join(root,'.env.local'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
const settings=[...Object.entries(process.env),...Object.entries(parseEnv(local))];
const privateValues=settings.filter(([name,value])=>!name.startsWith('NEXT_PUBLIC_')&&/(?:API_KEY|SERVICE_ROLE|PRIVATE_KEY|SECRET|PASSWORD)/.test(name)&&typeof value==='string'&&value.length>=12).map(([,value])=>value);
const archive=createSourceArchive(entries,privateValues);const names=inspectSourceArchive(archive);
if(!names.includes('package.json')||!names.some(name=>name.startsWith('src/'))||!names.some(name=>name.startsWith('tests/')))throw new Error('Required source/test files are missing from the package.');
await mkdir(path.join(root,'release'),{recursive:true});
await writeFile(path.join(root,'release/nudge-source.zip'),archive);
console.log('Created release/nudge-source.zip ('+names.length+' allowlisted files); final archive inspection passed. No private configuration included.');
