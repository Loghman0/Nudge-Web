import {it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,appendFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

it('SQL consistency gates fail on missing/stale artifacts without rewriting them',async()=>{
  const parent=resolve(tmpdir());
  const fixture=await mkdtemp(join(parent,'nudge-sql-check-'));
  try {
    await mkdir(join(fixture,'scripts'));
    await mkdir(join(fixture,'supabase','migrations'),{recursive:true});
    const migrations=['00001_baseline.sql','00002_privacy_correctness.sql','00003_memory_decisions_reminders.sql','00004_discover_reliability.sql','00005_public_launch.sql','00006_privacy_boundaries.sql','00007_push_delivery.sql','00008_legacy_signal_contract.sql','00009_decision_meaning_and_topics.sql','00010_ai_usage_ledger.sql','00011_comparison_evidence_and_settings.sql','00012_foundation_questions.sql','00013_reviewed_memories.sql','00014_reviewed_memory_conflicts.sql','00015_self_discovery.sql','00016_discovery_catalog.sql','00017_discovery_privacy.sql','00018_discovery_criterion_provenance.sql','00019_discovery_starter_edition.sql','00020_native_push.sql','00021_native_daily_questions.sql','00022_discovery_decision_priorities.sql'];
    for(const name of migrations)await writeFile(join(fixture,'supabase','migrations',name),`-- synthetic ${name}\nbegin;\nselect 1;\ncommit;\n`);
    for(const script of ['build-setup.mjs','build-release-sql.mjs'])await copyFile(new URL(`../scripts/${script}`,import.meta.url),join(fixture,'scripts',script));
    const run=(script:string,check=false)=>spawnSync(process.execPath,[join(fixture,'scripts',script),...(check?['--check']:[])],{encoding:'utf8',cwd:fixture});
    assert.equal(run('build-setup.mjs',true).status,1);
    assert.equal(run('build-release-sql.mjs',true).status,1);
    await assert.rejects(access(join(fixture,'sql')),'check-only mode must not create output directories');
    for(const script of ['build-setup.mjs','build-release-sql.mjs']){
      const generated=run(script);assert.equal(generated.status,0,generated.stderr);
      const checked=run(script,true);assert.equal(checked.status,0,checked.stderr);
    }
    for(const [file,script] of [['supabase/nudge_complete_setup.sql','build-setup.mjs'],['sql/02_UPDATE_EXISTING.sql','build-release-sql.mjs']]){
      const path=join(fixture,file);await appendFile(path,'-- stale modification\n');
      const before=await readFile(path,'utf8');
      const checked=run(script,true);assert.equal(checked.status,1);assert.match(checked.stderr,/stale/);
      assert.equal(await readFile(path,'utf8'),before,'check must not silently repair tracked SQL');
    }
  } finally {
    const target=resolve(fixture);
    if(!target.startsWith(join(parent,'nudge-sql-check-')))throw new Error('Unexpected temporary fixture path');
    await rm(target,{recursive:true,force:true});
  }
});

