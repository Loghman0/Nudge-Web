import {isRequestId} from "./comparison-input";
import {postFoundationPath} from "../auth/foundation-path";

export interface OnboardingInput {
  fullName:string; country:string; language:string; age:string; occupation:string; about:string;
  expectedGeneration:number; next:string;
  answers:{questionId:string;answer:"a"|"b"|"skip"}[];
}
type Parsed={value:OnboardingInput;error?:never}|{error:string;value?:never};
/** Construct a bounded input before any account write or optional AI request. */
export function parseOnboardingInput(input:unknown):Parsed {
  if (!input || typeof input!=="object" || Array.isArray(input)) return {error:"Your onboarding details are invalid."};
  const raw=input as Record<string,unknown>;
  const value={} as OnboardingInput;
  if (!Number.isSafeInteger(raw.expectedGeneration) || Number(raw.expectedGeneration)<0) return {error:"Reload the starter questions before saving your answers."};
  value.expectedGeneration=Number(raw.expectedGeneration);
  value.next=postFoundationPath(raw.next);
  const limits={fullName:80,country:60,language:40,age:3,occupation:80,about:2000} as const;
  for (const field of Object.keys(limits) as (keyof typeof limits)[]) {
    if (typeof raw[field]!=="string" || raw[field].length>limits[field]) return {error:"Keep profile details within the indicated limits."};
    value[field]=(raw[field] as string).trim();
  }
  if (value.age && (!/^\d+$/.test(value.age) || Number(value.age)<16 || Number(value.age)>120))
    return {error:"Nudge is for people aged 16 and older. Enter an age from 16 to 120, or leave it blank."};
  if (!Array.isArray(raw.answers) || raw.answers.length>20) return {error:"Your onboarding answers are invalid."};
  value.answers=[];
  const seen=new Set<string>();
  for (const item of raw.answers) {
    if (!item || typeof item!=="object" || Array.isArray(item) || !isRequestId(item.questionId) ||
        !["a","b","skip"].includes(item.answer) || seen.has(item.questionId.toLowerCase()))
      return {error:"Your onboarding answers are invalid."};
    seen.add(item.questionId.toLowerCase());
    value.answers.push({questionId:item.questionId,answer:item.answer});
  }
  return {value};
}
