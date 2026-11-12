const APP_URL=process.env.NUDGE_E2E_BASE_URL??"http://127.0.0.1:3117";
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
const state=process.env.NUDGE_E2E_STORAGE_STATE;
const credentials=process.env.NUDGE_E2E_EMAIL&&process.env.NUDGE_E2E_PASSWORD;
test('public pages, policy links, sharing and mobile layout',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(page.url()+': '+e.message));
 await page.goto('/');await expect(page.locator('h1')).toBeVisible();
 const icon=page.locator('link[rel="icon"][type="image/svg+xml"]');await expect(icon).toHaveAttribute('href','/brand/nudge-mark.svg');
 const iconResponse=await page.request.get((await icon.getAttribute('href'))!);expect(iconResponse.status()).toBe(200);expect(iconResponse.headers()['content-type']).toContain('image/svg+xml');
 await expect(page.locator('h1')).toHaveCSS('opacity','1');
 expect(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor)).toBe('rgb(237, 242, 247)');
 await expect(page.locator('#nudge-landing')).toHaveCSS('background-color','rgb(237, 242, 247)');
 expect(await page.locator('header').first().evaluate(el=>getComputedStyle(el).position)).toBe('sticky');
 const tokens=await page.evaluate(()=>{
  const el=document.createElement('div');el.className='rounded-card border border-line bg-surface-raised p-6 shadow-card';document.body.append(el);
  const style=getComputedStyle(el);const result={radius:style.borderRadius,padding:style.padding,border:style.borderTopWidth,background:style.backgroundColor,shadow:style.boxShadow};el.remove();return result;
 });
 expect(tokens.radius).toBe('22px');expect(tokens.padding).toBe('24px');expect(tokens.border).toBe('1px');expect(tokens.background).toBe('rgb(249, 251, 253)');expect(tokens.shadow).not.toBe('none');
 if(process.env.NUDGE_E2E_SCREENSHOT_DIR)await page.screenshot({caret:'initial',path:`${process.env.NUDGE_E2E_SCREENSHOT_DIR}/light-home.png`});
 await page.getByRole('button',{name:'Switch to dark mode'}).click();
 expect(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor)).toBe('rgb(21, 34, 52)');
 await expect(page.locator('#nudge-landing')).toHaveCSS('background-color','rgb(21, 34, 52)');
 await expect(page.locator('header a[href="/signup"]')).toHaveCSS('color','rgb(21, 34, 52)');
 if(process.env.NUDGE_E2E_SCREENSHOT_DIR)await page.screenshot({caret:'initial',path:`${process.env.NUDGE_E2E_SCREENSHOT_DIR}/dark-home.png`});
 await page.getByRole('button',{name:'Switch to light mode'}).click();
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);
 await page.evaluate(()=>Object.defineProperty(navigator,'share',{value:undefined,configurable:true}));
 await page.getByRole('button',{name:'Share Nudge',exact:true}).click();await expect(page.getByText('Nudge link copied.',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(APP_URL + '/');
 await page.getByRole('link',{name:'Privacy',exact:true}).click();await expect(page.getByRole('heading',{name:'Privacy policy',exact:true})).toBeVisible();
 for(const [route,title] of [['terms','Terms of service'],['cookies','Cookies & browser storage'],['support','Support & privacy requests'],['security','Security'],['accessibility','Accessibility']]){
  await page.goto('/'+route);await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
 }
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 await expect(page.locator('h1')).toHaveCSS('opacity','1');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 if(process.env.NUDGE_E2E_SCREENSHOT_DIR)await page.screenshot({caret:'initial',path:`${process.env.NUDGE_E2E_SCREENSHOT_DIR}/mobile-home.png`});
 expect(errors).toEqual([]);
 expect((await page.request.get('/constructor')).status()).toBe(404);
 const robots=await page.request.get('/robots.txt');expect(robots.ok()).toBe(true);
 const og=await page.request.get('/opengraph-image');expect(og.ok()).toBe(true);expect(og.headers()['content-type']).toContain('image/png');
 await page.goto('/update-password');await expect(page).toHaveURL(/\/login\?next=%2Fupdate-password/);await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible();
 await page.goto('/login?error=constructor');await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible();
 expect(errors).toEqual([]);
});

test('real authenticated comparison, reflection, refresh, export and privacy controls',async({browser})=>{
 test.skip(!state&&!credentials,'Provide a dedicated test account or private storage-state path.');
 const context=await browser.newContext(state?{storageState:JSON.parse(readFileSync(state,'utf8'))}:{});
 const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(page.url()+': '+e.message));
 try{
  if(!state){await page.goto(APP_URL + '/login');await page.locator('input[name=email]').fill(process.env.NUDGE_E2E_EMAIL!);await page.locator('input[name=password]').fill(process.env.NUDGE_E2E_PASSWORD!);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(/dashboard|ask|consent/,{timeout:60000});await page.locator('h1').waitFor();}
  // Use fresh labels: the hosted privacy preflight intentionally forgets Soup,
  // whose suppression must remain effective rather than being relearned here.
  await page.goto(APP_URL + '/ask');await page.getByPlaceholder('First option').fill('Pasta');await page.getByPlaceholder('Second option').fill('Curry');
  await page.getByRole('button',{name:'Compare 2 options'}).click();
  await expect(page.getByRole('heading',{name:'Add a little context'})).toBeVisible();
  await page.getByRole('button',{name:'Use Everyday life'}).click();
  await page.getByRole('button',{name:'Compare options'}).click();
  await expect(page.getByRole('button',{name:'Choose this'}).first()).toBeVisible();
  const comparisonId=new URL(page.url()).searchParams.get('resume');expect(comparisonId).toBeTruthy();
  const journalList=await page.request.get(APP_URL+'/api/v1/decisions?limit=1&status=open');
  expect(journalList.status()).toBe(200);expect(journalList.headers()['cache-control']).toContain('no-store');
  const journalPage=await journalList.json();expect(journalPage.data.decisions).toHaveLength(1);expect(journalPage.data.pagination.limit).toBe(1);
  const detailUrl=APP_URL+'/api/v1/decisions/'+comparisonId;
  const beforeReload=await page.request.get(detailUrl);expect(beforeReload.status()).toBe(200);const recordedBefore=(await beforeReload.json()).data.decision;
  expect(recordedBefore.saved_explanation.state).toBe('saved');
  await page.reload();await expect(page.getByRole('button',{name:'Choose this'}).first()).toBeVisible();
  const recordedAfter=(await (await page.request.get(detailUrl)).json()).data.decision;
  expect(recordedAfter.saved_explanation).toEqual(recordedBefore.saved_explanation);
  expect((await page.request.get(APP_URL+'/api/v1/decisions?limit=500')).status()).toBe(400);
  expect((await page.request.get(APP_URL+'/api/v1/decisions/00000000-0000-4000-8000-000000000099')).status()).toBe(404);
  expect((await page.request.get(detailUrl,{headers:{Authorization:'Bearer invalid-test-token'}})).status()).toBe(401);
  const choiceEndpoint=detailUrl+'/choice';
  const choiceId=recordedAfter.decision_options[0].id;
  const choiceResponse=await page.request.post(choiceEndpoint,{headers:{Origin:new URL(APP_URL).origin},data:{optionId:choiceId}});
  expect(choiceResponse.status()).toBe(200);expect(choiceResponse.headers()['cache-control']).toContain('no-store');
  const chosenAcknowledgement={apiVersion:'1',data:{decisionId:comparisonId,selectedOptionId:choiceId,status:'decided'}};
  expect(await choiceResponse.json()).toEqual(chosenAcknowledgement);
  const choiceRetry=await page.request.post(choiceEndpoint,{headers:{Origin:new URL(APP_URL).origin},data:{optionId:choiceId}});
  expect(choiceRetry.status()).toBe(200);expect(await choiceRetry.json()).toEqual(chosenAcknowledgement);
  expect((await page.request.post(choiceEndpoint,{headers:{Origin:new URL(APP_URL).origin},data:{optionId:recordedAfter.decision_options[1].id}})).status()).toBe(409);
  expect((await page.request.post(choiceEndpoint,{headers:{Origin:'https://untrusted.invalid'},data:{optionId:choiceId}})).status()).toBe(403);
  expect((await page.request.post(choiceEndpoint,{headers:{Authorization:'Bearer invalid-test-token'},data:{optionId:choiceId}})).status()).toBe(401);
  expect((await page.request.post(choiceEndpoint,{headers:{Origin:new URL(APP_URL).origin},data:{optionId:choiceId,userId:'forged-owner'}})).status()).toBe(400);
  if(credentials&&process.env.NUDGE_DASHBOARD_TEST_EMAIL&&process.env.NUDGE_DASHBOARD_TEST_PASSWORD){
   const client=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
   const ownSession=await client().auth.signInWithPassword({email:process.env.NUDGE_E2E_EMAIL!,password:process.env.NUDGE_E2E_PASSWORD!});
   const foreignSession=await client().auth.signInWithPassword({email:process.env.NUDGE_DASHBOARD_TEST_EMAIL,password:process.env.NUDGE_DASHBOARD_TEST_PASSWORD});
   expect(ownSession.error).toBeNull();expect(foreignSession.error).toBeNull();
   expect(ownSession.data.user?.id).not.toBe(foreignSession.data.user?.id);
   const bearerPost=async(token:string)=>{
    try{return await page.request.post(choiceEndpoint,{headers:{Authorization:'Bearer '+token},data:{optionId:choiceId}});}
    catch{throw new Error('Could not complete the disposable bearer choice check.');}
   };
   const ownBearer=await bearerPost(ownSession.data.session!.access_token);expect(ownBearer.status()).toBe(200);expect(await ownBearer.json()).toEqual(chosenAcknowledgement);
   const foreignBearer=await bearerPost(foreignSession.data.session!.access_token);expect(foreignBearer.status()).toBe(404);
  }
  // The page still shows its open draft. The web action must acknowledge the
  // same persisted selection without duplicating learning or reversing it.
  await page.getByRole('button',{name:'Choose this'}).first().click();await expect(page.getByRole('button',{name:'Tomorrow',exact:true})).toBeVisible();
  const chosenExport=await (await page.request.get(APP_URL+'/api/export')).json();
  expect(chosenExport.knowledge_evidence.filter((evidence:{source_decision_id:string;kind:string})=>evidence.source_decision_id===comparisonId&&evidence.kind==='decision')).toHaveLength(1);
  await page.getByRole('button',{name:'In a week',exact:true}).click();await expect(page.getByText(/Check-in scheduled/)).toBeVisible();
  await page.getByRole('button',{name:'Reflect now',exact:true}).click();await page.getByRole('radio',{name:'5 stars'}).click();await page.getByRole('button',{name:'Save reflection'}).click();
  await expect(page.getByRole('status').filter({hasText:'Saved. You can use this outcome next time.'}).or(page.getByText(/^Reflected:/))).toBeVisible();
  await page.reload();await expect(page.getByText(/^Reflected:/)).toBeVisible();
  const reflectedId=new URL(page.url()).searchParams.get('decision');expect(reflectedId).toBeTruthy();
  const reflectionEndpoint=APP_URL+'/api/v1/decisions/'+reflectedId+'/reflection';
  const replay=await page.request.post(reflectionEndpoint,{headers:{Origin:new URL(APP_URL).origin},data:{rating:5}});
  expect(replay.status()).toBe(200);expect(await replay.json()).toEqual({apiVersion:'1',data:{decisionId:reflectedId,saved:false}});
  expect(replay.headers()['cache-control']).toContain('no-store');
  const conflict=await page.request.post(reflectionEndpoint,{headers:{Origin:new URL(APP_URL).origin},data:{rating:1}});expect(conflict.status()).toBe(409);
  const crossSite=await page.request.post(reflectionEndpoint,{headers:{Origin:'https://untrusted.invalid'},data:{rating:5}});expect(crossSite.status()).toBe(403);
  const invalidBearer=await page.request.post(reflectionEndpoint,{headers:{Authorization:'Bearer invalid-test-token'},data:{rating:5}});expect(invalidBearer.status()).toBe(401);
  await page.goto(APP_URL + '/analytics');await expect(page.getByRole('heading',{name:'Decisions, decoded.'})).toBeVisible();
  await page.goto(APP_URL+'/ask');
  // The input can be visible in streamed HTML before React has attached its
  // controlled change handler. Its existing mount focus is the UI-ready signal.
  await expect(page.getByPlaceholder('First option')).toBeFocused();
  await page.getByText('Prefer to write a question?',{exact:true}).click();
  await page.getByLabel('Your decision question').fill('Should I go mining, or should I cut trees?');
  await page.getByRole('button',{name:'Ask Nudge',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Add a little context'})).toBeVisible();
  await expect(page.getByLabel('Setting (required)')).toHaveValue('');
  await expect(page.getByRole('button',{name:'Choose this'})).toHaveCount(0);
  await page.getByLabel('Setting (required)').fill('Unseen sandbox world v3');
  await page.getByLabel('What are you trying to achieve?').fill('Build shelter; resource rules still need checking');
  await page.getByText('Explain your terms or add details',{exact:true}).click();
  await page.getByLabel('Meaning and known details: go mining').fill('Collect resources inside this example game, not real-world mining.');
  await page.getByRole('button',{name:'Compare options'}).click();
  await expect(page.getByText('There is not enough relevant evidence to favor an option.')).toBeVisible();
  await expect(page.getByText('Setting: unseen sandbox world v3',{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByText('Setting: unseen sandbox world v3',{exact:true})).toBeVisible();
  await page.screenshot({caret:'initial',path:`${process.env.NUDGE_E2E_SCREENSHOT_DIR??".local"}/decision-meaning-browser.png`,fullPage:true});
  await page.getByRole('button',{name:'Choose this'}).first().click();await expect(page.getByRole('button',{name:'Tomorrow',exact:true})).toBeVisible();
  // Synthetic measurements prove math and persistence, not external facts.
  await page.goto(APP_URL+'/ask');
  await page.getByPlaceholder('First option').fill('Walk');await page.getByPlaceholder('Second option').fill('Bus');
  await page.getByRole('button',{name:'Compare 2 options'}).click();
  await expect(page.getByRole('heading',{name:'Add a little context'})).toBeVisible();
  await page.getByLabel('Setting (required)').fill('Synthetic travel rules v1');
  await page.getByRole('button',{name:'My criteria and values',exact:true}).click();
  await page.getByRole('button',{name:'Add criterion',exact:true}).click();
  const criterion=page.getByRole('group',{name:'Criterion 1',exact:true});
  await criterion.getByLabel('Name',{exact:true}).fill('Travel time');
  await criterion.getByLabel('Unit',{exact:true}).fill('minutes');
  await criterion.getByLabel('Better value').selectOption('lower');
  await criterion.getByLabel('Highest possible').fill('60');
  await criterion.getByLabel('Walk: value',{exact:true}).fill('30');
  await criterion.getByLabel('Bus: value',{exact:true}).fill('15');
  await criterion.getByLabel('Bus: source link (optional)',{exact:true}).fill('https://example.invalid/synthetic-timetable');
  const confirmation=page.getByRole('checkbox',{name:'I reviewed these values, ranges and sources. Use them as my comparison inputs.'});
  await confirmation.check();
  await criterion.getByLabel('Bus: evidence or version note (optional)',{exact:true}).fill('Synthetic fixture only; no real timetable claims.');
  await expect(confirmation).not.toBeChecked();
  await page.getByRole('button',{name:'Compare options'}).click();
  await expect(page.getByRole('alert').filter({hasText:'Review and confirm the values and sources used for your criteria.'})).toBeVisible();
  await expect(criterion.getByLabel('Bus: value',{exact:true})).toHaveValue('15');
  await confirmation.check();await page.getByRole('button',{name:'Compare options'}).click();
  await expect(page.getByText('Bus leads using your confirmed criteria inputs.',{exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Source for Bus: Travel time (unverified)'})).toHaveAttribute('href','https://example.invalid/synthetic-timetable');
  await page.reload();await expect(page.getByText('Bus leads using your confirmed criteria inputs.',{exact:true})).toBeVisible();
  // Hold the real refresh response to exercise typing during an in-flight save.
  let releaseRefresh=()=>{};
  const heldRefresh=new Promise<void>(resolve=>{releaseRefresh=resolve;});
  await page.route('**/ask*',async route=>{
    if(route.request().method()==='POST' && route.request().headers()['next-action']){
      const response=await route.fetch();await heldRefresh;await route.fulfill({response});
    }else await route.continue();
  });
  const recalculate=page.getByRole('button',{name:'Recalculate saved criteria'});
  await recalculate.click();await expect(recalculate).toBeDisabled();
  await page.getByLabel('Thought of another option?').fill('Bike');releaseRefresh();
  await expect(recalculate).toBeEnabled();await page.unroute('**/ask*');
  await expect(page.getByLabel('Thought of another option?')).toHaveValue('Bike');
  await expect(page.getByText('Bus leads using your confirmed criteria inputs.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Add as unknown'}).click();
  await expect(page.getByText('Unknown values or overlapping ranges prevent a clear leader.',{exact:true})).toBeVisible();
  await expect(page.getByText('0–100',{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByText('Unknown values or overlapping ranges prevent a clear leader.',{exact:true})).toBeVisible();
  await page.screenshot({caret:'initial',path:`${process.env.NUDGE_E2E_SCREENSHOT_DIR??".local"}/criteria-comparison-browser.png`,fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({caret:'initial',path:`${process.env.NUDGE_E2E_SCREENSHOT_DIR??".local"}/criteria-comparison-mobile.png`,fullPage:true,animations:'disabled'});
  await page.getByRole('link',{name:'Copy and edit criteria'}).click();
  await expect(page.getByRole('heading',{name:'Your comparison criteria'})).toBeVisible();
  await expect(page.getByRole('checkbox',{name:'I reviewed these values, ranges and sources. Use them as my comparison inputs.'})).not.toBeChecked();
  await expect(page.getByLabel('Bike: value',{exact:true})).toHaveValue('');
  await expect(page.getByLabel('Bus: value',{exact:true})).toHaveValue('15');
  await page.screenshot({caret:'initial',path:`${process.env.NUDGE_E2E_SCREENSHOT_DIR??".local"}/criteria-editor-mobile.png`,fullPage:true,animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.setViewportSize({width:1280,height:930});
  await page.goto(APP_URL+'/dashboard');
  await expect(page.getByRole('button',{name:'Save answer',exact:true})).toBeVisible();
  const discoveryBefore=await (await page.request.get('/api/v1/discovery/profile')).json();
  for(const topic of ['work','food']){
    await page.getByRole('combobox',{name:'Topic',exact:true}).selectOption(topic);
    const [changed]=await Promise.all([
      page.waitForResponse(response=>response.url().endsWith('/api/v1/discovery/next')&&response.request().method()==='POST'),
      page.getByRole('button',{name:'Change topic',exact:true}).click(),
    ]);
    expect(changed.status()).toBe(200);expect((await changed.json()).question.domain).toBe(topic);
    await expect(page.getByRole('button',{name:'Save answer',exact:true})).toBeDisabled();
    expect((await (await page.request.get('/api/v1/discovery/profile')).json()).counts.answers).toBe(discoveryBefore.counts.answers);
  }
  await page.screenshot({caret:'initial',path:`${process.env.NUDGE_E2E_SCREENSHOT_DIR??'.local'}/discover-topic-browser.png`,fullPage:true});
  const exported=await page.request.get(APP_URL + '/api/export');expect(exported.status()).toBe(200);const data=await exported.json();expect(data.decisions.length).toBeGreaterThan(0);expect(data.account?.id).toBeTruthy();expect(exported.headers()['cache-control']).toContain('no-store');
  expect(data.export_version).toBe(6);expect(data.comparison_evidence.available).toBe(true);expect(data.comparison_evidence.records.length).toBeGreaterThan(0);expect(data.comparison_settings.available).toBe(true);
  const criteriaExport=data.decisions.find((d:{context:Record<string,unknown>})=>d.context.comparisonBasis==='criteria');
  expect(criteriaExport.context.criteria[0].values.Bus.sourceUrl).toBe('https://example.invalid/synthetic-timetable');
  expect(criteriaExport.context.criteria[0].values.Bike.value).toBeNull();
  await page.goto(APP_URL + '/profile');await page.getByText('Account settings',{exact:true}).click();await page.getByRole('button',{name:'Edit',exact:true}).first().click();await page.locator('input[name=full_name]').fill('Release tester');await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByText('Release tester',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'Delete my account',exact:true}).click();await expect(page.getByRole('button',{name:'Permanently delete account'})).toBeDisabled();await page.getByLabel('Type DELETE to confirm').fill('DELETE');await expect(page.getByRole('button',{name:'Permanently delete account'})).toBeEnabled();await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.goto(APP_URL + '/notifications');await expect(page.getByRole('heading',{name:'Check-ins',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
  if(process.env.NUDGE_E2E_ALLOW_ACCOUNT_DELETE==="1"){
   if(!credentials||!process.env.NUDGE_E2E_EXPECTED_USER_ID)throw new Error('Destructive test requires dedicated credentials and the expected test-account ID.');
   expect(data.account.id).toBe(process.env.NUDGE_E2E_EXPECTED_USER_ID);
   await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.waitForURL(APP_URL + '/');
   await page.goto(APP_URL + '/login');await page.locator('input[name=email]').fill(process.env.NUDGE_E2E_EMAIL!);await page.locator('input[name=password]').fill(process.env.NUDGE_E2E_PASSWORD!);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(/dashboard|ask/,{timeout:60000});await page.locator('h1').waitFor();
   await page.goto(APP_URL + '/profile');await page.getByRole('button',{name:'Delete my account',exact:true}).click();await page.getByLabel('Type DELETE to confirm').fill('DELETE');await page.getByRole('button',{name:'Permanently delete account'}).click();await page.waitForURL(/login\?deleted=1/,{timeout:60000});
   await page.goto(APP_URL + '/profile');await page.waitForURL(/login/);await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible();
  }
 }finally{await context.close();}
});
