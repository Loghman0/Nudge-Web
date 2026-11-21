// Emits the staged migration for edition three from the authored module so
// database definitions and the generated catalog can never drift apart.
import {writeFile} from 'node:fs/promises';
import {editionThreeQuestions} from './lib/discovery-edition-three.mjs';

const ids=new Set(editionThreeQuestions.map(q=>q.id));
if(ids.size!==editionThreeQuestions.length)throw new Error('Edition three has duplicate IDs.');
const rows=editionThreeQuestions.map(q=>`('${q.id}',${q.version},'${JSON.stringify(q).replace(/'/g,"''")}'::jsonb)`).join(',\n');
const sql=`-- Edition three: ${editionThreeQuestions.length} additive question families (version 1),
-- including three new domains: home, style, nature. Existing definitions and
-- saved answers are untouched. NOT APPLIED YET - owner approval required.
-- Activate in scripts/discovery-build-catalog.mjs (appliedMigrations.editionThree)
-- only after this migration is applied, then regenerate and sync:core.
begin;
insert into public.discovery_question_versions(question_id,version,definition) values
${rows}
on conflict (question_id,version) do nothing;
commit;
`;
await writeFile(new URL('../supabase/migrations/00025_discovery_edition_three.sql',import.meta.url),sql);
console.log(`Wrote 00025 with ${editionThreeQuestions.length} definitions.`);