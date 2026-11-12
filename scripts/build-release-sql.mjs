import {readFile,writeFile,mkdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url),out=new URL('sql/',root);
const check=process.argv.includes('--check');
if(!check)await mkdir(out,{recursive:true});
async function output(path,expected){
  if(!check){await writeFile(path,expected);return;}
  const actual=await readFile(path,'utf8').catch(()=>null);
  if(actual!==expected){console.error('Generated '+path.pathname+' is stale. Run node scripts/build-release-sql.mjs.');process.exitCode=1;}
}
const names=['00001_baseline.sql','00002_privacy_correctness.sql','00003_memory_decisions_reminders.sql','00004_discover_reliability.sql','00005_public_launch.sql','00006_privacy_boundaries.sql','00007_push_delivery.sql','00008_legacy_signal_contract.sql','00009_decision_meaning_and_topics.sql','00010_ai_usage_ledger.sql','00011_comparison_evidence_and_settings.sql','00012_foundation_questions.sql','00013_reviewed_memories.sql','00014_reviewed_memory_conflicts.sql','00015_self_discovery.sql','00016_discovery_catalog.sql','00017_discovery_privacy.sql','00018_discovery_criterion_provenance.sql','00019_discovery_starter_edition.sql','00020_native_push.sql','00021_native_daily_questions.sql','00022_discovery_decision_priorities.sql'];
const parts=await Promise.all(names.map(n=>readFile(new URL(`supabase/migrations/${n}`,root),'utf8')));
await output(new URL('01_FRESH_DATABASE.sql',out),`-- FRESH DATABASE ONLY. Never run this on an existing Nudge installation.\n-- Saved SQL-editor queries are not the database: deleting queries does not reset tables.\ndo $guard$ begin if to_regclass('public.profiles') is not null then raise exception 'Existing Nudge data found. Use 02_UPDATE_EXISTING.sql instead.'; end if; end $guard$;\n\n`+parts.join('\n\n'));
const conditions=["not exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='memory_generation')","not exists(select 1 from information_schema.columns where table_schema='public' and table_name='decisions' and column_name='comparison_revision')","to_regclass('public.question_branches') is null","not exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='ai_enabled')","to_regprocedure('nudge_private.privacy_boundaries_version()') is null","to_regprocedure('nudge_private.push_delivery_version()') is null","to_regprocedure('nudge_private.signal_contract_version()') is null","to_regprocedure('nudge_private.decision_meaning_topics_version()') is null","to_regprocedure('nudge_private.ai_usage_ledger_version()') is null","to_regprocedure('nudge_private.comparison_evidence_settings_version()') is null","to_regprocedure('nudge_private.foundation_questions_version()') is null","to_regprocedure('nudge_private.reviewed_memories_version()') is null","to_regprocedure('nudge_private.reviewed_memory_conflicts_version()') is null","to_regprocedure('nudge_private.self_discovery_version()') is null","to_regprocedure('nudge_private.discovery_catalog_version()') is null","to_regprocedure('nudge_private.self_discovery_privacy_version()') is null","to_regprocedure('nudge_private.discovery_criterion_provenance_version()') is null","to_regprocedure('nudge_private.discovery_starter_edition_version()') is null","to_regprocedure('nudge_private.native_push_version()') is null","to_regprocedure('nudge_private.native_daily_questions_version()') is null","to_regprocedure('nudge_private.discovery_decision_priorities_version()') is null"];
let update=`-- EXISTING NUDGE INSTALLATIONS: run only this file. Back up first.\n-- Detects and applies missing 00002..00022 updates in order. Does not replay baseline or erase journal data.\n-- 00006 removes orphan analytics events and retires aliases of forgotten beliefs.\n-- 00017 removes orphan discovery sources and gates unreviewed formats.\n-- You can delete obsolete saved SQL-editor tabs after keeping this file; do not delete tables/schemas.\nbegin;\ndo $update$\nbegin\n  if to_regclass('public.profiles') is null or to_regclass('public.knowledge_nodes') is null or to_regclass('public.questions') is null then\n    raise exception 'This is not a supported baseline. Use 01_FRESH_DATABASE.sql for a fresh project.';\n  end if;\n`;
for(let i=1;i<parts.length;i++){
 const sql=parts[i].replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'');
 update+=`  if ${conditions[i-1]} then\n    execute $migration_${i+1}$\n${sql}\n$migration_${i+1}$;\n  end if;\n`;
}
update+=`  if to_regprocedure('public.save_reviewed_memories(uuid,jsonb,integer)') is null or to_regprocedure('public.create_comparison_with_evidence(uuid,jsonb,public.decision_category,text,jsonb,text,jsonb,integer,jsonb)') is null or to_regprocedure('public.rerank_comparison_with_evidence(uuid,integer,jsonb,jsonb,integer,jsonb)') is null or to_regprocedure('public.read_my_comparison_evidence(uuid)') is null or to_regprocedure('public.export_my_comparison_evidence(integer)') is null or to_regprocedure('public.get_comparison_settings_state()') is null or to_regprocedure('public.save_comparison_setting(uuid,text,text,public.decision_category,text,jsonb,integer)') is null or to_regprocedure('public.delete_comparison_setting(uuid,integer)') is null or to_regprocedure('public.reserve_ai_usage_attempt(uuid,uuid,text,text,text,integer,bigint,bigint,bigint)') is null or to_regprocedure('public.finish_ai_usage_attempt(uuid,uuid,text,bigint,bigint,bigint)') is null or to_regprocedure('public.export_my_ai_usage()') is null or to_regprocedure('public.discover_next_question(text)') is null or to_regprocedure('public.reserve_ai_request(text)') is null or to_regprocedure('public.create_circle_poll(uuid,text,jsonb)') is null or to_regprocedure('public.create_comparison_once(uuid,jsonb,public.decision_category,text,jsonb,text,jsonb,integer)') is null then raise exception 'Incomplete schema detected. No update was committed; restore/review the missing functions.'; end if;\nend $update$;\nnotify pgrst,'reload schema';\ncommit;\n`;
await output(new URL('02_UPDATE_EXISTING.sql',out),update);
await output(new URL('03_VERIFY_DATABASE.sql',out),`-- Read-only. Run after your selected setup/update file. All result values should be true.
select
  to_regprocedure('nudge_private.discovery_decision_priorities_version()') is not null as discovery_decision_priorities,
  to_regprocedure('nudge_private.discovery_starter_edition_version()') is not null and (select count(*)=6 from public.discovery_question_versions where version=2 and definition->>'preview'='true') as discovery_starter_edition,
  to_regprocedure('nudge_private.self_discovery_privacy_version()') is not null as discovery_privacy,
  to_regprocedure('nudge_private.discovery_criterion_provenance_version()') is not null as discovery_criterion_provenance,
  (select relrowsecurity from pg_class where oid='nudge_private.discovery_rollout'::regclass)
    and not has_table_privilege('authenticated','nudge_private.discovery_rollout','select,insert,update,delete') as discovery_rollout_operator_only,
  to_regprocedure('nudge_private.self_discovery_version()') is not null and to_regprocedure('nudge_private.discovery_catalog_version()') is not null as self_discovery,
  to_regprocedure('nudge_private.foundation_questions_version()') is not null
    and (select count(*)=6 from public.questions where is_active and is_onboarding and context->>'foundationEdition'='1') as foundation_catalog,
  to_regprocedure('nudge_private.reviewed_memory_conflicts_version()') is not null as memory_conflicts_return_promptly,
  to_regprocedure('nudge_private.reviewed_memories_version()') is not null
    and exists(select 1 from information_schema.columns where table_schema='public' and table_name='ai_memories' and column_name='reviewed_at') as reviewed_memories,
  has_function_privilege('authenticated','public.save_reviewed_memories(uuid,jsonb,integer)','execute')
    and not has_function_privilege('anon','public.save_reviewed_memories(uuid,jsonb,integer)','execute')
    and not has_function_privilege('authenticated','public.save_ai_memories(jsonb,integer,uuid)','execute') as explicit_memory_review_only,
  (select relrowsecurity from pg_class where oid='nudge_private.reviewed_memory_requests'::regclass)
    and not has_table_privilege('authenticated','nudge_private.reviewed_memory_requests','select,insert,update,delete')
    and exists(select 1 from pg_trigger where tgrelid='public.profiles'::regclass and tgname='profiles_purge_memory_reviews' and not tgisinternal) as memory_review_privacy,
  to_regprocedure('nudge_private.comparison_evidence_settings_version()') is not null as comparison_evidence_settings,
  has_function_privilege('authenticated','public.create_comparison_with_evidence(uuid,jsonb,public.decision_category,text,jsonb,text,jsonb,integer,jsonb)','execute')
    and not has_function_privilege('anon','public.create_comparison_with_evidence(uuid,jsonb,public.decision_category,text,jsonb,text,jsonb,integer,jsonb)','execute')
    and has_function_privilege('authenticated','public.rerank_comparison_with_evidence(uuid,integer,jsonb,jsonb,integer,jsonb)','execute')
    and not has_function_privilege('anon','public.rerank_comparison_with_evidence(uuid,integer,jsonb,jsonb,integer,jsonb)','execute') as comparison_atomic_owner_writes,
  has_function_privilege('authenticated','public.read_my_comparison_evidence(uuid)','execute')
    and has_function_privilege('authenticated','public.export_my_comparison_evidence(integer)','execute')
    and has_function_privilege('authenticated','public.get_comparison_settings_state()','execute')
    and has_function_privilege('authenticated','public.save_comparison_setting(uuid,text,text,public.decision_category,text,jsonb,integer)','execute')
    and has_function_privilege('authenticated','public.delete_comparison_setting(uuid,integer)','execute')
    and not has_function_privilege('anon','public.read_my_comparison_evidence(uuid)','execute')
    and not has_function_privilege('anon','public.export_my_comparison_evidence(integer)','execute')
    and not has_function_privilege('anon','public.get_comparison_settings_state()','execute')
    and not has_function_privilege('anon','public.save_comparison_setting(uuid,text,text,public.decision_category,text,jsonb,integer)','execute')
    and not has_function_privilege('anon','public.delete_comparison_setting(uuid,integer)','execute') as comparison_settings_owner_access,
  (select bool_and(relrowsecurity) from pg_class where oid in ('nudge_private.comparison_evidence'::regclass,'nudge_private.comparison_settings'::regclass))
    and not has_table_privilege('authenticated','nudge_private.comparison_evidence','insert,update,delete')
    and not has_table_privilege('authenticated','nudge_private.comparison_settings','insert,update,delete') as comparison_derivatives_private,
  exists(select 1 from pg_trigger where tgrelid='public.profiles'::regclass and tgname='profiles_purge_comparison_derivatives' and not tgisinternal) as comparison_privacy_invalidation,
  to_regprocedure('nudge_private.ai_usage_ledger_version()') is not null as ai_usage_ledger,
  not has_function_privilege('anon','public.reserve_ai_usage_attempt(uuid,uuid,text,text,text,integer,bigint,bigint,bigint)','execute')
    and not has_function_privilege('authenticated','public.reserve_ai_usage_attempt(uuid,uuid,text,text,text,integer,bigint,bigint,bigint)','execute')
    and has_function_privilege('service_role','public.reserve_ai_usage_attempt(uuid,uuid,text,text,text,integer,bigint,bigint,bigint)','execute')
    and not has_function_privilege('anon','public.finish_ai_usage_attempt(uuid,uuid,text,bigint,bigint,bigint)','execute')
    and not has_function_privilege('authenticated','public.finish_ai_usage_attempt(uuid,uuid,text,bigint,bigint,bigint)','execute')
    and has_function_privilege('service_role','public.finish_ai_usage_attempt(uuid,uuid,text,bigint,bigint,bigint)','execute') as ai_usage_service_only,
  has_function_privilege('authenticated','public.export_my_ai_usage()','execute')
    and not has_function_privilege('anon','public.export_my_ai_usage()','execute') as ai_usage_owner_export,
  (select bool_and(relrowsecurity) from pg_class where oid in ('nudge_private.ai_usage_attempts'::regclass,'nudge_private.ai_usage_daily_totals'::regclass)) as ai_usage_rls,
  to_regclass('public.question_branches') is not null as discover_branches,
  to_regprocedure('public.discover_other_topic(text)') is not null as discover_topic_switch,
  to_regprocedure('nudge_private.decision_meaning_topics_version()') is not null as decision_meaning_scopes,
  to_regprocedure('public.discover_next_question(text)') is not null as discover_queue,
  to_regprocedure('public.refresh_my_verifications()') is not null as quick_checks,
  to_regprocedure('public.accept_legal_terms(text,boolean)') is not null as terms_records,
  to_regprocedure('public.set_ai_enabled(boolean)') is not null as ai_choice,
  to_regprocedure('public.reserve_ai_request(text)') is not null as durable_ai_limits,
  to_regprocedure('public.create_circle(text)') is not null as atomic_circles,
  to_regprocedure('public.create_circle_poll(uuid,text,jsonb)') is not null as atomic_polls,
  to_regprocedure('nudge_private.privacy_boundaries_version()') is not null as privacy_boundaries_repaired,
  to_regprocedure('public.create_comparison_once(uuid,jsonb,public.decision_category,text,jsonb,text,jsonb,integer)') is not null as durable_comparison_retries,
  to_regprocedure('nudge_private.push_delivery_version()') is not null as durable_push_delivery,
  not has_function_privilege('anon','public.claim_push_deliveries(integer)','execute')
    and not has_function_privilege('authenticated','public.claim_push_deliveries(integer)','execute')
    and has_function_privilege('service_role','public.claim_push_deliveries(integer)','execute') as push_claims_service_only,
  not has_function_privilege('anon','public.create_circle(text)','execute')
    and not has_function_privilege('anon','public.erase_learned_memory()','execute')
    and not has_function_privilege('anon','public.correct_knowledge_node(uuid,public.preference_polarity,text)','execute') as anonymous_writes_blocked,
  exists(select 1 from pg_constraint where conrelid='public.analytics_events'::regclass
    and conname='analytics_events_user_id_fkey' and confdeltype='c') as analytics_delete_cascades,
  to_regprocedure('nudge_private.signal_contract_version()') is not null and to_regprocedure('public.record_knowledge_signal(text,text,text,public.preference_polarity,text,real,text,uuid,uuid,boolean,jsonb)') is null as signal_contract_unambiguous,
  not has_table_privilege('authenticated','public.group_poll_votes','insert') as votes_use_guarded_rpc,
  (select bool_and(relrowsecurity) from pg_class where oid in ('public.profiles'::regclass,'public.decisions'::regclass,'public.knowledge_nodes'::regclass,'public.group_poll_votes'::regclass,'nudge_private.comparison_requests'::regclass,'nudge_private.push_deliveries'::regclass)) as private_tables_use_rls;
`);
if(!check)console.log('Built guarded fresh setup, existing update and read-only verification SQL.');
else if(!process.exitCode)console.log('Generated release SQL is current.');

