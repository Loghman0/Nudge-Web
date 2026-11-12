/** Accept a local app path only; OAuth/login must never become an open redirect. */
export function safeReturnPath(value:unknown,fallback="/dashboard"):string{
 if(typeof value!=="string"||!value.startsWith("/")||value.startsWith("//")||/[\\\r\n]/.test(value))return fallback;
 try{const url=new URL(value,"https://nudge.local");if(url.origin!=="https://nudge.local"||url.pathname==="/consent")return fallback;return url.pathname+url.search;}catch{return fallback;}
}
