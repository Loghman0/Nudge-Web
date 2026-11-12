import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {createSourceArchive,inspectSourceArchive,assertSafeEntry} from '../scripts/release-archive.mjs';

describe('release archive boundary',()=>{
 it('allows reproducible source and public example config and verifies the final bytes',()=>{
  const entries=[{name:'src/app/page.tsx',data:Buffer.from('export default function Page() {}')},{name:'.env.example',data:Buffer.from('AI_API_KEY=')}];
  assert.deepEqual(inspectSourceArchive(createSourceArchive(entries)),entries.map(e=>e.name));
 });
 it('rejects private configuration, state, nested archives and traversal',()=>{
  assert.throws(()=>createSourceArchive([]),/empty/);
  for(const name of ['.env.local','supabase/.env','test/auth-state.json','private.key','Nudgefinal.zip','../README.md','C:/secret','src\\..\\secret','.git/config','node_modules/a.js','.local/evidence/result.json','audit-2026-10-27/result.json']){
   assert.throws(()=>assertSafeEntry(name),Error,name);
  }
 });
 it('never includes a matched credential in diagnostics',()=>{
  const key='nvapi-'+ 'x'.repeat(30);
  assert.throws(()=>createSourceArchive([{name:'src/bad.ts',data:Buffer.from(key)}]),error=>error instanceof Error&&!error.message.includes(key)&&error.message.includes('credential'));
  const privateValue='synthetic-admin-credential-value';
  assert.throws(()=>createSourceArchive([{name:'.env.example',data:Buffer.from('SUPABASE_SERVICE_ROLE_KEY='+privateValue)}],[privateValue]),error=>error instanceof Error&&!error.message.includes(privateValue)&&error.message.includes('credential'));
 });
 it('rejects corrupted bytes and duplicate case-insensitive paths',()=>{
  const archive=createSourceArchive([{name:'README.md',data:Buffer.from('hello')}]);archive[39]^=1;
  assert.throws(()=>inspectSourceArchive(archive),/mismatch/);
  assert.throws(()=>createSourceArchive([{name:'a.ts',data:Buffer.alloc(0)},{name:'A.ts',data:Buffer.alloc(0)}]),/Duplicate/);
 });
});
