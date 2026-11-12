-- Read-only. Run after your selected setup/update file. All result values should be true.
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
