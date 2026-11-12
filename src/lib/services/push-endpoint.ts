/** Restrict server push delivery to known browser push services, never arbitrary URLs. */
export function validPushEndpoint(value:unknown):value is string{
 if(typeof value!=="string"||value.length>2048)return false;
 try{const url=new URL(value);if(url.protocol!=="https:"||url.username||url.password||(url.port&&url.port!=="443"))return false;
  return url.hostname==="fcm.googleapis.com"||url.hostname==="web.push.apple.com"||url.hostname.endsWith(".push.services.mozilla.com")||url.hostname.endsWith(".notify.windows.com");
 }catch{return false;}
}
