import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import knex from 'knex';
import { signIn } from '../fixtures/auth';

test('upgraded billing sources generate a correctly priced invoice without consuming other tenant records', async ({ page }) => {
  test.setTimeout(180000);
  if (process.env.E2E_DATABASE_ISOLATED !== 'true' || !process.env.UPGRADE_FIXTURE_PATH || !process.env.E2E_DB_NAME?.startsWith('upgrade_')) {
    throw new Error('Requires isolated upgraded database and retained fixture identities');
  }
  const { identities } = JSON.parse(readFileSync(process.env.UPGRADE_FIXTURE_PATH, 'utf8'));
  // Use the secondary tenant so Add Usage on the primary cannot change this bill.
  const actor = identities[1], other = identities[0], b = actor.billing;
  const db = knex({ client: 'pg', connection: { host: process.env.E2E_DB_HOST, port: Number(process.env.E2E_DB_PORT),
    database: process.env.E2E_DB_NAME, user: process.env.E2E_DB_USER, password: process.env.E2E_DB_PASSWORD } });
  try {
    const scope = { tenant: actor.tenant, client_id: b.clientId };
    expect(await db('invoices').where(scope)).toEqual([]);
    const client = await db('clients').where(scope).first();
    const otherUsage = await db('usage_tracking').where({ tenant: other.tenant }).orderBy('usage_id');
    await signIn(page, { email: actor.email, password: process.env.E2E_USER_PASSWORD! });
    await page.goto('/msp/billing?tab=invoicing&subtab=generate');
    await page.locator('#filter-clients-input').fill(client.client_name);
    const due = page.locator('[data-automation-id="automatic-invoices-table"]').getByRole('row')
      .filter({ hasText: client.client_name }).filter({ hasText: 'Aug 2026' })
      .filter({ has: page.locator('input[type="checkbox"][id^="select-"]:not([id^="select-child-"])') });
    await expect(due).toHaveCount(1);
    await due.getByRole('checkbox').check();
    await page.locator('#preview-selected-button').click();
    const preview = page.getByRole('dialog', { name: 'Invoice Preview', exact: true });
    // Retained source: four regular hours at $150, one overtime hour at $225,
    // one usage unit at $50, then ten percent tax.
    await expect(preview).toContainText('$962.50');
    expect(await db('invoices').where(scope)).toEqual([]);
    await page.locator('#generate-invoice-from-preview-button').click();
    await expect(preview).toBeHidden();
    await expect.poll(async () => (await db('invoices').where(scope)).length).toBe(1);
    const invoice = await db('invoices').where(scope).first();
    expect(Number(invoice.subtotal)).toBe(87500);
    expect(Number(invoice.total_amount)).toBe(96250);
    expect(invoice.status).toBe('draft');
    expect((await db('usage_tracking').where({ ...scope, service_id: b.usageServiceId }).first()).invoiced).toBe(true);
    const links = await db('invoice_time_entries').where({ tenant: actor.tenant, invoice_id: invoice.invoice_id });
    expect(links).toHaveLength(4);
    expect(await db('usage_tracking').where({ tenant: other.tenant }).orderBy('usage_id')).toEqual(otherUsage);
    expect(await db('invoices').where({ tenant: other.tenant })).toEqual([]);
    await page.goto(`/msp/billing?tab=invoicing&subtab=drafts&invoiceId=${invoice.invoice_id}`);
    await expect(page.locator('#invoice-download-pdf')).toBeVisible();
  } finally { await db.destroy(); }
});
