// Applies one staged migration file to the hosted database over a direct
// Postgres connection. The connection string is read from Web/.env.local
// (SUPABASE_DB_URL) and never printed. Owner must place it there themselves.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

const root=new URL('../',import.meta.url);
const names=process.argv.slice(2);
if(!names.length){console.error('Usage: node scripts/apply-migration.mjs <migration-file.sql> [...]');process.exit(1);}
const env=await readFile(new URL('.env.local',root),'utf8');
const url=env.split(/\r?\n/).find(line=>line.startsWith('SUPABASE_DB_URL='))?.slice('SUPABASE_DB_URL='.length).trim().replace(/^["']|["']$/g,'');
if(!url){console.error('SUPABASE_DB_URL is not set in Web/.env.local. Add the Supabase direct connection URI there (Project Settings -> Database), then rerun.');process.exit(1);}
const client=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:15000});
await client.connect();
try{
 for(const name of names){
  if(!/^[0-9]{5}_[a-z0-9_]+\.sql$/.test(name))throw new Error(`Not a migration file name: ${name}`);
  const sql=await readFile(new URL(`supabase/migrations/${name}`,root),'utf8');
  await client.query(sql);
  console.log(`Applied ${name}`);
 }
}finally{await client.end();}