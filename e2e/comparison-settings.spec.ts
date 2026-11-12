import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';

test('real authenticated comparison settings preserve drafts and require reviewed meanings',async({browser})=>{
  const storage=process.env.NUDGE_E2E_STORAGE_STATE;
  test.skip(!storage&&!(process.env.NUDGE_E2E_EMAIL&&process.env.NUDGE_E2E_PASSWORD),'Requires a dedicated disposable comparison account.');
  const context=await browser.newContext({baseURL:process.env.NUDGE_E2E_BASE_URL??'http://127.0.0.1:3117',...(storage?{storageState:JSON.parse(readFileSync(storage,'utf8'))}:{})});
  const page=await context.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const presetName=`Browser vocabulary ${Date.now()}`;
  const screenshotDirectory=process.env.NUDGE_E2E_SCREENSHOT_DIR;
  try{
    if(!storage){
      await page.goto('/login');await page.locator('input[name=email]').fill(process.env.NUDGE_E2E_EMAIL!);await page.locator('input[name=password]').fill(process.env.NUDGE_E2E_PASSWORD!);
      await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(/dashboard|ask|consent/,{timeout:60000});
    }
    await page.goto('/ask');await page.getByPlaceholder('First option').fill('Mine');await page.getByPlaceholder('Second option').fill('Woodcutting');
    const panel=page.locator('details').filter({has:page.getByText('Saved comparison settings and meanings (optional)',{exact:true})});
    await panel.locator(':scope > summary').click();
    await expect(panel.getByText('Saved settings are currently unavailable. Your comparison still works.',{exact:true})).toHaveCount(0);
    await panel.getByRole('button',{name:'Create a saved setting',exact:true}).click();
    await panel.getByLabel('Preset name',{exact:true}).fill(presetName);await panel.getByLabel('Setting for these meanings',{exact:true}).fill('Browser synthetic sandbox v1');
    await panel.getByLabel('Decision type for this setting',{exact:true}).selectOption('hobbies');await panel.getByLabel('Usual goal (optional)',{exact:true}).fill('Collect example supplies');
    await panel.getByRole('button',{name:'Add a term meaning',exact:true}).click();await panel.getByLabel('Term 1',{exact:true}).fill('Mine');
    await panel.getByLabel('Your meaning for term 1',{exact:true}).fill('My definition for mining inside this synthetic game.');
    await panel.getByRole('button',{name:'Add a term meaning',exact:true}).click();await panel.getByLabel('Term 2',{exact:true}).fill('Woodcutting');
    await panel.getByLabel('Your meaning for term 2',{exact:true}).fill('My definition for gathering wood in this synthetic game.');
    await page.setViewportSize({width:375,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    const accessibility=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(accessibility.violations).toEqual([]);
    if(screenshotDirectory)await page.screenshot({caret:'initial',path:`${screenshotDirectory}/saved-settings-editor-mobile.png`,fullPage:true,animations:'disabled'});
    await panel.getByRole('button',{name:'Save setting',exact:true}).click();await expect(panel.getByText('Setting saved. Apply it explicitly when you want to use it.',{exact:true})).toBeVisible();
    const row=panel.locator('li').filter({has:page.getByText(presetName,{exact:true})});
    await row.getByRole('button',{name:`Apply ${presetName}`,exact:true}).click();
    await expect(page.getByPlaceholder('First option')).toHaveValue('Mine');await expect(page.getByPlaceholder('Second option')).toHaveValue('Woodcutting');
    await expect(page.getByLabel('Meaning and known details: Mine',{exact:true})).toHaveValue('My definition for mining inside this synthetic game.');
    const review=page.getByRole('checkbox',{name:`I reviewed ${presetName}, its setting and the meanings for this comparison.`,exact:true});
    await expect(review).not.toBeChecked();await page.getByRole('button',{name:'Compare options',exact:true}).click();
    await expect(page.getByRole('alert').filter({hasText:'Review this saved setting and its meanings'})).toBeVisible();
    await review.check();await page.getByLabel('Meaning and known details: Mine',{exact:true}).fill('My manually refined definition stays for review.');await expect(review).not.toBeChecked();
    await row.getByRole('button',{name:`Apply ${presetName}`,exact:true}).click();await expect(page.getByLabel('Meaning and known details: Mine',{exact:true})).toHaveValue('My manually refined definition stays for review.');
    await review.check();await page.getByRole('button',{name:'Compare options',exact:true}).click();
    await expect(page.getByText('There is not enough relevant evidence to favor an option.',{exact:true})).toBeVisible();
    await expect(page.getByText('Setting: browser synthetic sandbox v1',{exact:true})).toBeVisible();
    await page.reload();await page.getByText('How this comparison works',{exact:true}).click();await expect(page.getByText(/These reasons were saved with this comparison/)).toBeVisible();
    await page.getByRole('button',{name:'New',exact:true}).click();await page.getByPlaceholder('First option').fill('MINE');await page.getByPlaceholder('Second option').fill('Mine coal');
    await panel.locator(':scope > summary').click();await row.getByRole('button',{name:`Apply ${presetName}`,exact:true}).click();
    await expect(page.getByLabel('Meaning and known details: MINE',{exact:true})).toHaveValue('My definition for mining inside this synthetic game.');
    await expect(page.getByLabel('Meaning and known details: Mine coal',{exact:true})).toHaveValue('');
    await row.getByRole('button',{name:`Edit ${presetName}`,exact:true}).click();await panel.getByLabel('Your meaning for term 1',{exact:true}).fill('An updated definition for this same setting.');
    await panel.getByRole('button',{name:'Save setting',exact:true}).click();await expect(panel.getByText('Setting saved. Apply it explicitly when you want to use it.',{exact:true})).toBeVisible();
    await row.getByRole('button',{name:`Apply ${presetName}`,exact:true}).click();await expect(page.getByLabel('Meaning and known details: MINE',{exact:true})).toHaveValue('An updated definition for this same setting.');
    if(screenshotDirectory)await page.screenshot({caret:'initial',path:`${screenshotDirectory}/saved-settings-review-mobile.png`,fullPage:true,animations:'disabled'});
    await row.getByRole('button',{name:`Delete ${presetName}`,exact:true}).click();await expect(row).toHaveCount(0);
    await expect(page.getByPlaceholder('First option')).toHaveValue('MINE');await expect(page.getByPlaceholder('Second option')).toHaveValue('Mine coal');
    await page.reload();await panel.locator(':scope > summary').click();await expect(row).toHaveCount(0);
    expect(errors).toEqual([]);
  }finally{await context.close();}
});
