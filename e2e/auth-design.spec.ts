import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('public pages authentication stays consistent, readable and keyboard accessible', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const screenshots = process.env.NUDGE_E2E_SCREENSHOT_DIR;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/login?next=%2Fgroups%3Finvite%3Dfixture');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('autocomplete', 'email');
  const password = page.getByLabel('Password', { exact: true });
  await expect(password).toHaveAttribute('autocomplete', 'current-password');
  await password.fill('local-visibility-check');
  await page.getByRole('button', { name: 'Show password', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('local-visibility-check');
  await page.getByRole('button', { name: 'Hide password', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await password.fill('');
  await expect(page.getByRole('link', { name: 'Create an account', exact: true })).toHaveAttribute('href', '/signup?next=%2Fgroups%3Finvite%3Dfixture');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  if (screenshots) await page.screenshot({caret:'initial', path: `${screenshots}/auth-login-desktop.png`, fullPage: true });

  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('.nudge-workspace')).toHaveCSS('background-color', 'rgb(21, 34, 52)');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  if (screenshots) await page.screenshot({caret:'initial', path: `${screenshots}/auth-login-dark.png`, fullPage: true });
  await page.getByRole('button', { name: 'Switch to light mode' }).click();

  await page.getByRole('link', { name: 'Create an account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.locator('input[name=full_name]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
  if (process.env.NEXT_PUBLIC_EMAIL_SIGNUP_ENABLED === 'false') {
    await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Save your reflections with Google.', { exact: true })).toBeVisible();
  } else {
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('autocomplete', 'new-password');
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('minlength', '8');
  }
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', '/login?next=%2Fgroups%3Finvite%3Dfixture');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  if (screenshots) await page.screenshot({caret:'initial', path: `${screenshots}/auth-signup-desktop.png`, fullPage: true });

  await page.setViewportSize({ width: 320, height: 740 });
  for (const [route, title] of [['/login', 'Welcome back'], ['/signup', 'Create an account'], ['/reset-password', 'Reset your password']]) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    if (screenshots) await page.screenshot({caret:'initial', path: `${screenshots}/auth-${route.slice(1)}-mobile.png`, fullPage: true });
  }
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('autocomplete', 'email');
  await page.getByRole('link', { name: 'Back to sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
  expect(errors).toEqual([]);
});
