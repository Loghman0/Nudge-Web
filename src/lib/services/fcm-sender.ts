import {createPrivateKey,createSign,type KeyObject} from 'node:crypto';

export interface FcmConfiguration{projectId:string;email:string;key:KeyObject}
export type FcmOutcome={outcome:'accepted'|'retry'|'gone'|'failed';status:number|null};
export interface NativeDelivery{delivery_id:string;claim_token:string;notification_id:string;device_id:string;device_revision:number;recipient_user_id:string;token:string;decision_id:string}
export interface DailyQuestionDelivery {
 kind: 'daily_question';
 id: string;
 token: string;
 userId: string;
 questionId: string;
 questionVersion: number;
 prompt: string;
}
export function readFcmConfiguration(env:Record<string,string|undefined>=process.env):FcmConfiguration|null{
 try{
  const projectId=env.FCM_PROJECT_ID,raw=env.FCM_SERVICE_ACCOUNT_JSON;
  if(!projectId||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)||!raw||raw.length>20000)return null;
  const parsed=JSON.parse(raw);
  if(parsed.type!=='service_account'||parsed.project_id!==projectId||typeof parsed.client_email!=='string'||!parsed.client_email.endsWith('@'+projectId+'.iam.gserviceaccount.com')||typeof parsed.private_key!=='string')return null;
  const key=createPrivateKey(parsed.private_key);if(key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength??0)<2048)return null;
  return {projectId,email:parsed.client_email,key};
 }catch{return null;}
}
async function json(res:Response):Promise<any>{
 const reader=res.body?.getReader();if(!reader)throw new Error('Empty provider response');let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384){await reader.cancel();throw new Error('Provider response too large');}chunks.push(part.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
/** Fixed Google endpoints, generic lock-screen copy, no raw provider errors in logs. */
export function createFcmSender(config:FcmConfiguration,deps:{fetch?:typeof fetch;now?:()=>number;timeoutMs?:number}={}){
 const transport=deps.fetch??fetch,now=deps.now??Date.now;
 let bearer:string|null=null,expiresAt=0;
 async function token(signal:AbortSignal){
  if(bearer&&expiresAt>now()+60000)return bearer;
  const iat=Math.floor(now()/1000),header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({iss:config.email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat,exp:iat+3600})).toString('base64url');
  const unsigned=header+'.'+payload,signer=createSign('RSA-SHA256');signer.update(unsigned);signer.end();
  const assertion=unsigned+'.'+signer.sign(config.key).toString('base64url');
  const response=await transport('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}).toString(),redirect:'error',signal});
  const result=await json(response);
  if(!response.ok||typeof result.access_token!=='string'||!result.access_token||result.access_token.length>8192||!Number.isInteger(result.expires_in)||result.expires_in<60||result.expires_in>3600)throw new Error('Sender authorization unavailable');
  bearer=result.access_token;expiresAt=now()+result.expires_in*1000;return bearer;
 }
 return async(item:NativeDelivery|DailyQuestionDelivery):Promise<FcmOutcome>=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),deps.timeoutMs??10000);
  try{
   const accessToken=await token(controller.signal);
   const message='kind' in item ? {
    token:item.token, notification:{title:'Nudge · Today’s question',body:item.prompt},
    data:{kind:item.kind,notificationId:item.id,recipientUserId:item.userId,questionId:item.questionId,questionVersion:String(item.questionVersion)},
    android:{priority:'HIGH',ttl:'900s',notification:{channel_id:'daily_questions',tag:item.id,visibility:'PRIVATE'}},
   } : {token:item.token,notification:{title:'Nudge check-in',body:'Your check-in is ready.'},data:{notificationId:item.notification_id,decisionId:item.decision_id,recipientUserId:item.recipient_user_id},android:{priority:'NORMAL',ttl:'3600s',notification:{channel_id:'checkins',tag:item.notification_id,visibility:'PRIVATE'}}};
   const response=await transport('https://fcm.googleapis.com/v1/projects/'+encodeURIComponent(config.projectId)+'/messages:send',{method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},redirect:'error',signal:controller.signal,
    body:JSON.stringify({message})});
   const result=await json(response);
   if(response.ok)return {outcome:typeof result.name==='string'&&result.name.startsWith('projects/'+config.projectId+'/messages/')?'accepted':'retry',status:response.status};
   if(response.status===401){bearer=null;expiresAt=0;}
   const gone=response.status===404&&Array.isArray(result.error?.details)&&result.error.details.some((d:Record<string,unknown>)=>d?.['@type']==='type.googleapis.com/google.firebase.fcm.v1.FcmError'&&d.errorCode==='UNREGISTERED');
   return {outcome:gone?'gone':response.status===429||response.status>=500||response.status===401?'retry':'failed',status:response.status};
  }catch{return {outcome:'retry',status:null};}finally{clearTimeout(timer);}
 };
}
