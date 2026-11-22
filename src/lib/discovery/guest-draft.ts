import {parseAnswersFromCatalog} from './validation';
import {PREVIEW_EDITION,previewQuestionsForEdition} from './preview-catalog';
import type {DiscoveryAnswerInput} from './types';
const SESSION='nudge.discovery.session.v1',SAVED='nudge.discovery.save.v1';
const DAY=86400000;
export interface GuestDiscoveryDraft {version:1;createdAt:number;answers:DiscoveryAnswerInput[];requestId:string;claimGeneration?:number;questionEdition?:number}
export function parseGuestDraft(value:string|null,now=Date.now()):GuestDiscoveryDraft|null{
 if(!value||value.length>16000)return null;
 try{const d=JSON.parse(value);if(d.version!==1||!Number.isFinite(d.createdAt)||d.createdAt>now||now-d.createdAt>DAY||typeof d.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(d.requestId))return null;
  if(d.claimGeneration!==undefined&&(!Number.isSafeInteger(d.claimGeneration)||d.claimGeneration<0))return null;
  if(!Array.isArray(d.answers))return null;
  const versions=new Set(d.answers.map(a=>a.questionVersion));
  const questionEdition=d.questionEdition??(versions.size===1?[...versions][0]:undefined)??PREVIEW_EDITION;
  const questions=previewQuestionsForEdition(questionEdition);if(questions.length!==6)return null;
  const answers=d.answers.length?parseAnswersFromCatalog(d.answers,questions,{previewOnly:true,maxAnswers:6}).value:[];
  if(!answers||answers.some((answer,index)=>answer.questionId!==questions[index]?.id))return null;
  return {version:1,createdAt:d.createdAt,answers,requestId:d.requestId,questionEdition,...(d.claimGeneration!==undefined?{claimGeneration:d.claimGeneration}:{})};
 }catch{return null;}
}
export function readGuestDraft(persisted=false):GuestDiscoveryDraft|null {try{const storage=persisted?localStorage:sessionStorage,key=persisted?SAVED:SESSION,value=parseGuestDraft(storage.getItem(key));if(!value)storage.removeItem(key);return value;}catch{return null;}}
export function writeGuestDraft(draft:GuestDiscoveryDraft,persisted=false){try{(persisted?localStorage:sessionStorage).setItem(persisted?SAVED:SESSION,JSON.stringify(draft));return true;}catch{return false;}}
export function clearGuestDraft(){
 try{sessionStorage.removeItem(SESSION);}catch{/* Clear each store independently if one API is blocked. */}
 try{localStorage.removeItem(SAVED);}catch{/* A blocked storage API has no readable draft. */}
}
