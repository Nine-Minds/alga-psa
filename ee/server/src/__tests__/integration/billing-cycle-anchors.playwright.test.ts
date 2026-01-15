import { expect, test } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import type { TenantTestData } from '../../lib/testing/tenant-test-factory';
import {
  applyPlaywrightAuthEnvDefaults,
  createTenantAndLogin,
  resolvePlaywrightBaseUrl,
} from './helpers/playwrightAuthSessionHelper';

applyPlaywrightAuthEnvDefaults();

const TEST_CONFIG = {
  baseUrl: resolvePlaywrightBaseUrl(),
};

async function waitForActiveCycles(
  db: Knex,
  tenantId: string,
  clientId: string,
  minCount: number,
  timeoutMs = 30_000
): Promise<Array<{ period_start_date: string; period_end_date: string }>> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const cycles = await db('client_billing_cycles')
      .where({ tenant: tenantId, client_id: clientId, is_active: true })
      .orderBy('period_start_date', 'asc')
      .select('period_start_date', 'period_end_date');

    if (cycles.length >= minCount) {
      return cycles;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${minCount} billing cycles`);
}

test('Billing admin sets monthly anchor day=10 and next cycle starts on the 10th', async ({ page }) => {
  test.setTimeout(300000);
  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;
  const consoleMessages: string[] = [];

  page.on('console', (msg) => {
    consoleMessages.push(`[browser:${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    consoleMessages.push(`[browser:pageerror] ${String(err)}`);
  });

  try {
    tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: {
        companyName: `Billing Anchor Test ${uuidv4().slice(0, 8)}`,
      },
      completeOnboarding: { completedAt: new Date() },
      permissions: [
        {
          roleName: 'Admin',
          permissions: [
            { resource: 'client', action: 'read' },
            { resource: 'billing', action: 'read' },
            { resource: 'billing', action: 'update' },
          ],
        },
      ],
    });

    if (!tenantData.client?.clientId) {
      throw new Error('Expected test tenant to have a client');
    }

    const tenantId = tenantData.tenant.tenantId;
    const clientId = tenantData.client.clientId;
    const clientName = tenantData.client.clientName;

    // Ensure client uses monthly cycle so the anchor editor renders day-of-month.
    await db('clients').where({ tenant: tenantId, client_id: clientId }).update({ billing_cycle: 'monthly' });

    await page.goto(`${TEST_CONFIG.baseUrl}/msp/billing?tab=billing-cycles`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    await expect(page.getByText('Failed to fetch data. Please try again later.')).toBeHidden({
      timeout: 60_000,
    });

    const table = page.locator('[data-automation-id="billing-cycles-table"]');
    await table.waitFor({ state: 'visible', timeout: 60_000 });

    await page.locator('input[placeholder="Search clients..."]').fill(clientName);

    const row = table.locator('tbody tr', { hasText: clientName }).first();
    await row.waitFor({ state: 'visible', timeout: 30_000 });

    await row.getByRole('button', { name: 'Edit Anchor' }).click();
    await expect(page.getByText('Billing periods use [start, end) semantics.', { exact: false })).toBeVisible();

    // Wait for initial preview/config load to finish, otherwise late-arriving data can overwrite the draft.
    const previewLines = page.locator('.font-mono').filter({ hasText: '→' });
    await expect(previewLines.first()).toBeVisible({ timeout: 60_000 });

    // Set anchor day-of-month to 10.
    const dayOfMonthSelect = page.locator('#billing-anchor-day-of-month');
    await dayOfMonthSelect.click();
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible({ timeout: 30_000 });
    await listbox.getByRole('option', { name: '10', exact: true }).click();
    await expect(dayOfMonthSelect).toContainText('10');

    await page.getByRole('button', { name: 'Save Anchor' }).click();
    await expect(page.getByRole('button', { name: 'Save Anchor' })).toBeEnabled({ timeout: 60_000 });

    // Preview should show boundaries on the 10th.
    const preview = page.getByText('Upcoming periods (preview)');
    await expect(preview).toBeVisible();
    await expect(page.locator('#billing-cycle-anchor-dialog')).toBeVisible().catch(() => undefined);

    await expect(previewLines.first()).toBeVisible({ timeout: 30_000 });
    await expect(previewLines.first()).toContainText('-10', { timeout: 60_000 });

    const firstLine = await previewLines.first().innerText();
    expect(firstLine).toMatch(/-10\s+→\s+\d{4}-\d{2}-\d{2}/);

    await page.keyboard.press('Escape');

    // Create the next billing cycle (initial cycle if none exist yet).
    const createButton = row.getByRole('button', { name: 'Create Next Cycle' });

    // Some Playwright clicks can be lost if the page re-renders between mouse down/up
    // due to background server actions; trigger the native click directly.
    await createButton.evaluate((el) => (el as HTMLButtonElement).click());

    const cycles = await waitForActiveCycles(db, tenantId, clientId, 1);
    expect(new Date(cycles[0].period_start_date).toISOString()).toContain('-10T00:00:00');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.log('Playwright diagnostics: consoleMessages', consoleMessages);
    throw error;
  } finally {
    await db.destroy().catch(() => undefined);
  }
});
