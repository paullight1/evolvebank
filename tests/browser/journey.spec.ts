import { test, expect } from '@playwright/test';

test('customer completes success and failure flows with no overflow', async ({page},info) => {
  const pageErrors:string[]=[]; page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto('/');
  await page.getByRole('button',{name:'Open sandbox',exact:true}).click();
  await expect(page.getByRole('heading',{name:'A world of possibilities.'})).toBeVisible();
  await expect(page.getByText('Simulated funds only. No real bank accounts or payments.')).toBeVisible();
  await page.screenshot({path:info.outputPath('overview.png'),fullPage:true});
  await page.getByRole('button',{name:'Add demo dollars',exact:true}).click();
  await page.getByLabel('Amount to add').fill('100.00');
  await page.getByRole('button',{name:'Add demo USD',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Demo USD added');
  const nav=page.getByRole('navigation',{name:'Main navigation'});
  await nav.getByRole('button',{name:'Exchange',exact:true}).click();
  await page.getByLabel('You send', {exact:true}).fill('100.00');
  await page.getByRole('button',{name:'Get demo quote',exact:true}).click();
  await expect(page.locator('.receive-box')).toContainText('99,000.00');
  await page.screenshot({path:info.outputPath('exchange.png'),fullPage:true});
  await page.getByRole('button',{name:'Convert demo funds',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Conversion complete');
  await nav.getByRole('button',{name:'Payouts',exact:true}).click();
  await page.getByRole('button',{name:'Use available balance',exact:true}).click();
  await page.getByRole('button',{name:'Request demo payout',exact:true}).click();
  await expect(page.getByRole('button',{name:'Simulate failure',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('payout-pending.png'),fullPage:true});
  await page.getByRole('button',{name:'Simulate failure',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('returned');
  await page.getByRole('button',{name:'Request demo payout',exact:true}).click();
  await page.getByRole('button',{name:'Simulate success',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('complete');
  await nav.getByRole('button',{name:'Reconcile',exact:true}).click();
  await page.getByRole('button',{name:'Run reconciliation',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your checked records match.'})).toBeVisible();
  await expect(page.locator('.report-stats')).toContainText('Transactions checked4');
  await page.screenshot({path:info.outputPath('reconciliation.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await nav.getByRole('button',{name:'Activity',exact:true}).click();
  await page.screenshot({path:info.outputPath('activity.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('a lost funding response is recovered after reload without a second deposit', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button',{name:'Open sandbox',exact:true}).click();
  await page.getByRole('button',{name:'Add demo dollars',exact:true}).click();
  let loseDashboard=true;
  await page.route('**/api/dashboard',async route=>{
    if(loseDashboard){loseDashboard=false;await route.abort('failed');}
    else await route.continue();
  });
  await page.route('**/api/sandbox/funding',async route=>{
    const response=await route.fetch(); expect(response.status()).toBe(201);
    await route.abort('failed');
  },{times:1});
  await page.getByRole('button',{name:'Add demo USD',exact:true}).click();
  await expect(page.getByRole('button',{name:'Retry original request',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Retry original request',exact:true})).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('heading',{name:'A world of possibilities.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Retry original request',exact:true})).toHaveCount(0);
  const dashboard=await (await page.request.get('/api/dashboard')).json();
  expect(dashboard.operations).toHaveLength(1);
  expect(dashboard.wallets.find((w:any)=>w.currency==='USD').availableMinor).toBe('10000');
});
