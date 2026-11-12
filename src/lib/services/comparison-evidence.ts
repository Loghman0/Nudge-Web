import type {Preference} from "@/lib/types";
import {reasonsFor,type HistorySignal,type ScoredCandidate} from "./decision-engine";

interface SavedScores {
  scoringRunId?:string;
  options:{label:string;score:number;reasons:string[]}[];
}
/** Equal numeric scores alone do not prove that two revisions used the same evidence. */
export function attachComparisonReasons<T extends SavedScores>(
  saved:T,runId:string,ranked:ScoredCandidate[],preferences:Preference[],history:HistorySignal[],asOf:number
):T {
  if (saved.scoringRunId!==runId) return saved;
  return {...saved,options:saved.options.map(option=>{
    // decision_options.score is PostgreSQL REAL (float32); compare at the
    // stored precision rather than dropping reasons after a normal round-trip.
    const scored=ranked.find(candidate=>candidate.label===option.label&&Math.fround(candidate.score)===Math.fround(option.score));
    return scored?{...option,reasons:reasonsFor(scored,preferences,history,asOf)}:option;
  })};
}
