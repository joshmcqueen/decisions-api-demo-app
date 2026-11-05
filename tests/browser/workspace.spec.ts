import { expect, test, type Page } from '@playwright/test';
import { CHECK_IDS, DEFAULT_SETTINGS, route, type Listing, type Run } from '../../shared/domain.ts';
import { fixtures } from '../../server/catalog.ts';

// Browser tests intercept only the inference route. The delivered app has no mock mode.
function simulatedRun(body:any):Run {
  const f=fixtures.find(f=>JSON.stringify(f.listing)===JSON.stringify(body.listing));
  const checks=CHECK_IDS.map(id=>({id,outcome:f?.expected[id]??'match' as const}));
  return {id:crypto.randomUUID(),timestamp:new Date().toISOString(),engine:body.engine,model:body.engine==='decisions'?'gpt-6-luna':body.settings.model,settings:body.engine==='decisions'?DEFAULT_SETTINGS:body.settings,listing:body.listing,status:route(checks),checks,sdkMs:body.engine==='decisions'?400:1200,fingerprint:JSON.stringify(body.listing),questionVersion:'browser-test',fixtureId:f?.id??null,usage:{input:2000,cached:0,cacheWrite:0,output:100,reasoning:0},cost:{usd:.0002,version:'test',source:'test',note:'Test-only estimate',rates:{input:.1,cached:.01,cacheWrite:.125,output:.5}},raw:{testOnly:true},request:{testOnly:true},expected:f?.expected,agreement:f?{correct:5,total:5}:undefined};
}
async function mock(page:Page){await page.route('**/api/preflight',async route=>{await route.fulfill({json:simulatedRun(route.request().postDataJSON())});});}
test('correct an image mismatch, rerun, inspect, and export',async({page})=>{
  await mock(page);await page.goto('/');
  await page.getByRole('button',{name:'Check listing',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Needs attention',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Use Midnight black',exact:true}).click();
  await expect(page.getByText('Your draft has changed')).toBeVisible();
  await page.getByRole('button',{name:'Check listing',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Preflight passed',exact:true})).toBeVisible();
  await page.getByRole('button',{name:/Inspect request/}).click();
  await expect(page.getByRole('dialog')).toContainText('Browser round trip');
  await page.getByRole('button',{name:'Close dialog'}).click();
  await page.getByRole('button',{name:/Run history/}).click();
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'CSV',exact:true}).click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
});
test('model and reasoning settings persist and respect model capabilities',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByLabel('Comparison model').selectOption('gpt-6.1-sol');
  await expect(page.getByLabel('Reasoning effort')).toHaveValue('medium');
  await expect(page.getByLabel('Reasoning effort').locator('option[value="none"]')).toHaveCount(0);
  await page.getByLabel('Reasoning effort').selectOption('high');await page.getByRole('button',{name:'Done',exact:true}).click();await page.reload();
  await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.getByLabel('Reasoning effort')).toHaveValue('high');await expect(page.getByLabel('Comparison model')).toHaveValue('gpt-6.1-sol');
});
test('historical comparison labels retain their actual model after settings change',async({page})=>{
  await mock(page);await page.goto('/');await page.getByRole('button',{name:'Compare approaches',exact:true}).click();
  await expect(page.getByRole('button',{name:'Check listing',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('Comparison model').selectOption('gpt-6.1-sol');await page.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.getByText('GPT-6 Luna · no reasoning',{exact:true})).toBeVisible();await expect(page.getByText('Your draft has changed')).toBeVisible();
});
test('comparison shows the fast result before the slow result',async({page})=>{
  let release!:()=>void;const slow=new Promise<void>(r=>release=r);
  await page.route('**/api/preflight',async route=>{const b=route.request().postDataJSON();if(b.engine==='responses')await slow;await route.fulfill({json:simulatedRun(b)});});
  await page.goto('/');await page.getByRole('button',{name:'Compare approaches',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Needs attention',exact:true})).toBeVisible();
  await expect(page.getByText('Standard LLM call',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Check listing',exact:true})).toBeDisabled();
  release();await expect(page.getByRole('button',{name:'Check listing',exact:true})).toBeEnabled();
});
test('changing the listing cancels late results and empty inputs disable checks',async({page})=>{
  let release!:()=>void;const held=new Promise<void>(r=>release=r);
  await page.route('**/api/preflight',async route=>{await held;try{await route.fulfill({json:simulatedRun(route.request().postDataJSON())});}catch{/* Request intentionally aborted. */}});
  await page.goto('/');await page.getByRole('button',{name:'Check listing',exact:true}).click();
  await page.getByLabel('Product title', {exact:true}).fill('A freshly edited draft');release();
  await expect(page.getByRole('heading',{name:'Preflight passed',exact:true})).toHaveCount(0);
  await page.getByLabel('Product title',{exact:true}).fill('');await expect(page.getByRole('button',{name:'Check listing',exact:true})).toBeDisabled();
});
test('repeat runs alternate order and preserve an exportable history',async({page})=>{
  const order:string[]=[];await page.route('**/api/preflight',async route=>{const b=route.request().postDataJSON();order.push(b.engine);await route.fulfill({json:simulatedRun(b)});});
  await page.goto('/');await page.getByRole('button',{name:'Repeat runs',exact:true}).click();await page.getByLabel('Paired repetitions').fill('2');await page.getByRole('button',{name:'Start repeat runs'}).click();
  await expect(page.getByText('4 / 4 requests completed')).toBeVisible();expect(order).toEqual(['decisions','responses','responses','decisions']);
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export JSON',exact:true}).click()]);expect(download.suggestedFilename()).toMatch(/\.json$/);
});
test('shows request errors without passing the listing',async({page})=>{
  await page.route('**/api/preflight',r=>r.fulfill({status:503,json:{error:'Add OPENAI_API_KEY to the project .env file.'}}));await page.goto('/');await page.getByRole('button',{name:'Check listing',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Check unavailable',exact:true})).toBeVisible();await expect(page.getByText('Add OPENAI_API_KEY to the project .env file.')).toBeVisible();
});
test('mobile layout has no page overflow and all three examples work',async({page})=>{
  await page.setViewportSize({width:390,height:844});await mock(page);await page.goto('/');
  await page.getByRole('button',{name:/Daily Drip Coffee Maker/}).click();await expect(page.getByLabel('Bullet 1')).toContainText('espresso');
  await page.getByRole('button',{name:/Little Axolotl Plush/}).click();await expect(page.getByRole('img',{name:'Promotional overlay',exact:true}).first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Listing guidelines',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('category-specific');
});
test('business case scales measured costs and retains the measured model when settings change',async({page})=>{
  await page.route('**/api/preflight',async route=>{
    const run=simulatedRun(route.request().postDataJSON());run.cost!.usd=run.engine==='decisions'?.0002:.002;
    await route.fulfill({json:run});
  });
  await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByLabel('Comparison model').selectOption('gpt-6.1-sol');await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.getByRole('button',{name:'Compare approaches',exact:true}).click();
  const impact=page.getByRole('region',{name:'Small difference. Marketplace-scale impact.'});
  await expect(impact.getByTestId('annual-impact')).toHaveText('$540,000');
  await expect(impact).toContainText('$45,000');await expect(impact).toContainText('$135,000');
  await impact.getByRole('button',{name:/Seller portfolio/}).click();await expect(impact.getByTestId('annual-impact')).toHaveText('$5,400');
  await impact.getByLabel('Checks / listing',{exact:true}).fill('1');await expect(impact.getByTestId('annual-impact')).toHaveText('$1,800');
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('Comparison model').selectOption('gpt-6-luna');await page.getByRole('button',{name:'Done',exact:true}).click();
  await expect(impact).toContainText('GPT-6.1 Sol');await expect(impact).toContainText('Saved comparison');
  await impact.getByLabel('Checks / listing',{exact:true}).fill('');await expect(impact.getByTestId('annual-impact')).toHaveCount(0);
});
test('repeat business case uses the batch mean and shares assumptions with the main view',async({page})=>{
  let call=0;await page.route('**/api/preflight',async route=>{
    const run=simulatedRun(route.request().postDataJSON());run.cost!.usd=run.engine==='decisions'?.0002:++call===1?.001:.003;
    await route.fulfill({json:run});
  });
  await page.goto('/');await page.getByRole('button',{name:'Repeat runs',exact:true}).click();await page.getByLabel('Paired repetitions').fill('2');await page.getByRole('button',{name:'Start repeat runs'}).click();
  const dialog=page.getByRole('dialog');await expect(page.getByText('4 / 4 requests completed')).toBeVisible();
  await expect(dialog.getByTestId('annual-impact')).toHaveText('$540,000');
  await dialog.getByRole('button',{name:/Global scale/}).click();await expect(dialog.getByTestId('annual-impact')).toHaveText('$5,400,000');
  await page.getByRole('button',{name:'Close dialog'}).click();await expect(page.getByTestId('annual-impact')).toHaveText('$5,400,000');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('business case labels extra costs and withholds unknown costs',async({page})=>{
  let missing=false;await page.route('**/api/preflight',async route=>{
    const run=simulatedRun(route.request().postDataJSON());run.cost!.usd=missing?null:run.engine==='decisions'?.002:.0002;
    await route.fulfill({json:run});
  });
  await page.goto('/');await page.getByRole('button',{name:'Compare approaches',exact:true}).click();
  const impact=page.getByRole('region',{name:'Small difference. Marketplace-scale impact.'});
  await expect(impact).toContainText('PROJECTED ADDITIONAL ANNUAL COST');await expect(impact.getByTestId('annual-impact')).toHaveText('$540,000');
  missing=true;await page.getByRole('button',{name:'Compare approaches',exact:true}).click();
  await expect(impact).toContainText('A complete, costed comparison is needed.');await expect(impact.getByTestId('annual-impact')).toHaveCount(0);
});
