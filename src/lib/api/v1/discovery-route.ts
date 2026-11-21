import type {createApiAuthenticator} from './auth';
import type {Json} from '@/lib/types/database';
import {DiscoveryError,checkDiscoveryError,loadDiscoveryProfile,usableDiscoveryObservations,discoveryLearningNeeds} from '@/lib/services/discovery';
import {suggestDecisionCriteria} from '@/lib/services/decision-personalization';
import {parseDiscoveryAnswers,getDiscoveryQuestion,validateDiscoveryResponse,selectDiscoveryQuestion,discoveryDomain,discoveryTextNeedsSupport,discoveryMood} from '@/lib/discovery';
import type {DiscoveryQuestion,DiscoveryResponse} from '@/lib/discovery/types';
import type {DiscoveryProfile} from '@/lib/discovery/contracts';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
async function readBody(request:Request):Promise<Record<string,unknown>>{
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DiscoveryError(415,'invalid_request','Send answers as JSON.');
  const reader=request.body?.getReader();if(!reader)throw new DiscoveryError(400,'invalid_request','Missing answers.');
  let size=0;const chunks:Uint8Array[]=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>24000){await reader.cancel();throw new DiscoveryError(413,'too_large','This answer is too long.');}chunks.push(value);}}finally{reader.releaseLock();}
  try{const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw new DiscoveryError(400,'invalid_request','Check the answer and try again.');}
}
function invalid(message='Review the answers before saving.'):never{throw new DiscoveryError(400,'invalid_request',message);}
function protectText(response:Parameters<typeof discoveryTextNeedsSupport>[0]){if(discoveryTextNeedsSupport(response))throw new DiscoveryError(422,'support','This sounds like a difficult moment. Let’s pause the questions. If you may be in immediate danger, contact local emergency services or someone you trust who can stay with you. This answer has not been saved.');}
function canOffer(question:DiscoveryQuestion|undefined,profile:DiscoveryProfile,mode:unknown){
 return !!question&&question.status==='published'&&!profile.suppressedQuestionIds.includes(question.id)&&!profile.settings.mutedTopics.includes(question.domain)
  &&question.depth<=Math.min(profile.settings.maxDepth,mode==='light'?0:mode==='curious'?1:2)
  &&(question.sensitivity==='ordinary'||profile.settings.optionalTopics&&profile.capabilities.optionalTopics)
  &&(question.format!=='text'||profile.settings.writtenAnswers&&profile.capabilities.writtenAnswers);
}
function checkAnswerAvailability(question:DiscoveryQuestion,response:DiscoveryResponse,profile:DiscoveryProfile){
 protectText(response);
 if(response.kind==='skip')return;
 if(question.sensitivity==='optional'&&(!profile.capabilities.optionalTopics||!profile.settings.optionalTopics))invalid('Optional topics are not available. You can skip this question.');
 if((response.kind==='text'||response.kind==='depends'&&!!response.context)&&(!profile.capabilities.writtenAnswers||!profile.settings.writtenAnswers))invalid('Written answers are not available. You can choose an answer or skip.');
}
export function createDiscoveryHandler(authenticate:ReturnType<typeof createApiAuthenticator>){
 return async(request:Request,context:{params:Promise<{path:string[]}>})=>{
  try{
   const auth=await authenticate(request);if(!auth.ok)return json({error:{code:auth.code,message:auth.message}},auth.status);
   const {client}=auth;const path=(await context.params).path.join('/');
   if(request.method==='GET'&&path==='profile')return json(await loadDiscoveryProfile(client));
   const b=await readBody(request);
   if(path==='suggestions'&&request.method==='POST'){
    if(typeof b.domain!=='string'||b.domain.length>160||b.category!==undefined&&typeof b.category!=='string')invalid();
    const profile=await loadDiscoveryProfile(client);
    return json({generation:profile.generation,suggestions:suggestDecisionCriteria(usableDiscoveryObservations(profile),{domain:b.domain,category:b.category as string|undefined})});
   }
   if(!integer(b.expectedGeneration))invalid('Reload your answers before continuing.');
   const generation=b.expectedGeneration;
   if(path==='settings'&&request.method==='POST'){
    if(!Array.isArray(b.mutedTopics)||b.mutedTopics.length>18||b.mutedTopics.some(v=>!discoveryDomain(v))||!integer(b.maxDepth)||b.maxDepth>2||typeof b.optionalTopics!=='boolean'||typeof b.writtenAnswers!=='boolean'||typeof b.metricsEnabled!=='boolean')invalid();
    const profile=await loadDiscoveryProfile(client);
    if((b.writtenAnswers&&!profile.capabilities.writtenAnswers)||(b.optionalTopics&&!profile.capabilities.optionalTopics))invalid('These question formats are not available yet. Your other settings can still be saved.');
    const {error}=await client.rpc('save_discovery_preferences',{p_generation:generation,p_muted:b.mutedTopics as Json,p_optional:b.optionalTopics,p_depth:b.maxDepth,p_written:b.writtenAnswers,p_metrics:b.metricsEnabled});checkDiscoveryError(error);return json({saved:true});
   }
   if(!uuid(b.requestId))invalid('Reload this page to start a new save.');
   if((path==='claim'||path==='answers')&&request.method==='POST'){
    const parsed=parseDiscoveryAnswers(b.answers,{previewOnly:path==='claim',maxAnswers:path==='claim'?6:1});if(!parsed.value)invalid(parsed.error);
    const profile=await loadDiscoveryProfile(client);
    for(const answer of parsed.value)checkAnswerAvailability(getDiscoveryQuestion(answer.questionId,answer.questionVersion)!,answer.response,profile);
    const {data,error}=await client.rpc('save_discovery_answers',{p_request_id:b.requestId,p_generation:generation,p_answers:parsed.value as unknown as Json,p_source:path==='claim'?'preview':'daily'});checkDiscoveryError(error);return json(data);
   }
   if(path.startsWith('answers/')&&['PATCH','DELETE'].includes(request.method)){
    const id=path.slice(8);if(!uuid(id)||!integer(b.expectedRevision))invalid();
    if(b.active!==undefined&&typeof b.active!=='boolean')invalid();
    if(request.method==='PATCH'&&b.response===undefined&&b.active===undefined)invalid();
    if(b.response!==undefined){
     const profile=await loadDiscoveryProfile(client),answer=profile.answers.find(a=>a.id===id);if(!answer)throw new DiscoveryError(404,'not_found','Answer not found.');
     const parsed=validateDiscoveryResponse(answer.question,b.response);if(!parsed.value)invalid(parsed.error);checkAnswerAvailability(answer.question,parsed.value,profile);b.response=parsed.value;
    }
    const {data,error}=await client.rpc('edit_discovery_answer',{p_request_id:b.requestId,p_generation:generation,p_answer_id:id,p_revision:b.expectedRevision,...(b.response!==undefined?{p_response:b.response as Json}:{}),...(b.active!==undefined?{p_active:b.active as boolean}:{}),p_delete:request.method==='DELETE'});checkDiscoveryError(error);return json(data);
   }
   if(path==='insights/feedback'&&request.method==='POST'){
    if(typeof b.insightId!=='string'||!['fits','sometimes','not_me'].includes(String(b.feedback)))invalid();
    const profile=await loadDiscoveryProfile(client);if(!profile.insights.some(i=>i.id===b.insightId))invalid('This reflection has changed. Reload it first.');
    const {data,error}=await client.rpc('save_discovery_feedback',{p_request_id:b.requestId,p_generation:generation,p_insight_id:b.insightId,p_feedback:String(b.feedback)});checkDiscoveryError(error);return json(data);
   }
   if(path==='next'&&request.method==='POST'){
    if(b.topic!==undefined&&b.topic!==null&&!discoveryDomain(b.topic))invalid();
    if(b.mode!==undefined&&!['light','curious','reflect'].includes(String(b.mode)))invalid();
    if(b.mood!==undefined&&b.mood!==null&&!discoveryMood(b.mood))invalid('Choose a listed mood or no preference.');
    const profile=await loadDiscoveryProfile(client);if(profile.generation!==generation)throw new DiscoveryError(409,'changed','Your answers changed. Reload questions.');
    if(b.notificationQuestion!==undefined){
     const target=b.notificationQuestion as {questionId?:unknown;questionVersion?:unknown}|null;
     if(!target||typeof target.questionId!=='string'||!integer(target.questionVersion)||target.questionVersion<1)invalid('This notification is unavailable.');
     const exposure=profile.exposures.find(e=>e.daily&&e.questionId===target.questionId&&e.questionVersion===target.questionVersion);
     const question=exposure?getDiscoveryQuestion(exposure.questionId,exposure.questionVersion):getDiscoveryQuestion(target.questionId,target.questionVersion);
     if(exposure){
      if(!canOffer(question,profile,'light'))throw new DiscoveryError(404,'not_found','That question is no longer available. Reload for today’s question.');
      const answered=exposure.state==='answered'||exposure.state==='skipped'||profile.answers.some(a=>a.questionId===target.questionId);
      return json({question,reason:'coverage',generation,answered});
     }
     // On-device reminders carry the day's question before any exposure exists: reserve it as today's daily.
     if(canOffer(question,profile,'light')&&!profile.answers.some(a=>a.questionId===target.questionId)){
      const {data,error}=await client.rpc('reserve_discovery_question',{p_request_id:b.requestId,p_generation:generation,p_question_id:question!.id,p_version:question!.version,p_daily:true,p_change:true,p_reason:'coverage'});
      checkDiscoveryError(error);
      const reserved=data as {question_id:string;question_version:number;state:string};
      return json({question:getDiscoveryQuestion(reserved.question_id,reserved.question_version),reason:'coverage',generation,answered:reserved.state==='answered'||reserved.state==='skipped'});
     }
     // Muted or already answered: fall through to today's regular daily selection.
    }
    let replaceDaily=b.change===true;
    if(b.daily===true&&!replaceDaily){const daily=profile.exposures.find(e=>e.daily&&e.localDay===profile.today&&e.state!=='changed');if(daily){
     const question=getDiscoveryQuestion(daily.questionId,daily.questionVersion);
     if(canOffer(question,profile,b.mode))return json({question,reason:'coverage',generation,answered:daily.state==='answered'||daily.state==='skipped'});
     replaceDaily=true;
    }}
    const selection=selectDiscoveryQuestion({answers:profile.answers,learningNeeds:discoveryLearningNeeds(profile),suppressedQuestionIds:profile.suppressedQuestionIds,exposures:profile.exposures,topic:discoveryDomain(b.topic),mutedTopics:profile.settings.mutedTopics,allowedOptional:profile.settings.optionalTopics&&profile.capabilities.optionalTopics,allowText:profile.settings.writtenAnswers&&profile.capabilities.writtenAnswers,maxDepth:profile.settings.maxDepth,mode:b.mode as 'light'|'curious'|'reflect',mood:discoveryMood(b.mood),localHour:integer(b.localHour)&&b.localHour<24?b.localHour:undefined,sessionAnswers:integer(b.sessionAnswers)?Math.min(100,b.sessionAnswers):0,consecutiveSkips:integer(b.consecutiveSkips)?Math.min(100,b.consecutiveSkips):0,continueAfterPause:b.continueAfterPause===true});
    if(!selection.question)return json({...selection,generation});
    const {data,error}=await client.rpc('reserve_discovery_question',{p_request_id:b.requestId,p_generation:generation,p_question_id:selection.question.id,p_version:selection.question.version,p_daily:b.daily===true,p_change:replaceDaily,p_reason:selection.reason});checkDiscoveryError(error);
    const exposure=data as {question_id:string;question_version:number;state:string};
    return json({...selection,question:getDiscoveryQuestion(exposure.question_id,exposure.question_version),answered:exposure.state==='answered'||exposure.state==='skipped',generation});
   }
   return json({error:{code:'not_found',message:'This discovery action is not available.'}},404);
  }catch(error){if(error instanceof DiscoveryError)return json({error:{code:error.code,message:error.message}},error.status);return json({error:{code:'unavailable',message:'Could not finish this step. Your answers have not been cleared. Try again.'}},503);}
 };
}

