import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import knex from 'knex';
import { signIn } from '../fixtures/auth';

test('Add Usage after upgrade preserves the old record and uses its existing contract line', async ({ page }) => {
  if (process.env.E2E_DATABASE_ISOLATED !== 'true' || !process.env.UPGRADE_FIXTURE_PATH || !process.env.E2E_DB_NAME?.startsWith('upgrade_')) {
    throw new Error('Requires isolated upgraded database and retained fixture identities');
  }
  const fixture = JSON.parse(readFileSync(process.env.UPGRADE_FIXTURE_PATH, 'utf8'));
  const actor = fixture.identities[0], other = fixture.identities[1], b = actor.billing;
  const db = knex({ client: 'pg', connection: { host: process.env.E2E_DB_HOST, port: Number(process.env.E2E_DB_PORT),
    database: process.env.E2E_DB_NAME, user: process.env.E2E_DB_USER, password: process.env.E2E_DB_PASSWORD } });
  try {
    const scope = { tenant: actor.tenant, client_id: b.clientId, service_id: b.usageServiceId };
    const old = await db('usage_tracking').where(scope).whereNull('comments').first();
    expect(old).toBeTruthy();
    const otherBefore = await db('usage_tracking').where({ tenant: other.tenant }).orderBy('usage_id');
    const comment = `Upgrade usage ${randomUUID()}`;
    await signIn(page, { email: actor.email, password: process.env.E2E_USER_PASSWORD! });
    await page.goto(`/msp/billing?${new URLSearchParams({ tab: 'usage-tracking', clientId: b.clientId,
      serviceId: b.usageServiceId, periodStart: '2026-08-01', periodEnd: '2026-09-01' })}`);
    // Expectations were authored when seeding v1.5.0, never inferred from
    // the upgraded balance response. A broken Citus panel must fail this journey.
    expect(b.bucket).toMatchObject({ expectedTotalMinutes: 2400, expectedUsedMinutes: 0, expectedRolloverMinutes: 0 });
    const assertBucketBalance = async () => {
      const chart = page.getByText(b.bucket.lineName, { exact: true }).locator('xpath=../../..');
      await expect(chart.getByText('0.0 hours used', { exact: true })).toBeVisible();
      await expect(chart.getByText('40.0 hours total', { exact: true })).toBeVisible();
      await expect(chart.getByText('0%', { exact: true })).toBeVisible();
      await expect(page.locator('#retry-bucket-usage')).toBeHidden();
      await expect(page.getByText('Bucket balances could not be loaded. Retry to see the current balances.', { exact: true })).toBeHidden();
    };
    await assertBucketBalance();
    await page.locator('#add-usage-button').click();
    const dialog = page.getByRole('dialog', { name: 'Add Usage Record', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.locator('#quantity-input').fill('2');
    await dialog.locator('#comments-input').fill(comment);
    await dialog.locator('#submit-usage-button').click();
    await expect(dialog).toBeHidden();
    const created = () => db('usage_tracking').where({ ...scope, comments: comment });
    await expect.poll(async () => (await created()).length).toBe(1);
    const [row] = await created();
    expect(Number(row.quantity)).toBe(2);
    expect(row.contract_line_id).toBe(b.usageLineId);
    expect(row.invoiced).toBe(false);
    expect(await db('usage_tracking').where({ tenant: actor.tenant, usage_id: old.usage_id }).first()).toEqual(old);
    expect(await db('usage_tracking').where({ tenant: other.tenant }).orderBy('usage_id')).toEqual(otherBefore);
    await page.reload();
    await assertBucketBalance();
    await expect(page.locator(`#usage-actions-menu-${row.usage_id}`)).toBeVisible();
  } finally { await db.destroy(); }
});
