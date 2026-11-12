import type {createApiAuthenticator} from './auth';
import {readEarlierPattern,readVerifications} from '@/lib/discover/loaders';
import {queryProfileMemories} from '@/lib/services/profile-memories';
import {recordKnowledgeSignal} from '@/lib/services/knowledge';
import {pollResult} from '@/lib/services/poll-result';
import {firstRelated} from '@/lib/services/relations';
import {decisionActivity,preferenceTimeline,PREFERENCE_TIMELINE_LIMIT} from '@/lib/services/native-timelines';
import {extractProfileMemories,confirmProfileMemoryReview} from '@/lib/services/profile-memory-intake';
import {parseMemoryReview} from '@/lib/services/profile-memory-review';
import {getAccountedAi} from '@/lib/services/ai/accounting';
import {generateOwnerRecap} from '@/lib/services/monthly-recap';
import {parseNativePushIntent,isInstallationId} from '@/lib/services/native-push-input';
import {readFcmConfiguration} from '@/lib/services/fcm-sender';

type Client=Extract<Awaited<ReturnType<ReturnType<typeof createApiAuthenticator>>>,{ok:true}>['client'];
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const str=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
class ToolsError extends Error{constructor(public status:number,public code:string,message:string){super(message);}}
function fail(message='Check this change and try again.'):never{throw new ToolsError(400,'invalid_request',message);}
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const knownCircleErrors=['This invitation is no longer valid','This circle is full','Poll options must be distinct','You can own up to 20 circles','Close an existing vote before opening another','This vote is closed or unavailable','You cannot close this vote','Owners must delete the circle instead of leaving','Circle not found'];
function check(error:{code?:string;message?:string}|null,creation=false){
 if(!error)return;
 if(error.code==='P0001'&&knownCircleErrors.includes(error.message??''))throw new ToolsError(409,'changed',error.message!);
 if(['PT409','40001'].includes(error.code??''))throw new ToolsError(409,'changed','Your memory changed. Reload before making another change.');
 throw new ToolsError(503,creation?'uncertain_create':'unavailable',creation?'Could not confirm whether this was created. Reload before creating another.':'Could not confirm this change. Reload your data before trying again.');
}
function fields(body:Record<string,unknown>,allowed:string[]){if(Object.keys(body).some(key=>!allowed.includes(key)))fail();}
async function body(request:Request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new ToolsError(415,'invalid_request','Send this change as JSON.');
 const stream=request.body?.getReader();if(!stream)fail();let length=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await stream!.read();if(done)break;length+=value.length;if(length>12000){await stream!.cancel();throw new ToolsError(413,'too_large','This change is too long.');}chunks.push(value);}}finally{stream!.releaseLock();}
 try{const bytes=new Uint8Array(length);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}const parsed=JSON.parse(new TextDecoder().decode(bytes));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))fail();return parsed as Record<string,unknown>;}catch(e){if(e instanceof ToolsError)throw e;return fail();}
}
function page(request:Request){const query=new URL(request.url).searchParams;if([...query.keys()].some(k=>!['q','offset'].includes(k)||query.getAll(k).length!==1))fail();const q=query.get('q')??'',offset=query.get('offset')??'0';if(q.length>80||!/^\d{1,7}$/.test(offset)||Number(offset)>1000000)fail();return {q,offset:Number(offset)};}
async function generation(db:Client,userId:string,expected?:unknown){
 const {data,error}=await db.from('profiles').select('memory_generation').eq('id',userId).single();check(error);
 if(!data||!integer(data.memory_generation))throw new ToolsError(503,'unavailable','Could not load current memory.');
 if(expected!==undefined&&expected!==data.memory_generation)throw new ToolsError(409,'changed','Your memory changed. Reload before making another change.');return data.memory_generation;
}
async function circle(db:Client,id:string){
 const {data,error}=await db.from('decision_groups').select('id,name,owner_id,invite_code').eq('id',id).maybeSingle();check(error);
 if(!data)throw new ToolsError(404,'not_found','Circle not found.');return data;
}

export function createToolsHandler(authenticate:ReturnType<typeof createApiAuthenticator>,options:{now?:()=>number}={}){
 return async(request:Request,context:{params:Promise<{path:string[]}>})=>{
  let ambiguousCreation=false;
  try{
   const auth=await authenticate(request);if(!auth.ok)return response({error:{code:auth.code,message:auth.message}},auth.status);
   const {client:db,userId}=auth,path=(await context.params).path;
   if(path.length>4||path.some(p=>!p||p.length>80))fail();
   if(request.method==='GET'){
    if(path.join('/')==='circles'){
     const {data,error}=await db.from('decision_groups').select('id,name,owner_id,invite_code,created_at').order('created_at',{ascending:false}).limit(100);check(error);return response({circles:data??[],limit:100});
    }
    if(path[0]==='circles'&&path.length===2){
     if(!uuid(path[1]))fail();const group=await circle(db,path[1]);
     const [roster,polls,totals]=await Promise.all([db.rpc('circle_members',{gid:path[1]}),db.from('group_polls').select('id,question,status,created_by,created_at,group_poll_options(id,label,sort_order),group_poll_votes(option_id,user_id)').eq('group_id',path[1]).order('created_at',{ascending:false}).limit(20),db.rpc('circle_vote_counts',{gid:path[1]})]);
     check(roster.error);check(polls.error);check(totals.error);
     return response({circle:group,members:roster.data??[],polls:(polls.data??[]).map(p=>{
      const options=[...p.group_poll_options].sort((a,b)=>a.sort_order-b.sort_order),counts=new Map((totals.data??[]).filter(v=>v.poll_id===p.id).map(v=>[v.option_id,Number(v.votes)]));
      return {id:p.id,question:p.question,status:p.status,createdBy:p.created_by,createdAt:p.created_at,myVote:p.group_poll_votes.find(v=>v.user_id===userId)?.option_id??null,options:options.map(o=>({id:o.id,label:o.label,count:counts.get(o.id)??0})),totalVotes:[...counts.values()].reduce((sum,n)=>sum+n,0),...pollResult(options,counts)};
     }),pollLimit:20});
    }
    if(path.join('/')==='earlier'){
     const [checks,pattern,currentGeneration]=await Promise.all([readVerifications(db,userId,10),readEarlierPattern(db,userId),generation(db,userId)]);return response({checks,pattern,generation:currentGeneration});
    }
    if(path.join('/')==='memories'){
     const {q,offset}=page(request),result=await queryProfileMemories(db,userId,q,offset);if(result.error)throw new ToolsError(503,'unavailable',result.error);return response({...result,generation:await generation(db,userId),offset});
    }
    if(path.join('/')==='beliefs'){
     const {q,offset}=page(request),{data,error}=await db.rpc('search_beliefs',{p_search:q,p_offset:offset});check(error);
     return response({nodes:(data??[]).filter(n=>!n.key.startsWith('discovery.')).map(n=>({id:n.id,key:n.key,value:n.value,polarity:n.polarity,source:n.source,status:n.status,evidenceCount:n.evidence_count,category:n.category_slug})),generation:await generation(db,userId),offset,hasMore:(data?.length??0)>=20});
    }
    if(path[0]==='beliefs'&&path[2]==='evidence'&&path.length===3){
     if(!uuid(path[1]))fail();const {data:node,error:nodeError}=await db.from('knowledge_nodes').select('id').eq('id',path[1]).eq('user_id',userId).maybeSingle();check(nodeError);if(!node)throw new ToolsError(404,'not_found','Belief not found.');
     const {data,error}=await db.from('knowledge_evidence').select('id,kind,direction,weight,created_at,source_decision_id,detail').eq('node_id',path[1]).eq('user_id',userId).order('created_at',{ascending:false}).limit(20);check(error);return response({evidence:data??[]});
    }
    if(path.join('/')==='outcomes'){
     const asOf=(options.now??Date.now)();
     const [{data,error},profile]=await Promise.all([db.from('decisions').select('id,question,category,status,created_at,selected_option_id,decision_options!decision_options_decision_id_fkey(id,label),decision_reflections(rating,has_regrets)').eq('user_id',userId).lte('created_at',new Date(asOf).toISOString()).order('created_at',{ascending:false}).order('id').limit(250),db.from('profiles').select('timezone').eq('id',userId).single()]);check(error);check(profile.error);
     const rows=data??[],reflections=rows.map(d=>firstRelated(d.decision_reflections)).filter(r=>!!r),rated=reflections.filter(r=>typeof r.rating==='number'),answeredRegrets=reflections.filter(r=>typeof r.has_regrets==='boolean');
     const categories=[...new Set(rows.map(d=>d.category))].map(category=>{const r=rows.filter(d=>d.category===category),ratings=r.map(d=>firstRelated(d.decision_reflections)?.rating).filter((n):n is number=>typeof n==='number');return {category,count:r.length,rated:ratings.length,average:ratings.length?ratings.reduce((a,b)=>a+b,0)/ratings.length:null};});
     const recent=rows.flatMap(d=>{const r=firstRelated(d.decision_reflections);return r?[{id:d.id,question:d.question,chosen:d.decision_options.find(o=>o.id===d.selected_option_id)?.label??null,rating:r.rating,regret:r.has_regrets}]:[];}).slice(0,10);
     return response({sampleLimit:250,sampleSize:rows.length,reflectionCount:reflections.length,ratedCount:rated.length,averageRating:rated.length?rated.reduce((a,r)=>a+r.rating!,0)/rated.length:null,regretRate:answeredRegrets.length?answeredRegrets.filter(r=>r.has_regrets).length/answeredRegrets.length:null,categories,recent,aiRecapAvailable:false,activity:decisionActivity(rows,asOf,profile.data?.timezone)});
    }
    if(path.join('/')==='timeline'){
     const asOf=(options.now??Date.now)(),cutoff=new Date(asOf).toISOString(),select='id,key,value,polarity,source,created_at,last_reinforced_at';
     const [reinforced,unreinforced,profile]=await Promise.all([
      db.from('preferences').select(select).eq('user_id',userId).not('key','like','discovery.%').not('last_reinforced_at','is',null).lte('created_at',cutoff).lte('last_reinforced_at',cutoff).order('last_reinforced_at',{ascending:false}).order('id').limit(PREFERENCE_TIMELINE_LIMIT),
      db.from('preferences').select(select).eq('user_id',userId).not('key','like','discovery.%').is('last_reinforced_at',null).lte('created_at',cutoff).order('created_at',{ascending:false}).order('id').limit(PREFERENCE_TIMELINE_LIMIT),
      db.from('profiles').select('timezone').eq('id',userId).single(),
     ]);check(reinforced.error);check(unreinforced.error);check(profile.error);
     return response(preferenceTimeline(reinforced.data??[],unreinforced.data??[],asOf,profile.data?.timezone));
    }
    return response({error:{code:'not_found',message:'This tool is unavailable.'}},404);
   }
   if(request.method!=='POST')return response({error:{code:'method_not_allowed',message:'Use the displayed action to make this change.'}},405);
   const b=await body(request);
   if(path.join('/')==='push/status'){
    fields(b,['installationId']);if(!isInstallationId(b.installationId))fail();
    const state=await db.from('native_push_devices').select('enabled,time_zone,quiet_start,quiet_end,expires_at').eq('user_id',userId).eq('installation_id',b.installationId).maybeSingle();check(state.error);
    return response({configured:readFcmConfiguration()!==null,device:state.data??null});
   }
   if(path.join('/')==='push/device'){
    const input=parseNativePushIntent(b);if(!input)fail('Review this device’s notification settings.');
    if(input!.settings.enabled&&!readFcmConfiguration())throw new ToolsError(503,'unavailable','Phone notifications are not configured yet. In-app check-ins still work.');
    const result=await db.rpc('set_native_push_device',{p_installation_id:input!.installationId,p_secret:input!.secret,p_epoch:input!.epoch,p_settings:input!.settings});
    if(result.error?.code==='42501')throw new ToolsError(403,'forbidden','Could not verify this device registration.');
    if(result.error?.code==='PT429')throw new ToolsError(409,'changed','Remove an older device registration before adding another.');
    check(result.error);return response(result.data);
   }
   if(path.join('/')==='push/daily'){
    fields(b,['installationId','secret','epoch']);
    const {installationId,secret,epoch}=b;
    if(!isInstallationId(installationId)||typeof secret!=='string'||!/^[a-f0-9]{64}$/.test(secret)||typeof epoch!=='number'||!Number.isSafeInteger(epoch)||epoch<1)fail();
    const result=await db.rpc('enable_native_daily_questions',{p_installation_id:installationId as string,p_secret:secret as string,p_epoch:epoch as number});
    check(result.error);
    return response({saved:result.data===true});
   }
   if(path.join('/')==='outcomes/recap'){
    fields(b,['confirmed']);if(b.confirmed!==true)fail('Confirm that you want to send this summary to AI.');
    return response(await generateOwnerRecap(db,userId));
   }
   if(path.join('/')==='memories/extract'){
    fields(b,['text']);if(typeof b.text!=='string'||b.text.trim().length<3||b.text.length>2000)fail('Enter 3 to 2,000 characters about a habit, goal, fact or constraint.');
    const result=await extractProfileMemories(db,userId,b.text,await getAccountedAi(db,userId,'extract'));
    if(result.error)return response({error:{code:result.stale?'changed':'unavailable',message:result.error}},result.stale?409:503);
    return response(result);
   }
   if(path.join('/')==='memories/confirm'){
    const parsed=parseMemoryReview(b);if(!parsed.value)fail(parsed.error);
    const result=await confirmProfileMemoryReview(db,userId,parsed.value);
    if(result.error)return response({error:{code:result.stale?'changed':'unavailable',message:result.error}},result.stale?409:503);
    return response(result);
   }
   if(path.join('/')==='circles/create'){
    fields(b,['name']);if(!str(b.name,80))fail('Enter a circle name up to 80 characters.');ambiguousCreation=true;
    const {data,error}=await db.rpc('create_circle',{p_name:b.name.trim()});check(error,true);if(!uuid(data))check({code:'unknown'},true);return response({id:data});
   }
   if(path.join('/')==='circles/join'){
    fields(b,['code']);if(typeof b.code!=='string'||!/^\s*[a-f0-9]{18}\s*$/i.test(b.code))fail('Enter the 18-character invitation code.');const {data,error}=await db.rpc('join_decision_circle',{code:b.code.trim()});check(error);if(!uuid(data))throw new ToolsError(409,'changed','This invitation is no longer valid.');return response({id:data});
   }
   if(path[0]==='circles'&&uuid(path[1])&&path.length===3){
    const id=path[1];await circle(db,id);
    if(['leave','rotate','delete'].includes(path[2])){
     fields(b,path[2]==='delete'?['confirmation']:[]);if(path[2]==='delete'&&b.confirmation!=='DELETE')fail('Type DELETE to remove this circle and its votes.');
     const {data,error}=await db.rpc('manage_circle',{p_group_id:id,p_action:path[2]==='rotate'?'rotate_invite':path[2]});check(error);return response({saved:true,inviteCode:typeof data==='string'?data:null});
    }
    if(path[2]==='polls'){
     fields(b,['question','options']);if(!str(b.question,200)||!Array.isArray(b.options)||b.options.length<2||b.options.length>5||b.options.some(o=>!str(o,100)))fail('Add a question and two to five short options.');const options=(b.options as string[]).map(o=>o.trim());if(new Set(options.map(o=>o.toLowerCase())).size!==options.length)fail('Poll options must be distinct.');ambiguousCreation=true;
     const {data,error}=await db.rpc('create_circle_poll',{p_group_id:id,p_question:b.question.trim(),p_options:options});check(error,true);if(!uuid(data))check({code:'unknown'},true);return response({id:data});
    }
   }
   if(path[0]==='polls'&&uuid(path[1])&&path.length===3){
    if(path[2]==='vote'){fields(b,['optionId']);if(!uuid(b.optionId))fail();const {error}=await db.rpc('cast_circle_vote',{p_poll_id:path[1],p_option_id:b.optionId});check(error);return response({saved:true});}
    if(path[2]==='close'){fields(b,['circleId']);if(!uuid(b.circleId))fail();const {error}=await db.rpc('close_circle_poll',{p_group_id:b.circleId,p_poll_id:path[1]});check(error);return response({saved:true});}
   }
   if(path.join('/')==='earlier/check'){
    fields(b,['queueId','answer']);if(!uuid(b.queueId)||!['still_true','not_anymore','forget'].includes(String(b.answer)))fail();const {error}=await db.rpc('answer_knowledge_verification',{p_queue_id:b.queueId,p_answer:String(b.answer)});check(error);return response({saved:true});
   }
   if(path.join('/')==='earlier/pattern'){
    fields(b,['key','confirmed','expectedGeneration']);if(!str(b.key,256)||!/^[a-z0-9]+([._-][a-z0-9]+)*$/.test(b.key)||typeof b.confirmed!=='boolean'||!integer(b.expectedGeneration))fail();await generation(db,userId,b.expectedGeneration);
    const {data:node,error}=await db.from('knowledge_nodes').select('id,key,value,category_slug,polarity,source,status,evidence_count,metadata').eq('user_id',userId).eq('key',b.key).eq('status','active').maybeSingle();check(error);
    const meta=node?.metadata&&typeof node.metadata==='object'&&!Array.isArray(node.metadata)?node.metadata:{};
    if(!node||node.polarity!=='like'||!['inferred','reflected'].includes(node.source)||node.evidence_count<2||/\.scope\./.test(node.key)||node.key.startsWith('discovery.')||meta.manual_polarity!==undefined)throw new ToolsError(409,'changed','This earlier pattern changed. Reload before checking it.');
    if(b.confirmed){if(!await recordKnowledgeSignal(db,{key:node.key,value:node.value,categorySlug:node.category_slug,polarity:'like',source:'explicit',weight:.5,kind:'confirmation',verified:true,detail:{confirmed:true},memoryGeneration:b.expectedGeneration}))throw new ToolsError(503,'unavailable','Could not confirm this pattern. Reload before trying again.');}
    else{const result=await db.rpc('correct_knowledge_node',{p_node_id:node.id,p_polarity:'neutral',p_note:'I did not confirm this inferred preference.'});check(result.error);}return response({saved:true});
   }
   if(path[0]==='beliefs'&&uuid(path[1])&&path.length===3){
    fields(b,path[2]==='forget'?['expectedGeneration']:['expectedGeneration','polarity','note']);if(!integer(b.expectedGeneration))fail();await generation(db,userId,b.expectedGeneration);
    const {data:node,error}=await db.from('knowledge_nodes').select('key').eq('id',path[1]).eq('user_id',userId).maybeSingle();check(error);if(!node||node.key.startsWith('discovery.'))throw new ToolsError(404,'not_found','Belief not found.');
    if(path[2]==='forget'){const result=await db.rpc('forget_knowledge_key',{p_key:node.key});check(result.error);return response({saved:true});}
    if(path[2]==='correct'){if(!['like','dislike','neutral'].includes(String(b.polarity))||typeof b.note!=='string'||b.note.length>300)fail();const result=await db.rpc('correct_knowledge_node',{p_node_id:path[1],p_polarity:b.polarity as 'like'|'dislike'|'neutral',p_note:b.note.trim()});check(result.error);return response({saved:true});}
   }
   if(path[0]==='memories'&&uuid(path[1])&&path.length===3&&['edit','delete'].includes(path[2])){
    fields(b,path[2]==='delete'?['expectedGeneration']:['expectedGeneration','content','kind']);if(!integer(b.expectedGeneration))fail();await generation(db,userId,b.expectedGeneration);
    const {data:memory,error}=await db.from('ai_memories').select('id,content,kind').eq('id',path[1]).eq('user_id',userId).maybeSingle();check(error);if(!memory)throw new ToolsError(404,'not_found','Memory not found.');
    const remove=path[2]==='delete';if(!remove&&(!str(b.content,300)||!['fact','goal','habit','constraint'].includes(String(b.kind))))fail('Use one to 300 characters and a valid memory type.');
    const result=await db.rpc('edit_ai_memory',{p_memory_id:path[1],p_content:remove?memory.content:(b.content as string).trim(),p_kind:remove?memory.kind:String(b.kind),p_delete:remove});check(result.error);return response({saved:true});
   }
   return response({error:{code:'not_found',message:'This tool action is unavailable.'}},404);
  }catch(e){if(e instanceof ToolsError)return response({error:{code:e.code,message:e.message}},e.status);return response({error:{code:ambiguousCreation?'uncertain_create':'unavailable',message:ambiguousCreation?'Could not confirm whether this was created. Reload before creating another.':'Could not finish this step. Reload before trying again.'}},503);}
 };
}
