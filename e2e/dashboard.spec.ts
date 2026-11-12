import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

test("dashboard uses real account questions, themes, journal outcomes and earlier preference checks", async ({ page }) => {
  test.skip(!process.env.NUDGE_DASHBOARD_TEST_EMAIL || !process.env.NUDGE_DASHBOARD_TEST_PASSWORD, "Requires a dedicated disposable dashboard account.");
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto('/login');
  await page.getByLabel('Email', {exact:true}).fill(process.env.NUDGE_DASHBOARD_TEST_EMAIL!);
  await page.getByLabel('Password', {exact:true}).fill(process.env.NUDGE_DASHBOARD_TEST_PASSWORD!);
  await page.getByRole('button', {name:'Sign in',exact:true}).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', {name:'What feels like you today?',exact:true})).toBeVisible();
  await expect(page.getByRole('button', {name:'Save answer',exact:true})).toBeDisabled();
  const initialExport=await (await page.request.get('/api/export')).json();
  expect(initialExport.decisions).toHaveLength(0);
  expect(initialExport.discovery.answers).toHaveLength(0);
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const theme of ['light','dark'] as const){
    const current=(await page.locator('html').getAttribute('class'))?.split(/\s+/);
    if(!current?.includes(theme)) await page.getByRole('button',{name:theme==='light'?'Switch to light mode':'Switch to dark mode'}).click();
    await expect(page.locator('.nudge-workspace')).toHaveCSS('background-color',theme==='light'?'rgb(237, 242, 247)':'rgb(21, 34, 52)');
    for(const width of [320,375,768,1440]){
      await page.setViewportSize({width,height:900});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      if(width<768){
        await expect(page.locator('header').getByRole('link',{name:'Check-ins',exact:true})).toBeVisible();
        const nav=page.getByRole('navigation',{name:'Primary',exact:true});
        await expect(nav.getByRole('link')).toHaveCount(3);
        for(const name of ['Today','About you','Decide'])await expect(nav.getByRole('link',{name,exact:true})).toBeVisible();
      }
      expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
      if(width===375&&process.env.NUDGE_E2E_SCREENSHOT_DIR)await page.screenshot({path:`${process.env.NUDGE_E2E_SCREENSHOT_DIR}/today-${theme}-mobile.png`,fullPage:true,animations:'disabled'});
    }
  }
  await page.getByRole('link',{name:'Have a decision in mind?',exact:true}).click();
  await page.getByPlaceholder('First option').fill('Soup');
  await page.getByPlaceholder('Second option').fill('Pizza');
  await page.getByRole('button',{name:'Compare 2 options',exact:true}).click();
  await page.getByRole('button',{name:'Use Everyday life',exact:true}).click();
  await page.getByRole('button',{name:'Compare options',exact:true}).click();
  await expect(page.getByRole('button',{name:'Choose this'}).first()).toBeVisible();
  const decisionId=new URL(page.url()).searchParams.get('resume');expect(decisionId).toBeTruthy();
  await page.getByRole('button',{name:'Choose this'}).first().click();
  await page.getByRole('button',{name:'Tomorrow',exact:true}).click();
  await page.goto('/dashboard');
  await expect(page.getByRole('heading',{name:'What feels like you today?',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Open your journal',exact:true}).click();
  await expect(page).toHaveURL(/\/history$/);
  await page.goto('/history?decision='+decisionId);
  await page.getByRole('radio',{name:/^4 /}).check();
  await page.getByRole('button',{name:'Save reflection',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Saved. You can use this outcome next time.'}).or(page.getByText(/^Reflected:/))).toBeVisible();
  const savedExport=await (await page.request.get('/api/export')).json();expect(savedExport.decisions).toHaveLength(1);
  await page.goto('/profile');
  await page.getByRole('main').getByText('Earlier decisions and memory',{exact:true}).filter({visible:true}).click();
  const tools=page.getByRole('navigation',{name:'Decision tools',exact:true});
  for(const name of ['Decision journal','Outcome check-ins','Outcome patterns','Decision circles','Starter preferences'])await expect(tools.getByRole('link',{name,exact:true})).toBeVisible();
  await tools.getByRole('link',{name:'Outcome patterns',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Decisions, decoded.',exact:true})).toBeVisible();
  // Seed only this dedicated disposable account through its own public-key
  // session. Check the browser owner before exercising actual Discover writes.
  const exportedBefore = await page.request.get('/api/export'); expect(exportedBefore.ok()).toBe(true);
  const ownerExport = await exportedBefore.json();
  const fixture = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const signedIn = await fixture.auth.signInWithPassword({ email: process.env.NUDGE_DASHBOARD_TEST_EMAIL!, password: process.env.NUDGE_DASHBOARD_TEST_PASSWORD! });
  expect(signedIn.error).toBeNull(); expect(signedIn.data.user?.id).toBe(ownerExport.account.id);
  const patterns = [
    { key: 'learned.food.insight-yes-' + randomUUID(), label: 'Roasted carrots', signals: 6 },
    { key: 'learned.food.insight-no-' + randomUUID(), label: 'Toasted chickpeas', signals: 4 },
  ];
  for (const pattern of patterns) for (let index = 0; index < pattern.signals; index++) {
    const seeded = await fixture.rpc('record_knowledge_signal', {
      p_key: pattern.key, p_value: pattern.label, p_category_slug: 'food', p_polarity: 'like', p_source: 'inferred', p_weight: 1,
      p_kind: 'decision', p_source_decision_id: null, p_source_question_id: null, p_verified: false,
      p_detail: { synthetic: true }, p_expected_generation: ownerExport.profile.memory_generation,
    });
    expect(seeded.error).toBeNull();
  }
  await page.goto('/discover/checks');
  let insight = page.getByText('Nudge noticed something', { exact: true }).filter({ visible: true }).locator('..');
  await expect(insight.getByText(patterns[0].label, { exact: true })).toBeVisible();
  await insight.getByRole('button', { name: "That's right", exact: true }).click();
  await expect(page.getByText('Nudge noticed something', { exact: true }).filter({ visible: true })).toHaveCount(0);
  await expect(page.getByText('Saving your response…', { exact: true })).toHaveCount(0);
  const affirmedResponse = await page.request.get('/api/export'); expect(affirmedResponse.status()).toBe(200);
  const affirmedExport = await affirmedResponse.json();
  const affirmed = affirmedExport.knowledge_nodes.find((node: { key: string }) => node.key === patterns[0].key);
  expect(affirmed).toMatchObject({ value: patterns[0].label, category_slug: 'food', polarity: 'like', source: 'explicit' });
  await page.reload();
  insight = page.getByText('Nudge noticed something', { exact: true }).filter({ visible: true }).locator('..');
  await expect(insight.getByText(patterns[1].label, { exact: true })).toBeVisible();
  await expect(insight).toContainText('It does not mean you prefer to avoid it.');
  if (process.env.NUDGE_E2E_SCREENSHOT_DIR) await page.screenshot({caret:'initial', path: `${process.env.NUDGE_E2E_SCREENSHOT_DIR}/discover-pattern-review.png`, fullPage: true, animations: 'disabled' });
  await insight.getByRole('button', { name: 'Not really', exact: true }).click();
  await expect(page.getByText('Nudge noticed something', { exact: true }).filter({ visible: true })).toHaveCount(0);
  await expect(page.getByText('Saving your response…', { exact: true })).toHaveCount(0);
  const correctedResponse = await page.request.get('/api/export'); expect(correctedResponse.status()).toBe(200);
  const correctedExport = await correctedResponse.json();
  const corrected = correctedExport.knowledge_nodes.find((node: { key: string }) => node.key === patterns[1].key);
  expect(corrected).toMatchObject({ value: patterns[1].label, category_slug: 'food', polarity: 'neutral', source: 'explicit', metadata: { manual_polarity: 'neutral' } });
  expect(correctedExport.preferences.find((preference: { key: string }) => preference.key === patterns[1].key).polarity).toBe('neutral');
  expect(correctedExport.knowledge_evidence.filter((evidence: { node_id: string; direction: number }) => evidence.node_id === corrected.id && evidence.direction < 0)).toHaveLength(0);
  expect(errors).toEqual([]);
});
