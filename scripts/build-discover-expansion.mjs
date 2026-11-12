import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const lines=(await readFile(new URL('data/discover-expansion.txt',root),'utf8')).split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const id=key=>{const h=createHash('sha256').update('nudge-discover-v2:'+key).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
if(lines.length%8)throw new Error('Each topic needs a header and seven questions.');
const rows=[],edges=[],ids=new Set(),prompts=new Set(),topics=new Set();
for(let i=0;i<lines.length;i+=8){
  const [topic,category,namespace]=lines[i].split('|');
  if(!/^[a-z]+$/.test(topic)||topics.has(topic)||!category||!namespace)throw new Error('Invalid or duplicate topic header');
  topics.add(topic);
  const paths=['root','a','b','aa','ab','ba','bb'];
  for(let j=0;j<7;j++){
    const [prompt,a,b,...extra]=lines[i+j+1].split('|'),path=paths[j],depth=j===0?0:j<3?1:2,questionId=id(topic+':'+path);
    if(extra.length||!prompt||prompt.length>180||!a||!b||a===b||a.length>80||b.length>80||prompts.has(prompt)||ids.has(questionId))throw new Error('Invalid or duplicate question in '+topic);
    ids.add(questionId);prompts.add(prompt);
    const context=JSON.stringify({topic,tree:topic,depth,edition:2,...(depth?{connection:'A follow-up on '+topic+'.'}:{})});
    rows.push(`(${quote(questionId)}::uuid,(select id from public.preference_categories where slug=${quote(category)}),'this_or_that',${quote(prompt)},${quote(a)},${quote(b)},${quote(namespace+'.'+slug(a))},${quote(namespace+'.'+slug(b))},${quote(context)}::jsonb,${-800+i+j})`);
    if(depth)edges.push(`(${quote(questionId)}::uuid,${quote(id(topic+':'+(path.length===1?'root':path[0])))}::uuid,${quote(path.at(-1))})`);
  }
}
const destination=new URL('supabase/migrations/00009_decision_meaning_and_topics.sql',root);
const existing=await readFile(destination,'utf8');
const marker='-- Context-aware Discover expansion; generated from data/discover-expansion.txt.';
if(!existing.includes(marker))throw new Error('Expansion marker missing; historical migrations will not be changed.');
const expected=existing.slice(0,existing.indexOf(marker)+marker.length)+`\ninsert into public.questions(id,category_id,kind,prompt,option_a,option_b,maps_to_key_a,maps_to_key_b,context,sort_order) values\n${rows.join(',\n')};\n\ninsert into public.question_branches(child_question_id,parent_question_id,parent_choice) values\n${edges.join(',\n')};\n\ncommit;\n`;
if(process.argv.includes('--check')){if(existing!==expected){console.error('Discover expansion SQL is stale. Run node scripts/build-discover-expansion.mjs.');process.exitCode=1;}}
else{await writeFile(destination,expected);console.log('Built '+rows.length+' questions across '+topics.size+' topics, with '+edges.length+' branches.');}
