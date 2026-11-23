import { test, expect } from '@playwright/test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/app.ts';
import { Store } from '../../server/workflow-db.ts';
import { Workflow } from '../../server/workflow.ts';
import { seedIntake } from '../../server/onsite-runtime.ts';
import { controlledAI } from '../../eval/scenarios.ts';
import { liveAI } from '../../server/workflow-ai.ts';
import { flushTraces } from '../../server/onsite-tracing.ts';
import { config } from 'dotenv';

test('seller correction, assigned exception, reviewer receipt and revalidation', async ({
  page,
}) => {
  test.setTimeout(150000);
  const live = process.env.REHEARSAL_LIVE === '1';
  if (live) config({ quiet: true });
  else process.env.ONSITE_TRACE = 'off';
  const store = new Store(':memory:'),
    flow = new Workflow(store, live ? liveAI : controlledAI('browser'));
  const server = createApp({ workflow: flow }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  try {
    await seedIntake(flow);
    while (await flow.prepareNext()) {}
    await page.route('**/api/**', async (route) => {
      const local = new URL(route.request().url());
      try {
        const resp = await route.fetch({ url: url + local.pathname, timeout: 45000 });
        await route.fulfill({ response: resp });
      } catch {
        await route.abort().catch(() => {});
      }
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Listing studio' })).toBeVisible();
    const state = (s: string) =>
      page.locator('.on-section .on-badge').filter({ hasText: s }).first();
    await expect(state('Cleared')).toBeVisible({ timeout: 40000 });
    await page.getByRole('button', { name: 'Use Warm cream' }).click();
    await expect(state('Correction needed')).toBeVisible({ timeout: 40000 });
    const photo = page.getByRole('region', { name: 'photo feedback' });
    await expect(photo.getByText('Choose the midnight-black photo')).toBeVisible();
    await expect(photo.locator('.on-field-action')).toHaveCount(1);
    await expect(photo.getByText('Decisions API', { exact: true })).toBeHidden();
    await photo.getByText('Why this photo was flagged').click();
    await expect(photo.getByText('Decisions API', { exact: true })).toBeVisible();
    await expect(photo.getByText('Asset library', { exact: true })).toBeVisible();
    await expect(page.locator('.on-cleared-checks')).not.toHaveAttribute('open', '');
    await page.getByRole('button', { name: 'Use Midnight black' }).click();
    await expect(state('Cleared')).toBeVisible({ timeout: 40000 });
    await expect(photo).toHaveCount(0);
    expect(store.cases().filter((c) => c.source === 'Seller request')).toHaveLength(0);
    await page.getByRole('button', { name: /Promotional main photo/ }).click();
    await expect(state('Correction needed')).toBeVisible({ timeout: 40000 });
    await photo.getByText('Why this photo was flagged').click();
    await page.locator('summary').filter({ hasText: 'Added artwork on the main image' }).click();
    await expect(page.getByRole('link', { name: 'Public Amazon source' })).toBeVisible();
    await page.getByRole('button', { name: 'Use Clean product photo' }).click();
    await expect(state('Cleared')).toBeVisible({ timeout: 40000 });
    await page.getByRole('button', { name: /Graphite headphone variant/ }).click();
    await photo.getByText('Why this photo was flagged').click();
    await page.locator('summary').filter({ hasText: 'Variant and placement approval' }).click();
    const knowledge = page.getByRole('region', { name: 'Commerce ontology' });
    await expect(knowledge).toContainText('Main photo for FORM-H01-GPH');
    await expect(knowledge).toContainText('Approved for FORM-H01-BLK / main');
    await expect(state('Evidence needed')).toBeVisible({ timeout: 40000 });
    await page.getByRole('button', { name: 'Request specialist help' }).click();
    await page
      .getByLabel('Question for the reviewer')
      .fill('Can I use this family photo for this SKU?');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('Case opened', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reviewer queue' }).click();
    await expect(page.locator('.on-case')).toHaveCount(3);
    await page.getByRole('button', { name: 'Seller studio' }).click();
    await page.getByRole('button', { name: /Refund guarantee bullet/ }).click();
    await page.getByRole('button', { name: 'Request specialist help' }).click();
    await page.getByLabel('Question for the reviewer').fill('Can I offer a full refund?');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('Case opened', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reviewer queue' }).click();
    const coffeeGroup = page.getByRole('region', { name: 'COM-D08-RED' });
    await expect(coffeeGroup.getByText('Daily Drip Coffee Maker')).toBeVisible();
    await expect(coffeeGroup.getByText('2 cases')).toBeVisible();
    const refund = coffeeGroup.getByRole('button', { name: /Refund guarantee in bullet/ });
    const espresso = coffeeGroup.getByRole('button', { name: /Espresso capability disputed/ });
    const compare = page.getByRole('button', { name: 'What if the manufacturer record omitted espresso?' });
    await refund.click();
    await expect(page.getByText('Can I offer a full refund?', { exact: true }).first()).toBeVisible();
    await expect(compare).toHaveCount(0);
    await espresso.click();
    await page.locator('summary').filter({ hasText: 'Product capability' }).click();
    await expect(knowledge).toContainText('Not supported');
    await expect(page.getByRole('button', { name: 'Review in ChatGPT' })).toBeVisible();
    await page.getByRole('button', { name: 'Send correction request', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm decision' }).click();
    await expect(page.getByText('Decision recorded in the seller timeline.')).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: /Shopper report/ }).click();
    await expect(page.getByText('Decision receipt')).toBeVisible();
    await page.getByRole('button', { name: 'Seller studio' }).click();
    await page.getByRole('button', { name: /Published coffee maker/ }).click();
    await expect(page.getByRole('heading', { name: 'Correction requested' })).toBeVisible();
    await page
      .getByLabel('Bullet 1', { exact: true })
      .fill('Filter-basket drip brewing with an 8-cup glass carafe.');
    await expect(page.getByRole('heading', { name: 'Revalidated' })).toBeVisible({
      timeout: 40000,
    });
    await page.getByRole('button', { name: 'Reviewer queue' }).click();
    await compare.click();
    await expect(coffeeGroup.getByRole('button')).toHaveCount(2);
    await expect(espresso).toHaveAttribute('aria-current', 'true');
    const silentRule = page.locator('details.on-rule').filter({ hasText: 'Product capability' });
    if (await silentRule.getAttribute('open') === null) await silentRule.locator('summary').first().click();
    await expect(knowledge).toContainText('Undocumented in this manufacturer record.');
    await expect(page.getByRole('heading', { name: 'Request more evidence' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Send correction request', exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Return to original shopper report' }).click();
    await expect(page.getByRole('heading', { name: 'Espresso capability disputed' })).toBeVisible();
    await page.getByRole('button', { name: 'Pilot impact' }).click();
    const impact = page.getByRole('region', { name: 'Modeled annual impact' });
    await expect(impact.getByText('$4.8M', { exact: true })).toBeVisible();
    await expect(impact.getByText('80,000 reviewer hours freed at $60/hour')).toBeVisible();
    for (const hours of ['200,000', '160,000', '120,000']) {
      await expect(impact.getByText(hours, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('$2.4M', { exact: true })).toHaveCount(2);
    await expect(page.getByText('Review assignments')).toHaveCount(0);
    await expect(page.getByLabel('Baseline review rate (%)')).toBeHidden();
    await page.getByText('Edit scenario assumptions').click();
    await expect(page.getByLabel('Baseline review rate (%)')).toHaveValue('5');
    await expect(page.getByRole('link', { name: 'Amazon’s 2025 report' })).toBeVisible();
    await page.getByLabel('Pilot review rate (%)').fill('5');
    await expect(impact.getByText('$3M', { exact: true })).toBeVisible();
    await page.getByLabel('Prepared minutes per case').fill('20');
    await expect(impact.getByText('$0', { exact: true })).toBeVisible();
    await page.getByLabel('Annual AI and operating costs ($)').fill('100000');
    await expect(impact.getByText('-$100K', { exact: true })).toBeVisible();
    await page.getByLabel('Technical workspaces').selectOption('engineer');
    await expect(page.getByText('Candidate with the missing-evidence error')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open private LangSmith trace' })).toHaveCount(2);
    await page.getByLabel('Technical workspaces').selectOption('auditor');
    await expect(page.getByText('Decision receipt')).toBeVisible();
    await page.getByRole('button', { name: 'Pilot impact' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await flushTraces();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.db.close();
  }
});
