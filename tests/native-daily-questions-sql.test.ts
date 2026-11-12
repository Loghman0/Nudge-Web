import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {asUser,createTestDatabase,USER_A,USER_B} from './helpers/database';

test('daily push reserves a new question at local noon and honors device ownership, permission and claims',async()=>{
 const db=await createTestDatabase();
 try{
  for(const migration of (await readdir('supabase/migrations')).sort().filter(name=>/^000(?:1[0-9]|2[01])_/.test(name)))await db.exec(await readFile('supabase/migrations/'+migration,'utf8'));
  const installation='10000000-0000-4000-8000-000000000001',secret='a'.repeat(64);
  const settings={enabled:true,token:'test:daily-question-token-1',timeZone:'Asia/Baku',quietStart:0,quietEnd:0};
  const enable=(owner:string,proof:string,epoch=1)=>asUser(db,owner,tx=>tx.query<{ok:boolean}>('select enable_native_daily_questions($1,$2,$3) ok',[installation,proof,epoch]));
  const service=(sql:string,args:unknown[])=>db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query<{result:any}>(sql,args);});
  const policy='2026-10-12';
  await db.query('update profiles set terms_version=$1,timezone=$2 where id=$3',[policy,'Asia/Baku',USER_A]);
  await asUser(db,USER_A,tx=>tx.query('select set_native_push_device($1,$2,1,$3::jsonb)',[installation,secret,JSON.stringify(settings)]));
  const noon=new Date();noon.setUTCHours(8,0,0,0);
  const stamp=(minute:number)=>new Date(noon.getTime()+minute*60000).toISOString();
  const claim=async(minute:number)=>(await service('select claim_native_daily_questions($1,$2) result',[policy,stamp(minute)])).rows[0].result;
  const read=async(item:{id:string;claimToken:string},minute:number)=>(await service('select read_native_daily_question($1,$2,$3,$4) result',[item.id,item.claimToken,policy,stamp(minute)])).rows[0].result;
  assert.equal((await enable(USER_B,secret)).rows[0].ok,false);
  assert.equal((await enable(USER_A,'b'.repeat(64))).rows[0].ok,false);
  assert.deepEqual(await claim(0),[]);
  assert.equal((await enable(USER_A,secret)).rows[0].ok,true);
  assert.deepEqual(await claim(-1),[]);
  await assert.rejects(asUser(db,USER_A,tx=>tx.query('select claim_native_daily_questions($1,$2)',[policy,stamp(0)])),/permission denied/);
  const [first]=await claim(0);assert.ok(first);
  const sent=await read(first,0);assert.ok(sent.prompt);assert.equal(sent.userId,USER_A);
  assert.deepEqual(await claim(0),[]);
  const [retry]=await claim(5);assert.equal(retry.id,first.id);assert.notEqual(retry.claimToken,first.claimToken);
  assert.equal(await read(first,5),null);
  assert.equal((await service('select finish_native_daily_question($1,$2,false) result',[retry.id,retry.claimToken])).rows[0].result,true);
  assert.deepEqual(await claim(10),[]);
  const [tomorrow]=await claim(1440);assert.ok(tomorrow);
  const next=await read(tomorrow,1440);assert.notEqual(next.questionId,sent.questionId);
  await asUser(db,USER_A,tx=>tx.query('select set_native_push_device($1,$2,2,$3::jsonb)',[installation,secret,'{"enabled":false}']));
  assert.equal(await read(tomorrow,1440),null);
 }finally{await db.close();}
});
