-- Private provenance for owner-confirmed discovery criterion suggestions.
begin;
create function nudge_private.validate_comparison_evidence_v1(p_evidence jsonb,p_decision_id uuid,p_generation integer)
returns void language plpgsql security definer set search_path='' as $$
declare d public.decisions%rowtype; o jsonb; saved public.decision_options%rowtype; item jsonb;
  position integer:=0; config jsonb; weights jsonb; counts jsonb; sources jsonb; breakdown jsonb;
begin
  select * into d from public.decisions where id=p_decision_id and user_id=auth.uid();
  if not found then raise exception 'Comparison not found'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) is distinct from 'object' or octet_length(p_evidence::text)>131072
    or (p_evidence-array['version','scoringRunId','scoredAt','basis','engineVersion','engineConfig','confidence','coldStart','evidenceState','options'])<>'{}'::jsonb
    or p_evidence->'version' is distinct from '1'::jsonb or p_evidence->'engineVersion' is distinct from '2'::jsonb
    or jsonb_typeof(p_evidence->'scoringRunId') is distinct from 'string'
    or (p_evidence->>'scoringRunId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_evidence->'scoredAt') is distinct from 'string' or length(p_evidence->>'scoredAt')>40
    or (p_evidence->>'scoredAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.]\d{1,6})?Z$'
    or coalesce(p_evidence->>'basis','') not in ('journal','criteria')
    or coalesce(p_evidence->>'confidence','') not in ('high','medium','low')
    or jsonb_typeof(p_evidence->'coldStart') is distinct from 'boolean'
    or coalesce(p_evidence->>'evidenceState','') not in ('personal_fit','insufficient')
    or jsonb_typeof(p_evidence->'options') is distinct from 'array' then raise exception 'Invalid comparison evidence'; end if;
  if p_evidence->>'scoringRunId' is distinct from d.context->>'scoring_run_id'
    or p_evidence->>'scoredAt' is distinct from d.context->>'scored_at'
    or p_evidence->>'basis' is distinct from (case when d.context->>'comparisonBasis'='criteria' then 'criteria' else 'journal' end)
    or p_evidence->>'confidence' is distinct from d.context->>'confidence'
    or p_evidence->'coldStart' is distinct from d.context->'cold_start'
    or p_evidence->>'evidenceState' is distinct from d.context->>'evidence_state'
    or d.context->'engine_version' is distinct from '2'::jsonb
    or p_generation is distinct from (select memory_generation from public.profiles where id=auth.uid()) then
    raise exception 'Comparison evidence does not match the saved run'; end if;
  perform (p_evidence->>'scoredAt')::timestamptz;
  config:=p_evidence->'engineConfig';weights:=config->'weights';
  if jsonb_typeof(config) is distinct from 'object' or (config-array['category','version','weights'])<>'{}'::jsonb
    or jsonb_typeof(config->'category') is distinct from 'string' or length(config->>'category') not between 1 and 80
    or jsonb_typeof(config->'version') is distinct from 'number' or (config->>'version') !~ '^\d+$'
    or jsonb_typeof(weights) is distinct from 'object' or (weights-array['preferenceMatch','historySuccess','novelty'])<>'{}'::jsonb
    or config is distinct from d.context->'engine_config' then raise exception 'Invalid comparison engine evidence'; end if;
  foreach breakdown in array array[weights] loop
    if jsonb_typeof(breakdown->'preferenceMatch') is distinct from 'number' or jsonb_typeof(breakdown->'historySuccess') is distinct from 'number'
      or jsonb_typeof(breakdown->'novelty') is distinct from 'number' then raise exception 'Invalid comparison weights'; end if;
    for item in select value from jsonb_each(breakdown) loop
      if (item#>>'{}')::numeric not between 0 and 1 then raise exception 'Invalid comparison weights'; end if;
    end loop;
  end loop;
  if abs((weights->>'preferenceMatch')::numeric+(weights->>'historySuccess')::numeric+(weights->>'novelty')::numeric-1)>0.000000001 then
    raise exception 'Invalid comparison weights'; end if;
  if jsonb_array_length(p_evidence->'options') not between 2 and 8
    or jsonb_array_length(p_evidence->'options')<>(select count(*) from public.decision_options where decision_id=d.id) then
    raise exception 'Comparison evidence options do not match'; end if;
  for o in select value from jsonb_array_elements(p_evidence->'options') loop
    position:=position+1;
    if jsonb_typeof(o) is distinct from 'object' or (o-array['label','score','breakdown','reasons','warning','sourceCounts','sourceIds'])<>'{}'::jsonb
      or jsonb_typeof(o->'label') is distinct from 'string' or length(o->>'label') not between 1 and 80
      or jsonb_typeof(o->'score') is distinct from 'number' or (o->>'score')::numeric not between 0 and 1
      or jsonb_typeof(o->'warning') is distinct from 'boolean' or jsonb_typeof(o->'reasons') is distinct from 'array'
      or jsonb_array_length(o->'reasons') not between 1 and 5 then raise exception 'Invalid comparison option evidence'; end if;
    for item in select value from jsonb_array_elements(o->'reasons') loop
      if jsonb_typeof(item) is distinct from 'string' or length(item#>>'{}') not between 1 and 500 then raise exception 'Invalid comparison reason'; end if;
    end loop;
    breakdown:=o->'breakdown';
    if jsonb_typeof(breakdown) is distinct from 'object'
      or (p_evidence->>'basis'='journal' and ((breakdown-array['preferenceMatch','historySuccess','novelty'])<>'{}'::jsonb
        or not breakdown ?& array['preferenceMatch','historySuccess','novelty']))
      or (p_evidence->>'basis'='criteria' and ((breakdown-array['criteriaLow','criteriaHigh','coverage'])<>'{}'::jsonb
        or not breakdown ?& array['criteriaLow','criteriaHigh','coverage'])) then
      raise exception 'Invalid comparison score breakdown'; end if;
    for item in select value from jsonb_each(breakdown) loop
      if jsonb_typeof(item) is distinct from 'number' or (item#>>'{}')::numeric not between 0 and 1 then raise exception 'Invalid comparison score breakdown'; end if;
    end loop;
    select * into saved from public.decision_options where decision_id=d.id and rank=position;
    if not found or saved.label is distinct from o->>'label' or saved.score is distinct from (o->>'score')::real
      or saved.score_breakdown is distinct from breakdown then raise exception 'Comparison evidence options do not match'; end if;
    counts:=o->'sourceCounts';sources:=o->'sourceIds';
    if jsonb_typeof(counts) is distinct from 'object' or (counts-array['preferences','decisions','reflections'])<>'{}'::jsonb
      or jsonb_typeof(sources) is distinct from 'object' or (sources-array['preferenceIds','decisionIds'])<>'{}'::jsonb then raise exception 'Invalid comparison sources'; end if;
    foreach config in array array[counts->'preferences',counts->'decisions',counts->'reflections'] loop
      if jsonb_typeof(config) is distinct from 'number' or (config#>>'{}') !~ '^\d+$' or (config#>>'{}')::numeric>1000000 then raise exception 'Invalid comparison source count'; end if;
    end loop;
    if (counts->>'reflections')::numeric>(counts->>'decisions')::numeric then raise exception 'Invalid comparison source count'; end if;
    foreach config in array array[sources->'preferenceIds',sources->'decisionIds'] loop
      if jsonb_typeof(config) is distinct from 'array' or jsonb_array_length(config)>80 then raise exception 'Invalid comparison source ids'; end if;
      for item in select value from jsonb_array_elements(config) loop
        if jsonb_typeof(item) is distinct from 'string' or (item#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'Invalid comparison source id'; end if;
      end loop;
      if (select count(distinct lower(x)) from jsonb_array_elements_text(config) x)<>jsonb_array_length(config) then raise exception 'Duplicate comparison source ids'; end if;
    end loop;
    if jsonb_array_length(sources->'preferenceIds')>(counts->>'preferences')::numeric
      or jsonb_array_length(sources->'decisionIds')>(counts->>'decisions')::numeric then raise exception 'Invalid comparison source count'; end if;
    if p_evidence->>'basis'='criteria' and (o->'warning'<>'false'::jsonb or counts<>'{"preferences":0,"decisions":0,"reflections":0}'::jsonb) then
      raise exception 'Criteria evidence cannot use personal sources'; end if;
    if exists(select 1 from jsonb_array_elements_text(sources->'preferenceIds') x where not exists(select 1 from public.preferences p where p.id=x::uuid and p.user_id=auth.uid()))
      or exists(select 1 from jsonb_array_elements_text(sources->'decisionIds') x where not exists(select 1 from public.decisions s where s.id=x::uuid and s.user_id=auth.uid())) then
      raise exception 'Invalid comparison source owner'; end if;
  end loop;
end $$;


create or replace function nudge_private.validate_comparison_evidence(p_evidence jsonb,p_decision_id uuid,p_generation integer)
returns void language plpgsql security definer set search_path='' as $$
declare d public.decisions%rowtype; source jsonb; item jsonb; criterion jsonb; a nudge_private.discovery_answers%rowtype; q jsonb; rule jsonb; matched jsonb; seen text[]:='{}'; answer_ids text[]; freshest timestamptz;
begin
 select * into d from public.decisions where id=p_decision_id and user_id=auth.uid();
 if not found then raise exception 'Comparison not found'; end if;
 if exists(select 1 from jsonb_array_elements(coalesce(d.context->'criteria','[]')) c where c ? 'discoverySuggestion') then raise exception 'Suggestion references must remain private'; end if;
 if p_evidence->'version'='1'::jsonb then
   if d.context->'discovery_criteria_used'='true'::jsonb then raise exception 'Missing criterion provenance'; end if;
   perform nudge_private.validate_comparison_evidence_v1(p_evidence,p_decision_id,p_generation); return;
 end if;
 if p_evidence->'version' is distinct from '2'::jsonb or p_evidence->>'basis' is distinct from 'criteria'
   or d.context->'discovery_criteria_used' is distinct from 'true'::jsonb
   or octet_length(p_evidence::text)>131072
   or jsonb_typeof(p_evidence->'criterionSources') is distinct from 'array'
   or jsonb_array_length(p_evidence->'criterionSources') not between 1 and 5 then raise exception 'Invalid criterion provenance'; end if;
 perform nudge_private.validate_comparison_evidence_v1(jsonb_set(p_evidence-'criterionSources','{version}','1'),p_decision_id,p_generation);
 if lower(trim(d.context->>'domain')) not in ('everyday life','real life','daily life','work','study','food','money','travel','learning','rest') then raise exception 'Suggestion is outside this setting'; end if;
 for source in select value from jsonb_array_elements(p_evidence->'criterionSources') loop
   if jsonb_typeof(source) is distinct from 'object' or source-array['criterionId','suggestionId','generation','answers']<>'{}'::jsonb
     or not source ?& array['criterionId','suggestionId','generation','answers']
     or jsonb_typeof(source->'criterionId') is distinct from 'string' or length(source->>'criterionId') not between 1 and 50 or source->>'criterionId' !~ '^[a-zA-Z0-9-]+$'
     or source->>'criterionId'=any(seen) or jsonb_typeof(source->'suggestionId') is distinct from 'string' or length(source->>'suggestionId') not between 1 and 512
     or jsonb_typeof(source->'generation') is distinct from 'number' or source->'generation' is distinct from to_jsonb(p_generation)
     or jsonb_typeof(source->'answers') is distinct from 'array' or jsonb_array_length(source->'answers') not between 1 and 80 then raise exception 'Invalid criterion source'; end if;
   seen:=array_append(seen,source->>'criterionId');
   select c into criterion from jsonb_array_elements(d.context->'criteria') c where c->>'id'=source->>'criterionId';
   if criterion is null then raise exception 'Criterion source does not match this comparison'; end if;
   if exists(select 1 from nudge_private.discovery_feedback f where f.user_id=auth.uid() and f.insight_id=source->>'suggestionId' and f.feedback in ('not_me','sometimes')) then raise exception 'Reflection is excluded from suggestions'; end if;
   answer_ids:='{}';freshest:=null;matched:=null;
   for item in select value from jsonb_array_elements(source->'answers') loop
     if jsonb_typeof(item) is distinct from 'object' or item-array['answerId','answerRevision','questionId','questionVersion']<>'{}'::jsonb
       or not item ?& array['answerId','answerRevision','questionId','questionVersion']
       or jsonb_typeof(item->'answerId') is distinct from 'string' or item->>'answerId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or item->>'answerId'=any(answer_ids)
       or jsonb_typeof(item->'answerRevision') is distinct from 'number' or item->>'answerRevision' !~ '^\d+$'
       or jsonb_typeof(item->'questionId') is distinct from 'string' or length(item->>'questionId') not between 1 and 96
       or jsonb_typeof(item->'questionVersion') is distinct from 'number' or item->>'questionVersion' !~ '^[1-9]\d*$' then raise exception 'Invalid source answer reference'; end if;
     select * into a from nudge_private.discovery_answers where id=(item->>'answerId')::uuid and user_id=auth.uid() and active;
     if not found or to_jsonb(a.revision) is distinct from item->'answerRevision' or a.question_id is distinct from item->>'questionId' or to_jsonb(a.question_version) is distinct from item->'questionVersion' then raise exception 'Source answer changed or is unavailable'; end if;
     select definition into q from public.discovery_question_versions where question_id=a.question_id and version=a.question_version;
     if q->>'purpose' is distinct from 'evidence' or nudge_private.discovery_question_suppressed(q) then raise exception 'Source answer is excluded'; end if;
     rule:=null;
     select s into rule from jsonb_array_elements(coalesce(q->'signals','[]')) s
       where nudge_private.discovery_reflection_id(s)=source->>'suggestionId'
       and s->'criterion'->>'label'=criterion->>'label'
       and (s->'criterion'->'decisionDomains' ? lower(trim(d.context->>'domain')) or s->'criterion'->'decisionDomains' ? d.category::text)
       and ((a.response->>'kind'='choice' and s->>'optionId'=a.response->>'optionId') or (a.response->>'kind'='ranking' and a.response->'groups'->0 ? (s->>'optionId')));
     if rule is null then raise exception 'Source does not support this criterion'; end if;
     answer_ids:=array_append(answer_ids,a.id::text);freshest:=greatest(freshest,a.answered_at);matched:=rule;
   end loop;
   if freshest<clock_timestamp()-interval '180 days' then raise exception 'Suggested criterion is stale'; end if;
   -- Any different saved answer expressing the opposite value blocks a fixed
   -- preference. Joint first ranks from the same answer remain compatible.
   if exists(select 1 from nudge_private.discovery_answers other_a join public.discovery_question_versions other_q on other_q.question_id=other_a.question_id and other_q.version=other_a.question_version
     cross join lateral jsonb_array_elements(coalesce(other_q.definition->'signals','[]')) other_rule
     where other_a.user_id=auth.uid() and other_a.active and not other_a.id::text=any(answer_ids)
       and other_q.definition->>'purpose'='evidence' and not nudge_private.discovery_question_suppressed(other_q.definition)
       and other_rule->>'attributeKey'=matched->>'attributeKey' and other_rule->>'scope'=matched->>'scope' and other_rule->>'value'<>matched->>'value'
       and ((other_a.response->>'kind'='choice' and other_rule->>'optionId'=other_a.response->>'optionId') or (other_a.response->>'kind'='ranking' and other_a.response->'groups'->0 ? (other_rule->>'optionId')))) then raise exception 'Mixed answers need context'; end if;
 end loop;
end $$;
revoke all on function nudge_private.validate_comparison_evidence_v1(jsonb,uuid,integer),nudge_private.validate_comparison_evidence(jsonb,uuid,integer) from public,anon,authenticated,service_role;
-- Correcting a reflection also withdraws any saved source link derived from
-- it. The comparison and the user's explicit criterion inputs remain theirs.
create function nudge_private.withdraw_discovery_criterion_feedback() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.feedback in ('not_me','sometimes') then
   delete from nudge_private.comparison_evidence e where e.user_id=new.user_id and exists(
     select 1 from jsonb_array_elements(coalesce(e.snapshot->'criterionSources','[]')) s where s->>'suggestionId'=new.insight_id);
 end if;
 return new;
end $$;
revoke all on function nudge_private.withdraw_discovery_criterion_feedback() from public,anon,authenticated,service_role;
create trigger discovery_feedback_withdraw_criteria after insert or update on nudge_private.discovery_feedback
 for each row execute function nudge_private.withdraw_discovery_criterion_feedback();
create function nudge_private.discovery_criterion_provenance_version() returns integer language sql immutable as $$ select 1 $$;
revoke all on function nudge_private.discovery_criterion_provenance_version() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;

