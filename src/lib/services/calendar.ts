/** Stable calendar labels in the account's zone, independent of server locale. */
export function calendarDay(timestamp:string,timeZone:string|null|undefined):{date:string;weekday:number}|null {
  const date=new Date(timestamp);if(!Number.isFinite(date.getTime()))return null;
  let formatter:Intl.DateTimeFormat;
  try {formatter=new Intl.DateTimeFormat('en-US',{timeZone:timeZone||'UTC',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'});}
  catch {formatter=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'});}
  const values=Object.fromEntries(formatter.formatToParts(date).map(part=>[part.type,part.value]));
  return {date:values.year+'-'+values.month+'-'+values.day,weekday:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(values.weekday)};
}

/** Explicit locale/zone make the server and first browser render identical. */
export function journalDate(timestamp:string,timeZone:string|null|undefined='UTC',includeTime=false):string {
  const date=new Date(timestamp);if(!Number.isFinite(date.getTime()))return 'Unknown date';
  const options:Intl.DateTimeFormatOptions={year:'numeric',month:'short',day:'numeric',
    ...(includeTime?{hour:'numeric',minute:'2-digit',timeZoneName:'short'} as const:{})};
  try{return new Intl.DateTimeFormat('en-US',{...options,timeZone:timeZone||'UTC'}).format(date);}
  catch{return new Intl.DateTimeFormat('en-US',{...options,timeZone:'UTC'}).format(date);}
}
