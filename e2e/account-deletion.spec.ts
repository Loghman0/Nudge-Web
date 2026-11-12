import {test,expect} from '@playwright/test';
test('dedicated account deletion revokes app access',async({page})=>{
 test.skip(process.env.NUDGE_E2E_ALLOW_ACCOUNT_DELETE!=='1','Explicit disposable-account deletion flag required.');
 if(!process.env.NUDGE_E2E_EMAIL||!process.env.NUDGE_E2E_PASSWORD||!process.env.NUDGE_E2E_EXPECTED_USER_ID)throw new Error('Dedicated credentials and account ID required.');
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/login');await page.locator('input[name=email]').fill(process.env.NUDGE_E2E_EMAIL);await page.locator('input[name=password]').fill(process.env.NUDGE_E2E_PASSWORD);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(/dashboard|ask/,{timeout:60000});await page.locator('h1').waitFor();
 const exported=await page.request.get('/api/export');expect(exported.status()).toBe(200);expect((await exported.json()).account.id).toBe(process.env.NUDGE_E2E_EXPECTED_USER_ID);
 await page.goto('/profile');await page.getByRole('button',{name:'Delete my account',exact:true}).click();await page.getByLabel('Type DELETE to confirm').fill('DELETE');await page.getByRole('button',{name:'Permanently delete account'}).click();await page.waitForURL(/login\?deleted=1/,{timeout:60000});
 await page.goto('/profile');await page.waitForURL(/login/);await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible();
 expect(errors).toEqual([]);
});
