import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

test('dashboard uses real account navigation with a compact, accessible comparison', async ({ page }) => {
  test.skip(!process.env.NUDGE_DASHBOARD_TEST_EMAIL || !process.env.NUDGE_DASHBOARD_TEST_PASSWORD, 'Requires a dedicated disposable account.');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(process.env.NUDGE_DASHBOARD_TEST_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.NUDGE_DASHBOARD_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const measurements: { route: string; round: number; clickToContentMs: number }[] = [];
  for (let round = 1; round <= 2; round++) {
    for (const [label, route, heading] of [['Decide', '/ask', 'What are you deciding between?'], ['Journal', '/history', 'Decision history.'], ['About you', '/profile', 'About you.'], ['Today', '/dashboard', 'What feels like you today?']] as const) {
      const started = performance.now();
      await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${route}$`));
      await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
      if (route === '/ask') await expect(page.getByPlaceholder('First option')).toBeVisible();
      measurements.push({ route, round, clickToContentMs: Math.round(performance.now() - started) });
    }
  }
  const output = process.env.NUDGE_E2E_SCREENSHOT_DIR;
  if (output) {
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, 'navigation-timing.json'), JSON.stringify({ measuredAtUtc: new Date().toISOString(), origin: new URL(page.url()).origin, environment: process.env.NUDGE_E2E_EXTERNAL==='1'?'external deployed app':`local ${process.env.NUDGE_E2E_SERVER_MODE ?? 'production'} server`, node: process.versions.node, measurements, note: 'Small diagnostic sample; includes Playwright overhead. Not a before/after or population performance benchmark.' }, null, 2));
  }
  await page.goto('/ask');
  await expect(page.getByPlaceholder('First option')).toBeFocused();
  await page.setViewportSize({ width: 375, height: 844 });
  await expect(page.getByRole('textbox')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (output) await page.screenshot({caret:'initial', path: path.join(output, 'comparison-options-mobile.png'), fullPage: true });
  await page.getByPlaceholder('First option').fill('Blue room');
  await page.getByPlaceholder('Second option').fill('Moon run');
  await page.getByRole('button', { name: 'Compare 2 options' }).click();
  await expect(page.getByRole('heading', { name: 'Add a little context' })).toBeFocused();
  await expect(page.getByLabel('Setting (required)', { exact: true })).toHaveValue('');
  for (const theme of ['light', 'dark'] as const) {
    const current = (await page.locator('html').getAttribute('class'))?.split(/\s+/);
    if (!current?.includes(theme)) await page.getByRole('button', { name: theme === 'light' ? 'Switch to light mode' : 'Switch to dark mode' }).click();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    if (output) await page.screenshot({caret:'initial', path: path.join(output, `comparison-context-${theme}-mobile.png`), fullPage: true });
  }
  await page.getByRole('button', { name: 'Back to options' }).click();
  await expect(page.getByPlaceholder('First option')).toHaveValue('Blue room');
  await expect(page.getByPlaceholder('Second option')).toHaveValue('Moon run');
});
