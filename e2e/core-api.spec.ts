import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

test('real authenticated comparison core API preserves ownership, revisions, reminders and reflected state', async ({ page }) => {
  test.skip(!process.env.NUDGE_E2E_EMAIL || !process.env.NUDGE_E2E_PASSWORD || !process.env.NUDGE_DASHBOARD_TEST_EMAIL || !process.env.NUDGE_DASHBOARD_TEST_PASSWORD,
    'Requires the dedicated disposable comparison and dashboard accounts.');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/login');
  await page.locator('input[name=email]').fill(process.env.NUDGE_E2E_EMAIL!);
  await page.locator('input[name=password]').fill(process.env.NUDGE_E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/dashboard|\/ask/);
  const origin = new URL(page.url()).origin;
  const post = (url: string, data: unknown) => page.request.post(url, { headers: { Origin: origin }, data });
  const input = { requestId: randomUUID(), options: ['Copper task', 'Willow task'], title: 'Synthetic API comparison',
    context: { domain: 'Synthetic API setting v1', category: 'hobbies', goal: 'Compare the supplied task labels', meaningConfirmed: true } };
  const before = await (await page.request.get('/api/v1/decisions?status=open&limit=1')).json();
  const unconfirmed = await post('/api/v1/decisions', { ...input, context: { ...input.context, meaningConfirmed: false } });
  expect(unconfirmed.status()).toBe(400);
  const after = await (await page.request.get('/api/v1/decisions?status=open&limit=1')).json();
  expect(after.data.pagination.total).toBe(before.data.pagination.total);

  const created = await post('/api/v1/decisions', input); expect(created.status()).toBe(200);
  expect(created.headers()['cache-control']).toContain('private'); expect(created.headers()['cache-control']).toContain('no-store');
  const initial = (await created.json()).data.comparison;
  expect(initial.decisionId).toMatch(/^[a-f0-9-]{36}$/); expect(initial.options).toHaveLength(2);
  expect(initial.evidenceState).toBe('insufficient'); expect(initial.evidenceSnapshotState).toBe('saved');
  const replay = await post('/api/v1/decisions', input); expect(replay.status()).toBe(200);
  expect((await replay.json()).data.comparison).toEqual(initial);
  expect((await post('/api/v1/decisions', { ...input, title: 'Changed intent' })).status()).toBe(409);
  expect((await page.request.post('/api/v1/decisions', { headers: { Origin: 'https://untrusted.invalid' }, data: input })).status()).toBe(403);
  const resource = '/api/v1/decisions/' + initial.decisionId;
  const refresh = resource + '/comparison', reminder = resource + '/reminder';
  const future = new Date(Date.now() + 3 * 86400000).toISOString();
  expect((await post(reminder, { enabled: true, dueAt: future })).status()).toBe(409);
  const refreshed = await post(refresh, { revision: initial.revision }); expect(refreshed.status()).toBe(200);
  const refreshedState = (await refreshed.json()).data.comparison; expect(refreshedState.revision).toBe(initial.revision + 1);
  expect((await post(refresh, { revision: initial.revision })).status()).toBe(409);
  const extended = await post(refresh, { revision: refreshedState.revision, extraLabel: 'Birch task' }); expect(extended.status()).toBe(200);
  const current = (await extended.json()).data.comparison;
  expect(current.options).toHaveLength(3); expect(new Set(current.options.map((option: { id: string }) => option.id)).size).toBe(3);
  expect(current.revision).toBe(refreshedState.revision + 1);

  const client = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const own = await client().auth.signInWithPassword({ email: process.env.NUDGE_E2E_EMAIL!, password: process.env.NUDGE_E2E_PASSWORD! });
  const foreign = await client().auth.signInWithPassword({ email: process.env.NUDGE_DASHBOARD_TEST_EMAIL!, password: process.env.NUDGE_DASHBOARD_TEST_PASSWORD! });
  expect(own.error).toBeNull(); expect(foreign.error).toBeNull(); expect(own.data.user?.id).not.toBe(foreign.data.user?.id);
  async function bearer(url: string, data: unknown, token: string) {
    try { return await page.request.post(url, { headers: { Authorization: 'Bearer ' + token }, data }); }
    catch { throw new Error('The disposable bearer API check could not complete.'); }
  }
  const ownedReplay = await bearer('/api/v1/decisions', input, own.data.session!.access_token); expect(ownedReplay.status()).toBe(200);
  expect((await ownedReplay.json()).data.comparison.decisionId).toBe(initial.decisionId);
  expect((await bearer(refresh, { revision: current.revision }, foreign.data.session!.access_token)).status()).toBe(404);
  expect((await bearer(reminder, { enabled: true, dueAt: future }, foreign.data.session!.access_token)).status()).toBe(404);
  const choice = await post(resource + '/choice', { optionId: current.options[0].id }); expect(choice.status()).toBe(200);
  const scheduled = await post(reminder, { enabled: true, dueAt: future.replace('Z', '+00:00') }); expect(scheduled.status()).toBe(200);
  const schedule = (await scheduled.json()).data;
  expect(schedule).toMatchObject({ decisionId: initial.decisionId, enabled: true, dueAt: future });
  expect(schedule.reminderVersion).toBeGreaterThan(0);
  const scheduledAgain = await bearer(reminder, { enabled: true, dueAt: future }, own.data.session!.access_token); expect(scheduledAgain.status()).toBe(200);
  const scheduleRetry = (await scheduledAgain.json()).data;
  expect(scheduleRetry.reminderVersion).toBeGreaterThan(schedule.reminderVersion);
  expect(scheduleRetry.dueAt).toBe(future);
  expect((await post(reminder, { enabled: true, dueAt: future.slice(0, -1) })).status()).toBe(400);
  expect((await post(reminder, { enabled: false, dueAt: future })).status()).toBe(400);
  const disabled = await post(reminder, { enabled: false, dueAt: null }); expect(disabled.status()).toBe(200);
  expect((await disabled.json()).data).toMatchObject({ decisionId: initial.decisionId, enabled: false, dueAt: null });
  const reflected = await post(resource + '/reflection', { rating: 4 }); expect(reflected.status()).toBe(200);
  expect((await post(reminder, { enabled: true, dueAt: future })).status()).toBe(409);
  expect((await post(refresh, { revision: current.revision })).status()).toBe(409);
  const selectedRetry = await post(resource + '/choice', { optionId: current.options[0].id }); expect(selectedRetry.status()).toBe(200);
  expect((await selectedRetry.json()).data.status).toBe('reflected');
  await page.goto('/ask?resume=' + initial.decisionId);
  await expect(page.getByText('This choice already has a reflection. You can view it in your journal.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tomorrow', exact: true })).toHaveCount(0);
  if (process.env.NUDGE_E2E_SCREENSHOT_DIR) await page.screenshot({caret:'initial', path: `${process.env.NUDGE_E2E_SCREENSHOT_DIR}/core-api-reflected.png`, fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]);
});
