import { test, expect } from '@playwright/test';

test('dashboard uses real account comparisons across copied criteria, private labels and lost responses', async ({ page }) => {
  test.skip(!process.env.NUDGE_DASHBOARD_TEST_EMAIL || !process.env.NUDGE_DASHBOARD_TEST_PASSWORD, 'Requires a disposable account.');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(process.env.NUDGE_DASHBOARD_TEST_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.NUDGE_DASHBOARD_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto('/ask');
  await page.getByPlaceholder('First option').fill('Tea');
  await page.getByPlaceholder('Second option').fill('tea');
  await page.getByRole('button', { name: 'Add option', exact: true }).click();
  await page.getByLabel('Option 3', { exact: true }).fill('Coffee');
  await page.getByRole('button', { name: 'Compare 3 options', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Each option needs a different name.');
  await expect(page.getByPlaceholder('First option')).toHaveValue('Tea');
  await expect(page.getByLabel('Option 3', { exact: true })).toHaveValue('Coffee');
  await page.getByPlaceholder('Second option').fill('Water');
  await page.getByRole('button', { name: 'Compare 3 options', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add a little context' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);

  for (const labels of [['Tea', 'Coffee'], ['Çay', 'Qəhvə'], ['Mine', 'Cut trees'], ['constructor', '__proto__']]) {
    await page.goto('/ask');
    await page.getByPlaceholder('First option').fill(labels[0]);
    await page.getByPlaceholder('Second option').fill(labels[1]);
    await page.getByRole('button', { name: 'Compare 2 options', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Add a little context' })).toBeVisible();
    await expect(page.getByLabel('Setting (required)', { exact: true })).toHaveValue('');
    await page.getByLabel('Setting (required)', { exact: true }).fill('Synthetic reliability workshop');
    if (labels[1] === '__proto__') {
      await page.getByText('Explain your terms or add details', { exact: true }).click();
      await page.getByLabel('Meaning and known details: __proto__', { exact: true }).fill('A literal synthetic task label, not an object prototype.');
    }
    await page.getByRole('button', { name: 'Compare options', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Choose this', exact: true })).toHaveCount(2);
    await expect(page.getByText('There is not enough relevant evidence to favor an option.', { exact: true })).toBeVisible();
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);

    if (labels[1] === '__proto__') {
      const saved = await (await page.request.get('/api/export')).json();
      const decision = saved.decisions.find((row: { question: string }) => row.question === 'constructor vs __proto__');
      expect(decision.context.optionDetails.__proto__).toBe('A literal synthetic task label, not an object prototype.');
      await page.getByRole('link', { name: 'Add criteria to this comparison', exact: true }).click();
      await page.getByRole('button', { name: 'Compare 2 options', exact: true }).click();
      await expect(page.getByLabel('Meaning and known details: __proto__', { exact: true })).toHaveValue('A literal synthetic task label, not an object prototype.');
      await page.getByRole('button', { name: 'Add criterion', exact: true }).click();
      const reserved = page.getByRole('group', { name: 'Criterion 1', exact: true });
      await reserved.getByLabel('Name', { exact: true }).fill('Synthetic score');
      await reserved.getByLabel('constructor: value', { exact: true }).fill('10');
      await reserved.getByLabel('__proto__: value', { exact: true }).fill('20');
      await page.getByRole('checkbox', { name: 'I reviewed these values, ranges and sources. Use them as my comparison inputs.' }).check();
      await page.getByRole('button', { name: 'Compare options', exact: true }).click();
      await expect(page.getByText('__proto__ leads using your confirmed criteria inputs.', { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByText('__proto__ leads using your confirmed criteria inputs.', { exact: true })).toBeVisible();
      continue;
    }
    if (labels[0] !== 'Tea') continue;
    await page.getByRole('link', { name: 'Add criteria to this comparison', exact: true }).click();
    await expect(page.getByPlaceholder('First option')).toHaveValue('Tea');
    await page.getByRole('button', { name: 'Compare 2 options', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your comparison criteria', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add criterion', exact: true }).click();
    const criterion = page.getByRole('group', { name: 'Criterion 1', exact: true });
    await criterion.getByLabel('Name', { exact: true }).fill('Synthetic preparation time');
    await expect(criterion.getByLabel('Name', { exact: true })).toHaveValue('Synthetic preparation time');
    // An unfinished criterion must not trap Back -> Context behind validation.
    await page.getByRole('button', { name: 'Back to options', exact: true }).click();
    await expect(criterion.getByLabel('Name', { exact: true })).toHaveValue('Synthetic preparation time');
    await page.getByRole('button', { name: 'Compare 2 options', exact: true }).click();
    await expect(criterion.getByLabel('Name', { exact: true })).toHaveValue('Synthetic preparation time');
    await criterion.getByLabel('Unit', { exact: true }).fill('minutes');
    await criterion.getByLabel('Better value').selectOption('lower');
    await criterion.getByLabel('Tea: value', { exact: true }).fill('10');
    await criterion.getByLabel('Coffee: value', { exact: true }).fill('20');
    await page.getByRole('checkbox', { name: 'I reviewed these values, ranges and sources. Use them as my comparison inputs.' }).check();
    await page.getByRole('button', { name: 'Compare options', exact: true }).click();
    await expect(page.getByText('Tea leads using your confirmed criteria inputs.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Tea leads using your confirmed criteria inputs.', { exact: true })).toBeVisible();
  }

  await page.goto('/ask');
  const unique = `Retry ${Date.now()}`;
  await page.getByPlaceholder('First option').fill(unique);
  await page.getByPlaceholder('Second option').fill('Other synthetic task');
  await page.getByRole('button', { name: 'Compare 2 options', exact: true }).click();
  await page.getByLabel('Setting (required)', { exact: true }).fill('Synthetic retry workshop');
  let dropped = false;
  await page.route('**/ask*', async route => {
    if (!dropped && route.request().method() === 'POST' && route.request().headers()['next-action']) {
      dropped = true;
      await route.fetch(); // The server commits; only the response is lost.
      await route.abort('connectionreset');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Compare options', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Please try again');
  await expect(page.getByLabel('Setting (required)', { exact: true })).toHaveValue('Synthetic retry workshop');
  await page.getByRole('button', { name: 'Compare options', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose this', exact: true })).toHaveCount(2);
  const exported = await page.request.get('/api/export'); expect(exported.status()).toBe(200);
  const data = await exported.json();
  expect(data.decisions.filter((decision: { question: string }) => decision.question.includes(unique))).toHaveLength(1);
  expect(dropped).toBe(true);

  await page.getByRole('button', { name: 'Choose this', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Tomorrow', exact: true })).toBeVisible();
  await page.goto('/profile');
  await page.getByText('Earlier decisions and memory', { exact: true }).click();
  const inspector = page.getByRole('heading', { name: 'Inspect and correct your memory', exact: true }).locator('..');
  await expect(inspector.locator('details').first()).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Erase learned memory', exact: true }).click();
  await expect(inspector.getByText('No beliefs match this search.', { exact: true })).toBeVisible();
  await expect(inspector.locator('details')).toHaveCount(0);
  const erased = await (await page.request.get('/api/export')).json();
  expect(erased.preferences).toHaveLength(0);
  expect(erased.memories).toHaveLength(0);
  expect(erased.decisions).toHaveLength(data.decisions.length);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete decision history', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/api/export')).json()).decisions.length).toBe(0);
  expect(errors).toEqual([]);
});
