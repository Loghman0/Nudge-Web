import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('real authenticated comparison circles support private invitations, honest ties and owner deletion', async ({ page, browser }) => {
  test.skip(!process.env.NUDGE_E2E_EMAIL || !process.env.NUDGE_E2E_PASSWORD || !process.env.NUDGE_DASHBOARD_TEST_EMAIL || !process.env.NUDGE_DASHBOARD_TEST_PASSWORD,
    'Requires the dedicated disposable comparison and dashboard accounts.');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/login');
  await page.locator('input[name=email]').fill(process.env.NUDGE_DASHBOARD_TEST_EMAIL!);
  await page.locator('input[name=password]').fill(process.env.NUDGE_DASHBOARD_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/onboarding$|\/dashboard$/);
  // Leave this fixture's optional setup and journal pristine for dashboard.spec.
  await page.goto('/groups');
  const name = 'Synthetic browser circle ' + randomUUID().slice(0, 8);
  await page.locator('input[name=name]').fill(name);
  await page.getByRole('button', { name: 'Create circle', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByRole('heading', { name, exact: true }).locator('..').getByRole('link', { name: 'Open circle', exact: true }).click();
  await expect(page).toHaveURL(/\/groups\/[a-f0-9-]{36}$/);
  const circlePath = new URL(page.url()).pathname;
  expect(circlePath).toMatch(/^\/groups\/[a-f0-9-]{36}$/);
  const invitation = page.getByTitle('Copy invite code');
  const oldCode = (await invitation.innerText()).trim();
  expect(oldCode).toMatch(/^[a-f0-9]{18}$/);
  await page.getByRole('button', { name: 'Refresh invitation code', exact: true }).click();
  try { await expect(invitation).not.toHaveText(oldCode); }
  catch (error) {
    await page.reload();
    console.log('Invitation diagnostic: full reload shows the new code = ' + ((await invitation.innerText()).trim() !== oldCode));
    throw error;
  }
  const currentCode = (await invitation.innerText()).trim();
  expect(currentCode).toMatch(/^[a-f0-9]{18}$/);

  const memberContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const member = await memberContext.newPage();
    member.on('pageerror', error => errors.push(error.message));
    await member.goto('/login');
    await member.locator('input[name=email]').fill(process.env.NUDGE_E2E_EMAIL!);
    await member.locator('input[name=password]').fill(process.env.NUDGE_E2E_PASSWORD!);
    await member.getByRole('button', { name: 'Sign in', exact: true }).click();
    await member.waitForURL(/\/dashboard$|\/ask$/);
    await member.goto('/groups');
    await member.locator('input[name=code]').fill(oldCode);
    await member.getByRole('button', { name: 'Join circle', exact: true }).click();
    await expect(member.getByText('This invitation is no longer valid', { exact: true })).toBeVisible();
    await expect(member.locator('input[name=code]')).toHaveValue(oldCode);
    await member.locator('input[name=code]').fill(currentCode);
    await member.getByRole('button', { name: 'Join circle', exact: true }).click();
    await expect(member).toHaveURL(new RegExp(circlePath + '$'));
    await page.reload();
    await expect(page.getByText('2 members', { exact: false })).toBeVisible();

    await page.getByLabel('Vote question', { exact: true }).fill('Which synthetic task should we do?');
    await page.getByLabel('Option 1', { exact: true }).fill('Copper task');
    await page.getByLabel('Option 2', { exact: true }).fill('copper task');
    await page.getByRole('button', { name: 'Open the vote', exact: true }).click();
    await expect(page.getByText('Poll options must be distinct.', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Vote question', { exact: true })).toHaveValue('Which synthetic task should we do?');
    await expect(page.getByLabel('Option 1', { exact: true })).toHaveValue('Copper task');
    await page.getByLabel('Option 2', { exact: true }).fill('Willow task');
    await page.getByRole('button', { name: 'Open the vote', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Copper task/ })).toBeVisible();
    await page.getByRole('button', { name: /^Copper task/ }).click();
    await expect(page.getByRole('button', { name: /^Copper task/ })).toHaveAttribute('aria-pressed', 'true');
    await member.reload();
    await member.getByRole('button', { name: /^Willow task/ }).click();
    await expect(member.getByRole('button', { name: /^Willow task/ })).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.getByText('2 of 2 voted', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close & show results', exact: true }).click();
    await expect(page.getByText('The vote ended in a tie; there is no single winner.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Copper task/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Willow task/ })).toBeDisabled();
    if (process.env.NUDGE_E2E_SCREENSHOT_DIR) await page.screenshot({caret:'initial', path: `${process.env.NUDGE_E2E_SCREENSHOT_DIR}/circle-tied-vote.png`, fullPage: true, animations: 'disabled' });
    await member.reload();
    await expect(member.getByText('The vote ended in a tie; there is no single winner.', { exact: true })).toBeVisible();
    await member.getByRole('button', { name: 'Leave this circle', exact: true }).click();
    await expect(member).toHaveURL(/\/groups$/);
    await expect(member.getByRole('heading', { name, exact: true })).toHaveCount(0);

    await page.reload();
    await expect(page.getByText('1 member', { exact: false })).toBeVisible();
    const confirmation = page.getByLabel('Type DELETE to delete this circle', { exact: true });
    await confirmation.fill('keep');
    await page.getByRole('button', { name: 'Delete circle', exact: true }).click();
    await expect(page.getByText('Type DELETE to remove this circle and its shared polls.', { exact: true })).toBeVisible();
    await expect(confirmation).toHaveValue('keep');
    await confirmation.fill('DELETE');
    await page.getByRole('button', { name: 'Delete circle', exact: true }).click();
    await expect(page).toHaveURL(/\/groups$/);
    await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await memberContext.close();
  }
});
