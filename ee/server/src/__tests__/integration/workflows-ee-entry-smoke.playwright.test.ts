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
import { ensureSystemEmailWorkflow } from './helpers/workflowSeedHelper';
import { WorkflowDesignerPage } from '../page-objects/WorkflowDesignerPage';

applyPlaywrightAuthEnvDefaults();

const TEST_CONFIG = {
  baseUrl: resolvePlaywrightBaseUrl(),
};

const ADMIN_PERMISSIONS = [
  {
    roleName: 'Admin',
    permissions: [
      { resource: 'user', action: 'read' },
      { resource: 'workflow', action: 'manage' },
      { resource: 'workflow', action: 'publish' },
      { resource: 'workflow', action: 'admin' },
    ],
  },
];

test('EE build: workflows page loads without CE/OSS stub messaging', async ({ page }) => {
  test.setTimeout(180_000);

  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;

  try {
    tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `EE workflows smoke ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });

    await ensureSystemEmailWorkflow(db);

    const workflowPage = new WorkflowDesignerPage(page);
    await workflowPage.goto(TEST_CONFIG.baseUrl);

    await expect(page.getByText('Workflow designer requires Enterprise Edition. Please upgrade to access this feature.')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Enterprise Feature' })).toHaveCount(0);
    await expect(workflowPage.header).toBeVisible();
  } finally {
    if (tenantData) {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
    }
    await db.destroy();
  }
});

