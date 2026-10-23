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

test('Datto webhook config UI shows the custom header, secret, and body templates', async ({ page }) => {
  test.setTimeout(300_000);

  const baseUrl = resolvePlaywrightBaseUrl();
  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;

  try {
    const clientName = `Datto Webhook UI ${uuidv4().slice(0, 6)}`;
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

    const url = page.locator('#datto-rmm-webhook-url');
    await url.scrollIntoViewIfNeeded();
    // The tenant travels in the query; the secret never does.
    await expect(url).toHaveValue(
      new RegExp(`/api/webhooks/datto\\?tenant=${tenantData.tenant.tenantId}$`),
      { timeout: 30_000 }
    );

    const headerName = page.locator('#datto-rmm-webhook-header-name');
    await headerName.scrollIntoViewIfNeeded();
    await expect(headerName).toHaveValue('X-Alga-Webhook-Secret', { timeout: 30_000 });

    // The secret is generated on first view, masked by default, and revealable.
    const secret = page.locator('#datto-rmm-webhook-secret');
    await expect(secret).toHaveAttribute('type', 'password');
    await expect(secret).toHaveValue(/^[0-9a-f]{48}$/);
    await page.locator('#datto-rmm-toggle-webhook-secret').click();
    await expect(secret).toHaveAttribute('type', 'text');

    const body = page.locator('#datto-rmm-webhook-body-template');
    await body.scrollIntoViewIfNeeded();
    await expect(body).toHaveValue(/"alertUid"/i, { timeout: 30_000 });
    await expect(body).toHaveValue(/"event": "trigger"/);

    const resolveBody = page.locator('#datto-rmm-webhook-resolve-body-template');
    await expect(resolveBody).toHaveValue(/"event": "resolve"/);

    // The same secret is returned on the next load rather than regenerated.
    const firstSecret = await secret.inputValue();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    await selectDattoRmmIfSelectorPresent(page);
    await expect(page.locator('#datto-rmm-webhook-secret')).toHaveValue(firstSecret, { timeout: 30_000 });
  } finally {
    if (tenantData) {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
    }
    await db.destroy().catch(() => undefined);
  }
});
