import {calendarDay} from './calendar';

export const ACTIVITY_SAMPLE_LIMIT=250;
export const PREFERENCE_TIMELINE_LIMIT=6;
const PERIOD_MS=7*24*60*60*1000;
const PERIOD_COUNT=12;

export function timelineTimeZone(value:string|null|undefined):string{
 try{const zone=value||'UTC';new Intl.DateTimeFormat('en-US',{timeZone:zone}).format(0);return zone;}
 catch{return 'UTC';}
}

/** Rolling elapsed-time periods, not local calendar weeks. Boundaries are
 * explicit so DST cannot silently change which records belong to a period. */
export function decisionActivity(rows:readonly {created_at:string}[],asOf:number,timeZone:string|null|undefined){
 if(!Number.isFinite(asOf))throw new Error('A valid activity cutoff is required.');
 const zone=timelineTimeZone(timeZone),start=asOf-PERIOD_COUNT*PERIOD_MS;
 const buckets=Array.from({length:PERIOD_COUNT},(_,index)=>({start:new Date(start+index*PERIOD_MS).toISOString(),endExclusive:new Date(start+(index+1)*PERIOD_MS).toISOString(),count:0}));
 const weekdays=Array.from({length:7},(_,weekday)=>({weekday,count:0}));
 for(const row of rows.slice(0,ACTIVITY_SAMPLE_LIMIT)){
  const timestamp=Date.parse(row.created_at);if(!Number.isFinite(timestamp)||timestamp<start||timestamp>=asOf)continue;
  buckets[Math.floor((timestamp-start)/PERIOD_MS)].count++;
  const day=calendarDay(row.created_at,zone);if(day&&day.weekday>=0)weekdays[day.weekday].count++;
 }
 return {asOf:new Date(asOf).toISOString(),timeZone:zone,sampleLimit:ACTIVITY_SAMPLE_LIMIT,sampleSize:Math.min(rows.length,ACTIVITY_SAMPLE_LIMIT),sampleCapped:rows.length>=ACTIVITY_SAMPLE_LIMIT,period:'rolling_seven_days' as const,windowStart:buckets[0].start,windowEndExclusive:new Date(asOf).toISOString(),buckets,weekdays};
}

export interface TimelinePreference{
 id:string;key:string;value:string|null;polarity:'like'|'dislike'|'neutral';source:'explicit'|'inferred'|'reflected';created_at:string;last_reinforced_at:string|null;
}

/** Each query supplies its six newest entries. The union is sufficient to
 * select the six newest coalesced timestamps without strength-based bias. */
export function preferenceTimeline(reinforced:readonly TimelinePreference[],unreinforced:readonly TimelinePreference[],asOf:number,timeZone:string|null|undefined){
 if(!Number.isFinite(asOf))throw new Error('A valid timeline cutoff is required.');
 const unique=new Map<string,TimelinePreference>();
 for(const row of [...reinforced,...unreinforced]){
  const created=Date.parse(row.created_at),occurred=Date.parse(row.last_reinforced_at??row.created_at);
  if(row.key.startsWith('discovery.')||!Number.isFinite(created)||!Number.isFinite(occurred)||created>asOf||occurred>asOf)continue;
  if(!unique.has(row.id))unique.set(row.id,row);
 }
 const items=[...unique.values()].sort((a,b)=>Date.parse(b.last_reinforced_at??b.created_at)-Date.parse(a.last_reinforced_at??a.created_at)||a.id.localeCompare(b.id)).slice(0,PREFERENCE_TIMELINE_LIMIT).map(row=>({id:row.id,key:row.key,label:row.value?.trim()?row.value:(row.key.split('.').pop()??row.key).replace(/[-_]/g,' '),polarity:row.polarity,source:row.source,createdAt:row.created_at,reinforcedAt:row.last_reinforced_at,occurredAt:row.last_reinforced_at??row.created_at}));
 return {asOf:new Date(asOf).toISOString(),timeZone:timelineTimeZone(timeZone),limit:PREFERENCE_TIMELINE_LIMIT,items};
}
