export type NativePushSettings={enabled:false}|{enabled:true;token:string;timeZone:string;quietStart:number;quietEnd:number};
export interface NativePushIntent{installationId:string;secret:string;epoch:number;settings:NativePushSettings}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const isInstallationId=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function parseNativePushIntent(raw:unknown):NativePushIntent|null{
 if(!record(raw)||Object.keys(raw).some(k=>!['installationId','secret','epoch','settings'].includes(k))||!isInstallationId(raw.installationId)
  ||typeof raw.secret!=='string'||!/^[a-f0-9]{64}$/.test(raw.secret)||!Number.isSafeInteger(raw.epoch)||Number(raw.epoch)<1||!record(raw.settings))return null;
 const s=raw.settings;
 if(s.enabled===false&&Object.keys(s).length===1)return {installationId:raw.installationId,secret:raw.secret,epoch:Number(raw.epoch),settings:{enabled:false}};
 if(s.enabled!==true||Object.keys(s).some(k=>!['enabled','token','timeZone','quietStart','quietEnd'].includes(k))||typeof s.token!=='string'||s.token.length<20||s.token.length>4096||!/^[A-Za-z0-9:_.~-]+$/.test(s.token)
  ||typeof s.timeZone!=='string'||!s.timeZone||s.timeZone.length>64||!Number.isInteger(s.quietStart)||Number(s.quietStart)<0||Number(s.quietStart)>1439||!Number.isInteger(s.quietEnd)||Number(s.quietEnd)<0||Number(s.quietEnd)>1439)return null;
 try{new Intl.DateTimeFormat('en-US',{timeZone:s.timeZone}).format(0);}catch{return null;}
 return {installationId:raw.installationId,secret:raw.secret,epoch:Number(raw.epoch),settings:{enabled:true,token:s.token,timeZone:s.timeZone,quietStart:Number(s.quietStart),quietEnd:Number(s.quietEnd)}};
}
