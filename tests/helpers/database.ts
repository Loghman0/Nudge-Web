import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

export const USER_A = '00000000-0000-4000-8000-000000000001';
export const USER_B = '00000000-0000-4000-8000-000000000002';
export async function createTestDatabase(beforeHardening?: (db: PGlite) => Promise<void>, through=9) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  `);
  for (const file of ['00001_baseline.sql', '00002_privacy_correctness.sql', '00003_memory_decisions_reminders.sql', '00004_discover_reliability.sql', '00005_public_launch.sql', '00006_privacy_boundaries.sql', '00007_push_delivery.sql','00008_legacy_signal_contract.sql','00009_decision_meaning_and_topics.sql'].filter(file=>Number(file.slice(0,5))<=through)) {
    if (file === "00002_privacy_correctness.sql") {
      await db.query("insert into auth.users(id) values($1),($2)", [USER_A, USER_B]);
      await beforeHardening?.(db);
    }
    await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  return db;
}
export async function asUser<T>(db: PGlite, user: string, action: (tx: Parameters<Parameters<PGlite['transaction']>[0]>[0]) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.exec('set local role authenticated');
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    return action(tx);
  });
}
