import type {createApiAuthenticator} from './auth';
import {parseOnboardingInput} from '@/lib/services/onboarding-input';
type Auth=ReturnType<typeof createApiAuthenticator>;
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
class FoundationError extends Error{constructor(public status:number,public code:string,message:string){super(message);}}
function fail(status:number,code:string,message:string):never{throw new FoundationError(status,code,message);}
function check(error:unknown){if(error)fail(503,'unavailable','Could not load the earlier starter preferences. Try again.');}
/** Optional legacy foundation: never a substitute for or gate before current discovery. */
export function createFoundationHandler(authenticate:Auth){return async(request:Request)=>{
 try{
  const identity=await authenticate(request);if(!identity.ok)return reply({error:{code:identity.code,message:identity.message}},identity.status);
  const {client:db,userId}=identity;
  const [profile,catalog]=await Promise.all([
   db.from('profiles').select('onboarded_at,memory_generation').eq('id',userId).single(),
   db.from('questions').select('id,prompt,option_a,option_b,context').eq('is_onboarding',true).eq('is_active',true).eq('context->>foundationEdition','1').order('sort_order').order('id').limit(6),
  ]);check(profile.error);check(catalog.error);if(!profile.data)fail(404,'not_found','Account not found.');
  const questions=catalog.data??[];
  if(request.method==='GET'){
   const [answers,earned]=await Promise.all([
    questions.length?db.from('question_answers').select('question_id,answer').eq('user_id',userId).in('question_id',questions.map(q=>q.id)):Promise.resolve({data:[],error:null}),
    db.from('user_achievements').select('achievement_slug,earned_at,achievements(title,description)').eq('user_id',userId).order('earned_at',{ascending:false}).limit(50),
   ]);check(answers.error);check(earned.error);
   const saved=new Map((answers.data??[]).map(a=>[a.question_id,a.answer]));
   return reply({generation:profile.data!.memory_generation,completed:profile.data!.onboarded_at!==null,available:questions.length===6,
    questions:questions.length===6?questions.map(q=>{const c=q.context&&typeof q.context==='object'&&!Array.isArray(q.context)?q.context:{};return {id:q.id,prompt:q.prompt,optionA:q.option_a,optionB:q.option_b,rationale:typeof c.starterRationale==='string'?c.starterRationale:'This describes this situation only.',saved:saved.get(q.id)??null};}):[],
    milestones:(earned.data??[]).flatMap(row=>{const item=Array.isArray(row.achievements)?row.achievements[0]:row.achievements;return item?[{id:row.achievement_slug,title:item.title,description:item.description,earnedAt:row.earned_at}]:[];})});
  }
  if(request.method!=='POST')return reply({error:{code:'method_not_allowed',message:'Use the displayed starter action.'}},405);
  if(request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')fail(415,'invalid_request','Send the reviewed answers as JSON.');
  const reader=request.body?.getReader();if(!reader)fail(400,'invalid_request','Review these answers before saving.');let size=0;const chunks:Uint8Array[]=[];
  try{while(true){const part=await reader!.read();if(part.done)break;size+=part.value.length;if(size>4096){await reader!.cancel();fail(413,'too_large','These starter answers are too long.');}chunks.push(part.value);}}finally{reader!.releaseLock();}
  let value:Record<string,unknown>;
  try{const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.length;}const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();value=parsed;}catch{fail(400,'invalid_request','Review these answers before saving.');}
  if(Object.keys(value!).some(key=>!['expectedGeneration','answers'].includes(key)))fail(400,'invalid_request','Only reviewed starter answers can be saved here.');
  const parsed=parseOnboardingInput({...value!,fullName:'',country:'',language:'',age:'',occupation:'',about:'',next:'/dashboard'});
  if(!parsed.value||parsed.value.answers.length>6)fail(400,'invalid_request',parsed.error??'Review these starter answers.');
  if(questions.length!==6||parsed.value!.answers.some(a=>!questions.some(q=>q.id===a.questionId)))fail(409,'changed','The starter questions changed. Reload before saving.');
  const result=await db.rpc('complete_onboarding',{p_profile:{},p_answers:parsed.value!.answers.map(a=>({...a})),p_expected_generation:parsed.value!.expectedGeneration});
  if(result.error){if(/generation|memory changed|already has a saved answer/i.test(result.error.message))fail(409,'changed','Your memory or earlier answer changed. Reload before saving.');fail(503,'unavailable','Could not confirm this save. Reload before making another change.');}
  if(!Number.isSafeInteger(result.data)||result.data===null)fail(503,'unavailable','Could not confirm this save. Reload before making another change.');
  return reply({saved:true,generation:result.data});
 }catch(error){if(error instanceof FoundationError)return reply({error:{code:error.code,message:error.message}},error.status);return reply({error:{code:'unavailable',message:'Could not finish this starter step. Reload before trying again.'}},503);}
};}
