import { expect, test } from '@playwright/test';
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

const TEST_CONFIG = {
  baseUrl: resolvePlaywrightBaseUrl(),
};

const ADMIN_PERMISSIONS = [
  {
    roleName: 'Admin',
    permissions: [{ resource: 'system_settings', action: 'read' }],
  },
];

test('Integrations Settings -> RMM shows Tactical RMM in EE build', async ({ page }) => {
  test.setTimeout(180_000);

  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;

  try {
    tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Integrations EE ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });

    await page.goto(`${TEST_CONFIG.baseUrl}/msp/settings?tab=integrations&category=rmm`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    await expect(page.getByText('Tactical RMM', { exact: true })).toBeVisible({ timeout: 10_000 });
  } finally {
    if (tenantData) {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
    }
    await db.destroy().catch(() => undefined);
  }
});

