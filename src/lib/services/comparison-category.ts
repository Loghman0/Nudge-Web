import type {DecisionCategory} from '@/lib/types';
/** English heuristic only. Match words so "team" does not become "tea". */
export function guessDecisionCategory(labels:string[]):DecisionCategory {
 const text=labels.join(' ').toLowerCase();
 const patterns: [DecisionCategory,RegExp][]=[
  ['food',/\b(eat|food|dinner|lunch|breakfast|restaurant|pizza|sushi|burger|ramen|cook|coffee|tea|drink|kebab|pasta|salad)\b/],
  ['entertainment',/\b(watch|movie|film|series|show|listen|concert|cinema|episode|album)\b/],
  ['travel',/\b(travel|trip|visit|holiday|vacation|flight|hotel|beach|mountain|abroad)\b/],
  ['finance',/\b(invest|saving|savings|budget|loan|rent or buy|deposit|stocks|crypto)\b/],
  ['shopping',/\b(buy|purchase|shop|gift|order|phone|laptop|shoes|jacket|price)\b/],
  ['career',/\b(job|career|interview|salary|promotion|resign|study|course|degree|certification)\b/],
  ['work',/\b(work|boss|meeting|deadline|client|task)\b/],
  ['health',/\b(gym|workout|run|yoga|diet|doctor|sleep|health|therapy|checkup)\b/],
  ['relationships',/\b(friend|party|date|family|invite|wedding|relationship|partner)\b/],
  ['hobbies',/\b(paint|draw|guitar|piano|hobby|craft|garden|photography|chess|game|play|book|read)\b/],
  ['lifestyle',/\b(walk|nap|habit|routine|declutter|move house|apartment)\b/],
 ];
 return patterns.find(([,pattern])=>pattern.test(text))?.[0]??'other';
}
