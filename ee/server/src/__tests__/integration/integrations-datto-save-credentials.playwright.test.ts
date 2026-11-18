import { expect, test, type Page } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { rollbackTenant } from '../../lib/testing/tenant-creation';
import type { TenantTestData } from '../../lib/testing/tenant-test-factory';
import {
  applyPlaywrightAuthEnvDefaults,
  createTenantAndLogin,
  resolvePlaywrightBaseUrl,
} from './helpers/playwrightAuthSessionHelper';

applyPlaywrightAuthEnvDefaults();

const SETTINGS_PERMISSIONS = [
  {
    roleName: 'Admin',
    permissions: [
      { resource: 'system_settings', action: 'read' },
      { resource: 'system_settings', action: 'update' },
    ],
  },
];

async function selectDattoRmmIfSelectorPresent(page: Page): Promise<void> {
  const btn = page.locator('#rmm-integration-row-datto');
  if (await btn.count()) {
    await btn.click();
  }
}

test('Datto settings can save platform + API key/secret and shows masked credential status', async ({ page }) => {
  test.setTimeout(300_000);

  const baseUrl = resolvePlaywrightBaseUrl();
  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;

  try {
    const clientName = `Datto credentials ${uuidv4().slice(0, 6)}`;
    tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { tenantName: clientName, clientName },
      completeOnboarding: { completedAt: new Date() },
      permissions: SETTINGS_PERMISSIONS,
    });

    await page.goto(`${baseUrl}/msp/settings?tab=integrations&category=rmm`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    await selectDattoRmmIfSelectorPresent(page);

    // The default platform is a named region, so there is no URL field until Custom URL is chosen.
    await expect(page.locator('#datto-rmm-instance-url')).toHaveCount(0);

    const apiKey = `datto_key_${uuidv4().replace(/-/g, '')}`;
    const apiSecret = `datto_secret_${uuidv4().replace(/-/g, '')}`;
    const last4 = apiKey.slice(-4);

    await page.locator('#datto-rmm-api-key').fill(apiKey);
    await page.locator('#datto-rmm-api-secret').fill(apiSecret);
    await page.locator('#datto-rmm-save-config').click();

    // Save triggers a reload, which clears any transient success banner. Assert on stable persisted UI signals.
    await expect(page.getByText('Status: Configured')).toBeVisible({ timeout: 30_000 });

    // Saved key is masked but keeps the last 4 characters; the secret is never echoed.
    await expect(page.locator('#datto-rmm-api-key')).toHaveAttribute('placeholder', new RegExp(`${last4}$`), { timeout: 30_000 });
    await expect(page.getByText(/Saved:/)).toContainText(last4);
    await expect(page.locator('#datto-rmm-api-secret')).toHaveAttribute('placeholder', /Saved/i);
    await expect(page.locator('#datto-rmm-api-secret')).toHaveValue('');
    await expect(page.locator('#datto-rmm-api-key')).toHaveValue('');

    // Persisted but not yet active: activation needs a successful Test Connection.
    const row = await db('rmm_integrations')
      .where({ tenant: tenantData.tenant.tenantId, provider: 'datto' })
      .first(['instance_url', 'is_active', 'settings']);
    expect(row?.instance_url).toBe('https://merlot-api.centrastage.net/api');
    expect(row?.is_active).toBe(false);
    expect(row?.settings?.platform).toBe('merlot');
  } finally {
    if (tenantData) {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
    }
    await db.destroy().catch(() => undefined);
  }
});
