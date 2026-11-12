import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('real authenticated comparison foundation reviews six contextual questions before learning',async({page})=>{
  test.skip(!process.env.NUDGE_FOUNDATION_TEST_EMAIL||!process.env.NUDGE_FOUNDATION_TEST_PASSWORD,'Requires a fresh disposable foundation account.');
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  // Starter preferences are optional; normal sign-in now opens Today.
  await page.goto('/login?next=%2Fonboarding');await page.locator('input[name=email]').fill(process.env.NUDGE_FOUNDATION_TEST_EMAIL!);await page.locator('input[name=password]').fill(process.env.NUDGE_FOUNDATION_TEST_PASSWORD!);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(/\/onboarding(?:\?|$)/,{timeout:60000});
  await expect(page.getByRole('heading',{name:'Start with a few everyday choices',exact:true})).toBeVisible();
  await expect(page.getByText('6 short questions give Nudge a starting point for your everyday preferences.',{exact:false})).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(1);await page.getByRole('textbox',{name:'What should Nudge call you? (optional)',exact:true}).fill('Foundation tester');
  const beforeResponse=await page.request.get('/api/export');expect(beforeResponse.ok()).toBe(true);const before=await beforeResponse.json();
  expect(before.profile.onboarded_at).toBeNull();expect(before.question_answers).toHaveLength(0);expect(before.preferences).toHaveLength(0);
  await page.getByRole('button',{name:'Start the questions',exact:true}).click();
  const selectedLabels:string[]=[];
  for(let index=0;index<6;index++){
    await expect(page.getByText(`Question ${index+1} of 6`,{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Why we ask',exact:true})).toBeVisible();
    const radios=page.getByRole('radio');await expect(radios).toHaveCount(6);await expect(page.locator('input[type=radio]:checked')).toHaveCount(0);
    if(index===0||index===5){const choice=radios.nth(index===0?0:1);selectedLabels.push((await choice.locator('..').textContent())!.trim());await choice.check();}
    else await page.getByRole('radio',{name:['Both could fit','It depends','Neither fits','Skip this question'][index-1],exact:true}).check();
    if(index===0){
      await page.setViewportSize({width:375,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(audit.violations).toEqual([]);
      if(process.env.NUDGE_E2E_SCREENSHOT_DIR)await page.screenshot({caret:'initial',path:`${process.env.NUDGE_E2E_SCREENSHOT_DIR}/foundation-question-mobile.png`,fullPage:true,animations:'disabled'});
    }
    await page.getByRole('button',{name:index===5?'Review my answers':'Next question',exact:true}).click();
  }
  await expect(page.getByRole('heading',{name:'Check your starting point',exact:true})).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(6);await expect(page.getByText(/no single preference saved/)).toHaveCount(4);
  const unsavedResponse=await page.request.get('/api/export');expect(unsavedResponse.ok()).toBe(true);const unsaved=await unsavedResponse.json();
  expect(unsaved.profile.onboarded_at).toBeNull();expect(unsaved.question_answers).toHaveLength(0);expect(unsaved.preferences).toHaveLength(0);
  await page.getByRole('button',{name:'Edit answer 1',exact:true}).click();await expect(page.getByRole('radio').nth(0)).toBeChecked();
  selectedLabels[0]=(await page.getByRole('radio').nth(1).locator('..').textContent())!.trim();await page.getByRole('radio').nth(1).check();await page.getByRole('button',{name:'Review my answers',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const reviewAudit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(reviewAudit.violations).toEqual([]);
  if(process.env.NUDGE_E2E_SCREENSHOT_DIR)await page.screenshot({caret:'initial',path:`${process.env.NUDGE_E2E_SCREENSHOT_DIR}/foundation-review-mobile.png`,fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Save and compare',exact:true}).click();await expect(page).toHaveURL(/\/ask$/);
  const response=await page.request.get('/api/export');expect(response.ok()).toBe(true);const saved=await response.json();
  expect(saved.profile.full_name).toBe('Foundation tester');expect(saved.profile.onboarded_at).toBeTruthy();expect(saved.question_answers).toHaveLength(6);
  expect(saved.question_answers.filter((answer:{answer:string;skipped:boolean})=>answer.answer==='skip'&&answer.skipped)).toHaveLength(4);
  expect(saved.question_answers.filter((answer:{answer:string;skipped:boolean})=>answer.answer==='b'&&!answer.skipped)).toHaveLength(2);
  expect(saved.preferences).toHaveLength(2);for(const label of selectedLabels)expect(saved.preferences.some((preference:{value:string;polarity:string})=>preference.value===label&&preference.polarity==='like')).toBe(true);
  expect(saved.memories).toHaveLength(0);expect(saved.preferences.every((preference:{source:string})=>preference.source==='explicit')).toBe(true);
  await page.goto('/onboarding');await expect(page).toHaveURL(/\/dashboard$/);expect(errors).toEqual([]);
});
