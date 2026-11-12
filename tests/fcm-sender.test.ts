import {it} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {createFcmSender,readFcmConfiguration,type NativeDelivery} from '../src/lib/services/fcm-sender';
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const env={FCM_PROJECT_ID:'nudge-502812',FCM_SERVICE_ACCOUNT_JSON:JSON.stringify({type:'service_account',project_id:'nudge-502812',client_email:'synthetic@nudge-502812.iam.gserviceaccount.com',private_key:keys.privateKey.export({type:'pkcs8',format:'pem'})})};
const config=readFcmConfiguration(env)!;
const id='00000000-0000-4000-8000-000000000001';
const item:NativeDelivery={delivery_id:id,claim_token:id,notification_id:id,device_id:id,device_revision:1,recipient_user_id:id,decision_id:id,token:'synthetic-token-for-tests'};
it('requires a matching project and valid RSA private server credential',()=>{
 assert.ok(config);assert.equal(readFcmConfiguration({}),null);assert.equal(readFcmConfiguration({...env,FCM_PROJECT_ID:'different-project'}),null);assert.equal(readFcmConfiguration({...env,FCM_SERVICE_ACCOUNT_JSON:'{}'}),null);
});
it('uses signed fixed-audience OAuth, caches its token, and sends only generic copy and routing IDs',async()=>{
 let authCalls=0,pushCalls=0;
 const sender=createFcmSender(config,{now:()=>1000000,fetch:async(url,init)=>{
  assert.equal(init?.redirect,'error');
  if(String(url)==='https://oauth2.googleapis.com/token'){
   authCalls++;const assertion=new URLSearchParams(String(init?.body)).get('assertion')!,parts=assertion.split('.');assert.equal(parts.length,3);assert.equal(verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),keys.publicKey,Buffer.from(parts[2],'base64url')),true);
   const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString());assert.equal(claims.aud,'https://oauth2.googleapis.com/token');assert.equal(claims.scope,'https://www.googleapis.com/auth/firebase.messaging');assert.equal(claims.exp-claims.iat,3600);
   return Response.json({access_token:'synthetic-access',expires_in:3600});
  }
  pushCalls++;assert.equal(String(url),'https://fcm.googleapis.com/v1/projects/nudge-502812/messages:send');const body=JSON.parse(String(init?.body));assert.deepEqual(body.message.notification,{title:'Nudge check-in',body:'Your check-in is ready.'});assert.equal(body.message.android.notification.visibility,'PRIVATE');assert.equal(body.message.android.notification.tag,id);assert.deepEqual(body.message.data,{notificationId:id,decisionId:id,recipientUserId:id});assert.ok(!String(init?.body).includes('private-question'));
  return Response.json({name:'projects/nudge-502812/messages/accepted'});
 }});
 assert.equal((await sender({...item,title:'private-question'} as NativeDelivery)).outcome,'accepted');assert.equal((await sender(item)).outcome,'accepted');assert.equal(authCalls,1);assert.equal(pushCalls,2);
});
it('removes only structured unregistered tokens and retries transient failures without an immediate send loop',async()=>{
 for(const [status,body,outcome] of [[404,{error:{details:[{'@type':'type.googleapis.com/google.firebase.fcm.v1.FcmError',errorCode:'UNREGISTERED'}]}},'gone'],[404,{error:{}},'failed'],[403,{error:{}},'failed'],[429,{error:{}},'retry'],[500,{error:{}},'retry'],[200,{},'retry']] as const){
  let pushes=0;const send=createFcmSender(config,{fetch:async(url)=>{if(String(url).includes('oauth2'))return Response.json({access_token:'synthetic',expires_in:3600});pushes++;return Response.json(body,{status});}});const result=await send(item);assert.equal(result.outcome,outcome);assert.equal(pushes,1);
 }
});
it('sends the full curated daily prompt and the exact question target on its own Android channel',async()=>{
 const prompt='A friend asks for your help with a new hobby. What would you like to do first?';
 const send=createFcmSender(config,{fetch:async(url,init)=>{
  if(String(url).includes('oauth2'))return Response.json({access_token:'synthetic',expires_in:3600});
  const {message}=JSON.parse(String(init?.body));
  assert.equal(message.notification.body,prompt);
  assert.equal(message.android.notification.channel_id,'daily_questions');
  assert.deepEqual(message.data,{kind:'daily_question',notificationId:id,recipientUserId:id,questionId:'rest-break',questionVersion:'2'});
  return Response.json({name:'projects/nudge-502812/messages/accepted'});
 }});
 assert.equal((await send({kind:'daily_question',id,token:item.token,userId:id,questionId:'rest-break',questionVersion:2,prompt})).outcome,'accepted');
});
it('bounds provider waits and response size',async()=>{
 const slow=createFcmSender(config,{timeoutMs:5,fetch:async(_,init)=>new Promise((_,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('aborted'))))});assert.equal((await slow(item)).outcome,'retry');
 const huge=createFcmSender(config,{fetch:async()=>new Response('x'.repeat(16385))});assert.equal((await huge(item)).outcome,'retry');
});
