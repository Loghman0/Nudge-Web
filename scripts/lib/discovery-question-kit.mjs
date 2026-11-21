import {createHash} from 'node:crypto';

export const labels=(...values)=>values.map((label,index)=>({id:String.fromCharCode(97+index),label}));
export const choice=(id,domain,subdomain,prompt,values,extra={})=>({id,version:1,familyId:id,domain,subdomain,prompt,format:'choice',choices:labels(...values),purpose:'evidence',depth:0,sensitivity:'ordinary',estimatedSeconds:12,status:'published',source:'starter',allowedResponses:['depends','neither','skip'],review:{type:'authored_seed',version:1},...extra});
export const scale=(id,domain,subdomain,prompt,minLabel,maxLabel,extra={})=>({...choice(id,domain,subdomain,prompt,[],extra),format:'scale',choices:undefined,scale:{min:1,max:5,step:1,minLabel,maxLabel},estimatedSeconds:15});
export const text=(id,domain,subdomain,prompt,extra={})=>({...choice(id,domain,subdomain,prompt,[],extra),format:'text',choices:undefined,estimatedSeconds:30});
export const rank=(id,domain,subdomain,prompt,values,extra={})=>({...choice(id,domain,subdomain,prompt,values,extra),format:'ranking',ranking:{min:1,max:Math.min(2,values.length),allowTies:true},estimatedSeconds:25});
export const signal=(optionId,attributeKey,value,statement,scope,criterion)=>({optionId,attributeKey,value,statement,scope,kind:'preference',strength:'direct',...(criterion?{criterion}: {})});
export const criterion=(label,...decisionDomains)=>({label,decisionDomains});

export function priorityChoice(id,domain,subdomain,prompt,scope,options,decisionDomains=[domain],extra={}){
 return choice(id,domain,subdomain,prompt,options.map(([label])=>label),{
  signals:options.map(([,key,priority],index)=>signal(
   String.fromCharCode(97+index),`${domain}.${subdomain}.priority`,key,
   `You picked ${priority.toLowerCase()} ${scope}.`,scope,criterion(priority,...decisionDomains)
  )),
  ...extra,
 });
}

export const legacyUuid=(key,prefix)=>{const h=createHash('sha256').update(`${prefix}:${key}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};