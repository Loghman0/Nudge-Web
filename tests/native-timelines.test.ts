import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {decisionActivity,preferenceTimeline,type TimelinePreference} from '../src/lib/services/native-timelines';
import {createToolsHandler} from '../src/lib/api/v1/tools-route';

const asOf=Date.parse('2026-11-09T12:00:00.000Z'),week=604800000,owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const preference=(n:number,created:string,reinforced:string|null=null):TimelinePreference&{user_id:string;[key:string]:unknown}=>({id:id(n),key:`hobby.option-${n}`,value:null,polarity:'like',source:'explicit',created_at:created,last_reinforced_at:reinforced,user_id:owner});

describe('bounded native timeline summaries',()=>{
 it('uses exact rolling boundaries and excludes future/outside-window dates',()=>{
  const start=asOf-12*week,rows=[start-1,start,start+week,asOf-1,asOf,asOf+1].map(value=>({created_at:new Date(value).toISOString()}));
  const value=decisionActivity(rows,asOf,'Asia/Baku');
  assert.equal(value.period,'rolling_seven_days');assert.equal(value.timeZone,'Asia/Baku');assert.equal(value.buckets.length,12);assert.equal(value.buckets[0].count,1);assert.equal(value.buckets[1].count,1);assert.equal(value.buckets[11].count,1);assert.equal(value.buckets.reduce((sum,b)=>sum+b.count,0),3);assert.equal(value.windowEndExclusive,value.asOf);assert.equal(value.sampleSize,6);
  for(let index=0;index<12;index++){assert.equal(Date.parse(value.buckets[index].endExclusive)-Date.parse(value.buckets[index].start),week);if(index)assert.equal(value.buckets[index].start,value.buckets[index-1].endExclusive);}
 });
 it('makes capped samples explicit and handles DST weekdays without claiming calendar weeks',()=>{
  const value=decisionActivity([{created_at:'2026-11-01T05:30:00Z'},{created_at:'2026-11-01T06:30:00Z'}],asOf,'America/New_York');assert.equal(value.weekdays[0].count,2);assert.equal(value.sampleCapped,false);
  const capped=decisionActivity(Array.from({length:251},()=>({created_at:'2026-11-08T00:00:00Z'})),asOf,'Invalid/Zone');assert.equal(capped.timeZone,'UTC');assert.equal(capped.sampleSize,250);assert.equal(capped.sampleCapped,true);assert.equal(capped.buckets.reduce((sum,b)=>sum+b.count,0),250);
  assert.deepEqual(decisionActivity([],asOf,null).buckets.map(b=>b.count),Array(12).fill(0));assert.throws(()=>decisionActivity([],NaN,'UTC'));
 });
 it('merges reinforced and created timestamps, excludes discovery, and returns only six recent preferences',()=>{
  const reinforced=[preference(11,'2020-01-01T00:00:00Z','2026-11-08T00:00:00Z'),preference(12,'2020-01-01T00:00:00Z','2026-11-01T00:00:00Z')];
  const plain=Array.from({length:6},(_,index)=>preference(20+index,`2026-11-0${8-index}T01:00:00Z`));
  const value=preferenceTimeline([...reinforced,{...reinforced[0],id:id(99),key:'discovery.private'}],[...plain,{...plain[0],id:id(98),created_at:'2027-01-01T00:00:00Z'},plain[0]],asOf,'UTC');
  assert.equal(value.items.length,6);assert.equal(value.limit,6);assert.equal(value.items[0].id,id(20));assert.equal(value.items[1].id,id(11));assert.equal(value.items[0].label,'option 20');assert.equal(value.items[1].occurredAt,reinforced[0].last_reinforced_at);assert.equal(new Set(value.items.map(item=>item.id)).size,6);assert.ok(value.items.every(item=>!item.key.startsWith('discovery.')));
 });
 it('uses deterministic ID order for equal dates and preserves recorded versus reinforced meaning',()=>{
  const date='2026-11-08T00:00:00Z',value=preferenceTimeline([preference(12,date,date)],[preference(11,date)],asOf,'UTC');assert.deepEqual(value.items.map(item=>item.id),[id(11),id(12)]);assert.equal(value.items[0].reinforcedAt,null);assert.equal(value.items[1].reinforcedAt,date);
 });
});

type Row=Record<string,unknown>;
function routeFixture(unauthenticated=false,failPreferences=false,regrets?:Array<boolean|null>){
 const calls:{table:string;operations:{name:string;args:unknown[]}[]}[]=[];
 const preferences:Row[]=[...Array.from({length:8},(_,n)=>preference(10+n,`2026-11-0${8-Math.min(n,7)}T00:00:00Z`)),{...preference(30,'2020-01-01T00:00:00Z','2026-11-08T12:00:00Z')},{...preference(31,'2026-11-09T00:00:00Z'),key:'discovery.hidden'},{...preference(32,'2026-11-09T00:00:00Z'),user_id:other}];
 const decisions:Row[]=[{id:id(50),user_id:owner,created_at:'2026-11-08T00:00:00Z',category:'hobbies',question:'Which activity?',status:'open',selected_option_id:null,decision_options:[],decision_reflections:null},{id:id(51),user_id:other,created_at:'2026-11-08T00:00:00Z',category:'work',question:'Other owner',status:'open',selected_option_id:null,decision_options:[],decision_reflections:null}];
 if(regrets)for(const [index,has_regrets] of regrets.entries())decisions.push({id:id(60+index),user_id:owner,created_at:'2026-11-08T00:00:00Z',category:'work',question:'Recorded choice',status:'reflected',selected_option_id:null,decision_options:[],decision_reflections:{rating:4,has_regrets}});
 const client={from(table:string){const operations:{name:string;args:unknown[]}[]=[];calls.push({table,operations});
  const execute=()=>{let rows:Row[]=table==='preferences'?preferences:table==='decisions'?decisions:[{id:owner,timezone:'Asia/Baku'}];const orders:{key:string;ascending:boolean}[]=[];let limit=Infinity;
   for(const operation of operations){const [key,value,third]=operation.args;if(operation.name==='eq')rows=rows.filter(row=>row[String(key)]===value);if(operation.name==='lte')rows=rows.filter(row=>Date.parse(String(row[String(key)]))<=Date.parse(String(value)));if(operation.name==='is')rows=rows.filter(row=>row[String(key)]===value);if(operation.name==='not')rows=rows.filter(row=>value==='is'?row[String(key)]!==third:!String(row[String(key)]).startsWith('discovery.'));if(operation.name==='order')orders.push({key:String(key),ascending:(value as {ascending?:boolean}|undefined)?.ascending!==false});if(operation.name==='limit')limit=Number(key);}
   rows=[...rows].sort((a,b)=>{for(const order of orders){const result=String(a[order.key]).localeCompare(String(b[order.key]));if(result)return order.ascending?result:-result;}return 0;}).slice(0,limit);return {data:rows,error:table==='preferences'&&failPreferences?{code:'failed'}:null};};
  const builder={select:(...args:unknown[])=>{operations.push({name:'select',args});return builder;},eq:(...args:unknown[])=>{operations.push({name:'eq',args});return builder;},lte:(...args:unknown[])=>{operations.push({name:'lte',args});return builder;},not:(...args:unknown[])=>{operations.push({name:'not',args});return builder;},is:(...args:unknown[])=>{operations.push({name:'is',args});return builder;},order:(...args:unknown[])=>{operations.push({name:'order',args});return builder;},limit:(...args:unknown[])=>{operations.push({name:'limit',args});return builder;},single:async()=>{const value=execute();return {...value,data:value.data[0]??null};},then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(execute()).then(resolve)};return builder;
 },rpc:()=>{throw new Error('Timeline reads must not call mutation RPCs');}};
 const authenticate=async()=>unauthenticated?{ok:false,status:401,code:'unauthenticated',message:'Sign in.'}:{ok:true,userId:owner,client};
 const handler=createToolsHandler(authenticate as never,{now:()=>asOf});return {calls,read:(path:string)=>handler(new Request(`https://nudge.test/api/v1/tools/${path}?user_id=${other}`),{params:Promise.resolve({path:[path]})})};
}
describe('native timeline read adapters',()=>{
 it('keeps unanswered regret fields out of the answered regret rate',async()=>{
  for(const [answers,expected] of [[[true,null],1],[[null,null],null],[[true,false,null],0.5]] as const){const fixture=routeFixture(false,false,[...answers]);const response=await fixture.read('outcomes'),value=await response.json();assert.equal(response.status,200);assert.equal(value.regretRate,expected);assert.equal(value.reflectionCount,answers.length);}
 });
 it('authenticates before reads, scopes both preference branches, and bounds each query before merging',async()=>{
  const denied=routeFixture(true);assert.equal((await denied.read('timeline')).status,401);assert.equal(denied.calls.length,0);
  const fixture=routeFixture(),response=await fixture.read('timeline'),value=await response.json();assert.equal(response.status,200);assert.match(response.headers.get('cache-control')!,/private.*no-store/);assert.equal(value.items.length,6);assert.equal(value.items[0].id,id(30));assert.ok(value.items.every((item:{id:string;key:string})=>item.id!==id(32)&&!item.key.startsWith('discovery.')));
  const queries=fixture.calls.filter(call=>call.table==='preferences');assert.equal(queries.length,2);for(const query of queries){assert.ok(query.operations.some(op=>op.name==='eq'&&op.args[0]==='user_id'&&op.args[1]===owner));assert.ok(query.operations.some(op=>op.name==='not'&&op.args[0]==='key'&&op.args[2]==='discovery.%'));assert.ok(query.operations.some(op=>op.name==='limit'&&op.args[0]===6));}assert.ok(queries[0].operations.some(op=>op.name==='not'&&op.args[0]==='last_reinforced_at'));assert.ok(queries[1].operations.some(op=>op.name==='is'&&op.args[0]==='last_reinforced_at'));
 });
 it('adds explicit bounded activity without changing existing outcome fields or crossing owners',async()=>{
  const fixture=routeFixture(),response=await fixture.read('outcomes'),value=await response.json();assert.equal(response.status,200);assert.equal(value.sampleSize,1);assert.equal(value.averageRating,null);assert.equal(value.activity.timeZone,'Asia/Baku');assert.equal(value.activity.asOf,new Date(asOf).toISOString());assert.equal(value.activity.buckets.reduce((sum:number,b:{count:number})=>sum+b.count,0),1);const query=fixture.calls.find(call=>call.table==='decisions')!;assert.ok(query.operations.some(op=>op.name==='limit'&&op.args[0]===250));assert.ok(query.operations.some(op=>op.name==='eq'&&op.args[0]==='user_id'&&op.args[1]===owner));
 });
 it('does not manufacture an empty timeline when a backing query fails',async()=>{const response=await routeFixture(false,true).read('timeline');assert.equal(response.status,503);const body=await response.json();assert.ok(body.error);assert.equal(body.items,undefined);});
});
