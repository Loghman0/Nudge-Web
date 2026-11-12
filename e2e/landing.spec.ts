const APP_URL=process.env.NUDGE_E2E_BASE_URL??"http://127.0.0.1:3117";
import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('Hindsight interactions, accessible controls, keyboard and mobile layout',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.locator('h1')).toHaveText('A little curiosity.A little more you.');
 await expect(page.getByRole('link',{name:'Find your first insight',exact:true})).toHaveAttribute('href','/start');
 await page.getByRole('button',{name:'Glad I went',exact:true}).click();await expect(page.locator('.lp-rankings li').first()).toContainText('Take a walk');
 await page.getByRole('button',{name:'Not for me',exact:true}).click();await expect(page.locator('.lp-rankings li').first()).toContainText('Watch a film');
 await page.getByRole('button',{name:'Reset sample reflection'}).click();await expect(page.locator('.lp-demo-status')).toContainText('Record a reflection');
 await page.getByRole('button',{name:'Walking',exact:true}).click();await expect(page.locator('.lp-evidence [role=status]')).toContainText('positive outcome');
 const form=page.getByRole('form',{name:'Compare sample options'});await form.locator('input[name=option_a]').fill('');await form.getByRole('button',{name:/Compare options/}).click();await expect(form.getByRole('alert')).toContainText('Enter both');await expect(form.locator('input[name=option_a]')).toBeFocused();
 await form.locator('input[name=option_a]').fill('Go shopping');await form.locator('input[name=option_b]').fill('Watch a film');await form.getByRole('button',{name:/Compare options/}).click();await expect(page.locator('.lp-compare-result h3')).toHaveText('No clear preference');
 await form.locator('input[name=option_a]').fill('Take a walk');await form.getByRole('button',{name:/Compare options|Compared/}).click();await expect(page.locator('.lp-compare-result h3')).toHaveText('Take a walk');
 await page.getByRole('tab',{name:'Remember',exact:true}).click();await expect(page.getByRole('tabpanel')).toContainText('Correct memory');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await expect(page.getByRole('tab',{name:'Together',exact:true})).toHaveAttribute('data-state','active');await expect(page.getByRole('tabpanel')).toContainText('Personal memory stays separate');
 await page.getByRole('button',{name:'Who can see my data?'}).click();await expect(page.locator('.lp-faq-answer[data-state=open]')).toContainText('Hosting and authentication providers');await page.getByRole('button',{name:'What if my tastes change?'}).click();await expect(page.locator('.lp-faq-answer[data-state=open]')).toHaveCount(1);
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);await page.evaluate(()=>Object.defineProperty(navigator,'share',{value:undefined,configurable:true}));await page.getByRole('button',{name:'Share Nudge',exact:true}).click();await expect(page.getByText('Nudge link copied.',{exact:true})).toBeVisible();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(APP_URL + '/');
 for(const width of [320,375,768,1024,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const headline=await page.locator('h1').evaluate(el=>el.getBoundingClientRect().height/parseFloat(getComputedStyle(el).lineHeight));expect(headline).toBeLessThan(2.1);}
 await page.setViewportSize({width:375,height:844});await page.getByRole('button',{name:'Open menu'}).click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await page.keyboard.press('Shift+Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(page.getByRole('button',{name:'Open menu'})).toBeFocused();
 await page.getByRole('button',{name:'Open menu'}).click();await dialog.getByRole('link',{name:'Pricing',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page).toHaveURL(/#pricing/);
 await page.setViewportSize({width:1440,height:900});await page.goto('/#faq');await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'FAQ',exact:true})).toHaveAttribute('aria-current','location');await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await expect(page.locator('.lp-nav')).toHaveAttribute('data-scrolled','false');await expect(page.locator('.lp-desktop-nav [aria-current]')).toHaveCount(0);
 expect(errors).toEqual([]);
});
test('Hindsight contrast, accessibility, opening screen and reduced motion',async({page})=>{
 for(const theme of ['light','dark'] as const){
  await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});await page.goto('/');
  for(const width of [375,1440]){
   await page.setViewportSize({width,height:844});const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(result.violations).toEqual([]);
   const heroHeight=await page.locator('#landing-hero').evaluate(el=>el.getBoundingClientRect().height);
   expect(heroHeight).toBeLessThanOrEqual(845);
   expect(await page.locator('h1').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  }
 }
 await page.setViewportSize({width:375,height:844});await page.getByRole('button',{name:'Open menu'}).click();const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(result.violations).toEqual([]);
});
