import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const lines = (await readFile(new URL('data/discover-trees.txt', root), 'utf8')).trim().split('\n').filter(line => !line.startsWith('#'));
const quote = value => `'${value.replaceAll("'", "''")}'`;
const id = key => { const h = createHash('sha256').update(`nudge-discover-v1:${key}`).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };
const rows=[], edges=[];
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
for(let i=0;i<lines.length;i+=8) {
  const [topic, category, namespace] = lines[i].split('|');
  const paths=['root','a','b','aa','ab','ba','bb'];
  for(let j=0;j<7;j++) {
    const [prompt,a,b]=lines[i+j+1].split('|');
    if(!prompt || !a || !b || a===b || prompt.length>180) throw new Error(`Invalid question in ${topic}`);
    const path=paths[j], depth=j===0 ? 0 : j<3 ? 1 : 2;
    const context=JSON.stringify({topic,depth,tree:topic,edition:1,...(depth ? {connection:`A follow-up on ${topic === 'wellbeing' ? 'rest and wellbeing' : topic}.`} : {})});
    rows.push(`(${quote(id(`${topic}:${path}`))}::uuid,(select id from public.preference_categories where slug=${quote(category)}),'this_or_that',${quote(prompt)},${quote(a)},${quote(b)},${quote(`${namespace}.${slug(a)}`)},${quote(`${namespace}.${slug(b)}`)},${quote(context)}::jsonb,${-1000+i+j})`);
    if(depth) edges.push(`(${quote(id(`${topic}:${path}`))}::uuid,${quote(id(`${topic}:${path.length===1 ? 'root' : path[0]}`))}::uuid,${quote(path.at(-1))})`);
  }
}
if(rows.length!==126 || new Set(rows).size!==126) throw new Error('Expected 126 unique questions');
const migration=new URL('supabase/migrations/00004_discover_reliability.sql',root);
const existing=await readFile(migration,'utf8');
const marker='-- Curated topic trees follow; generated reproducibly from data/discover-trees.txt.';
const prefix=existing.slice(0,existing.indexOf(marker)+marker.length);
await writeFile(migration,prefix+`\ninsert into public.questions(id,category_id,kind,prompt,option_a,option_b,maps_to_key_a,maps_to_key_b,context,sort_order) values\n${rows.join(',\n')};\n\ninsert into public.question_branches(child_question_id,parent_question_id,parent_choice) values\n${edges.join(',\n')};\n\ncommit;\n`);
console.log(`Built ${rows.length} questions and ${edges.length} answer-dependent connections.`);
