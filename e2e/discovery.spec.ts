import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {PREVIEW_QUESTIONS} from '../src/lib/discovery/catalog';
test('self-discovery preview works without login, preserves a draft and has accessible controls',async({page})=>{
 await page.setViewportSize({width:390,height:844});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const writes:string[]=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.url());});
 await page.goto('/start');
 await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeDisabled();
 for(const q of PREVIEW_QUESTIONS){await expect(page.getByRole('group',{name:q.prompt,exact:true})).toBeVisible();await page.getByRole('button',{name:q.choices![0].label,exact:true}).click();await page.getByRole('button',{name:q===PREVIEW_QUESTIONS.at(-1)?'See my reflection':'Continue',exact:true}).click();}
 await expect(page.getByRole('heading',{name:'A little more of you.'})).toBeVisible();expect(writes).toEqual([]);
 expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 await page.screenshot({path:'.local/discovery-preview-mobile.png',fullPage:true});
 await page.reload();await expect(page.getByRole('heading',{name:'A little more of you.'})).toBeVisible();
 await page.getByRole('button',{name:'Save my answers',exact:true}).click();await expect(page).toHaveURL(/\/signup\?next=%2Fdiscovery-save/);
 expect(await page.evaluate(()=>localStorage.getItem('nudge.discovery.save.v1'))).toBeTruthy();expect(errors).toEqual([]);
});
test('self-discovery account flow claims, changes topic, edits, excludes, exports and deletes',async({page})=>{
 test.skip(!process.env.NUDGE_DISCOVERY_TEST_EMAIL||!process.env.NUDGE_DISCOVERY_TEST_PASSWORD,'Requires the dedicated disposable fixture runner.');
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/start');
 for(const q of PREVIEW_QUESTIONS){await page.getByRole('button',{name:q.choices![0].label,exact:true}).click();await page.getByRole('button',{name:q===PREVIEW_QUESTIONS.at(-1)?'See my reflection':'Continue',exact:true}).click();}
 await page.getByRole('link',{name:'Already have an account?',exact:true}).click();
 await page.getByLabel('Email',{exact:true}).fill(process.env.NUDGE_DISCOVERY_TEST_EMAIL!);await page.getByLabel('Password',{exact:true}).fill(process.env.NUDGE_DISCOVERY_TEST_PASSWORD!);await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page).toHaveURL(/\/discovery-save$/);await page.getByRole('button',{name:'Save to my profile',exact:true}).click();await expect(page).toHaveURL(/\/dashboard$/);
 await expect(page.getByRole('heading',{name:'What feels like you today?'})).toBeVisible();
 await expect.poll(async()=>((await page.request.get('/api/v1/discovery/profile')).json()).then(p=>p.counts.answers)).toBe(6);
 await page.getByRole('combobox',{name:'Topic',exact:true}).selectOption('work');await page.getByRole('button',{name:'Change topic',exact:true}).click();
 await expect(page.getByRole('button',{name:'Save answer',exact:true})).toBeVisible();await page.getByRole('button',{name:'It depends',exact:true}).click();await page.getByRole('button',{name:'Save answer',exact:true}).click();await expect(page.getByText('A small piece of your story, saved.',{exact:true})).toBeVisible();
 // The decision payoff keeps a private link to the exact accepted answer.
 await page.goto('/ask');await page.getByPlaceholder('First option').fill('Trip A');await page.getByPlaceholder('Second option').fill('Trip B');await page.getByRole('button',{name:'Compare 2 options',exact:true}).click();
 await page.getByLabel('Setting (required)',{exact:true}).fill('travel');await page.getByRole('button',{name:'My criteria and values',exact:true}).click();
 await page.getByRole('button',{name:'Use Flexibility',exact:true}).click();
 const criterion=page.getByRole('group',{name:'Criterion 1',exact:true});await expect(criterion.getByLabel('Name',{exact:true})).toHaveValue('Flexibility');
 await criterion.getByLabel('Lowest possible',{exact:true}).fill('0');await criterion.getByLabel('Highest possible',{exact:true}).fill('10');await criterion.getByLabel('Importance (1–5)',{exact:true}).fill('3');await criterion.getByLabel('Trip A: value',{exact:true}).fill('8');await criterion.getByLabel('Trip B: value',{exact:true}).fill('2');
 await page.getByRole('checkbox',{name:'I reviewed these values, ranges and sources. Use them as my comparison inputs.',exact:true}).check();await page.getByRole('button',{name:'Compare options',exact:true}).click();
 await expect(page.getByText('Trip A leads using your confirmed criteria inputs.',{exact:true})).toBeVisible();await page.reload();
 await page.getByText('How this comparison works',{exact:true}).click();await expect(page.getByText(/1 criterion came from reflections you chose to use/)).toBeVisible();
 const provenanceExport=await (await page.request.get('/api/export')).json();expect(provenanceExport.comparison_evidence.available).toBe(true);const snapshot=provenanceExport.comparison_evidence.records.find((row:{snapshot:{version:number}})=>row.snapshot.version===2)?.snapshot;expect(snapshot?.criterionSources[0].answers[0].questionId).toBe('time-free-day');expect(snapshot?.criterionSources[0].answers[0].answerRevision).toBe(0);
 await page.goto('/profile');await expect(page.getByRole('heading',{name:'A picture that can change'})).toBeVisible();
 await page.getByRole('button',{name:'Fits me',exact:true}).first().click();await expect(page.getByText(/Confirmed by you/).first()).toBeVisible();
 await page.getByText('Your answers (7)',{exact:true}).click();
 const row=page.getByRole('listitem').filter({hasText:PREVIEW_QUESTIONS[0].prompt});await row.getByRole('button',{name:'Edit',exact:true}).click();await row.getByRole('button',{name:'Neither fits',exact:true}).click();await row.getByRole('button',{name:'Save correction',exact:true}).click();await expect(row).toContainText('Neither fits');
 await row.getByRole('button',{name:'Exclude from profile',exact:true}).click();await expect(row).toContainText('Excluded');
 const exported=await page.request.get('/api/export');expect(exported.status()).toBe(200);const data=await exported.json();expect(data.export_version).toBe(6);expect(data.discovery.answers.length).toBe(7);expect(data.discovery.revisions.length).toBeGreaterThan(7);
 await row.getByRole('button',{name:'Delete',exact:true}).click();await row.getByRole('button',{name:'Delete answer',exact:true}).click();await expect(row).toHaveCount(0);
 await page.getByText('Question preferences',{exact:true}).click();await expect(page.getByRole('checkbox',{name:'Include short written answers (coming later)',exact:true})).toBeDisabled();await expect(page.getByRole('checkbox',{name:'Include childhood and uncertainty (coming later)',exact:true})).toBeDisabled();await page.getByRole('checkbox',{name:'Share activity counts to improve Nudge',exact:true}).check();await page.getByRole('button',{name:'Save question preferences',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Saved.'})).toBeVisible();
 expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);expect(errors).toEqual([]);
 await page.screenshot({path:'.local/discovery-profile.png',fullPage:true});
});
