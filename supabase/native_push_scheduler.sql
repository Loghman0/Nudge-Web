-- Optional hosted administration, separate from portable migrations.
-- First save CHECKINS_CRON_SECRET as nudge_native_push_cron in this project's
-- Vault UI. Never paste its value into saved SQL, logs or source control.
-- Configure only the reviewed original Nudge project. Disable this job in
-- restored copies/branches before they can call the production endpoint.
begin;
create extension if not exists pg_net with schema extensions;
create or replace function nudge_private.dispatch_native_push_checkins()
returns bigint language plpgsql security definer set search_path='' as $$
declare secret_value text; secret_count integer;
begin
 select count(*),min(decrypted_secret) into secret_count,secret_value
 from vault.decrypted_secrets where name='nudge_native_push_cron';
 if secret_count<>1 or length(secret_value)<32 or length(secret_value)>256 then
   raise exception 'One valid Nudge scheduler secret is required';
 end if;
 return net.http_post(
   url:='https://projectnudge.vercel.app/api/cron/native-checkins',
   headers:=jsonb_build_object('Content-Type','application/json','x-nudge-cron-secret',secret_value),
   body:='{}'::jsonb,timeout_milliseconds:=55000);
end $$;
revoke all on function nudge_private.dispatch_native_push_checkins() from public,anon,authenticated,service_role;
select cron.schedule('nudge-native-push','*/5 * * * *','select nudge_private.dispatch_native_push_checkins();');
commit;

-- Read-only verification (does not reveal secrets or send messages):
select jobname,schedule,active from cron.job where jobname='nudge-native-push';
select not has_function_privilege('authenticated','nudge_private.dispatch_native_push_checkins()','execute')
 and not has_function_privilege('service_role','nudge_private.dispatch_native_push_checkins()','execute') as scheduler_private;
-- To pause later: select cron.unschedule('nudge-native-push');

