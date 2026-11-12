import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { it } from 'node:test';
import assert from 'node:assert/strict';

it('rejects public/user check-in requests before invoking the service-role job',async()=>{
  let handler!:(request:Request)=>Promise<Response>;let calls=0;
  const secret='unit-test-scheduler-secret-1234567890';
  const src=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/send-checkins/index.ts',import.meta.url),'utf8')).replace(/^import[\s\S]*?;\s*$/gm,'');
  const context=vm.createContext({Response,Request,Date,console,
    Deno:{env:{get:(key:string)=>key==='CHECKINS_CRON_SECRET'?secret:undefined},serve:(fn:typeof handler)=>handler=fn},
    createClient:()=>({rpc:async()=>{calls++;return {data:0,error:null}}}),webpush:{},
  });
  vm.runInContext(src,context);
  assert.equal((await handler(new Request('https://nudge.test/checkins',{method:'POST',headers:{Authorization:'Bearer ordinary-user-jwt'}}))).status,401);
  assert.equal(calls,0);
  assert.equal((await handler(new Request('https://nudge.test/checkins',{method:'POST',headers:{'x-nudge-cron-secret':secret}}))).status,200);
  assert.equal(calls,1);
});
