import { expect, test } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { rollbackTenant } from '../../lib/testing/tenant-creation';
import {
  applyPlaywrightAuthEnvDefaults,
  createTenantAndLogin,
  resolvePlaywrightBaseUrl,
  type TenantPermissionTuple,
} from './helpers/playwrightAuthSessionHelper';
import { WorkflowDesignerPage } from '../page-objects/WorkflowDesignerPage';

applyPlaywrightAuthEnvDefaults();

const BASE_URL = resolvePlaywrightBaseUrl();
const CE_STUB_TEXT = 'Workflow designer requires Enterprise Edition. Please upgrade to access this feature.';

const WORKFLOW_PERMISSIONS: TenantPermissionTuple[] = [
  { resource: 'user', action: 'read' },
  { resource: 'workflow', action: 'read' },
  { resource: 'workflow', action: 'manage' },
  { resource: 'workflow', action: 'publish' },
  { resource: 'workflow', action: 'admin' },
];

async function enableWorkflowAutomation(db: Knex, tenantId: string): Promise<void> {
  const now = new Date();
  const existing = await db('tenant_settings').where({ tenant: tenantId }).first();

  const existingSettings =
    existing && existing.settings && typeof existing.settings === 'object'
      ? (existing.settings as Record<string, any>)
      : {};

  const mergedSettings = {
    ...existingSettings,
    experimentalFeatures: {
      ...(existingSettings.experimentalFeatures ?? {}),
      workflowAutomation: true,
    },
  };

  await db('tenant_settings')
    .insert({
      tenant: tenantId,
      onboarding_completed: true,
      onboarding_completed_at: now,
      onboarding_skipped: false,
      onboarding_data: null,
      settings: mergedSettings,
      created_at: now,
      updated_at: now,
    })
    .onConflict('tenant')
    .merge({
      settings: mergedSettings,
      updated_at: now,
    });
}

test('EE workflows page loads designer (not CE stub)', async ({ page }) => {
  test.setTimeout(180_000);
  const db = createTestDbConnection();

  const tenantData = await createTenantAndLogin(db, page, {
    tenantOptions: {
      companyName: `Workflow UI Smoke ${uuidv4().slice(0, 6)}`,
    },
    completeOnboarding: { completedAt: new Date() },
    permissions: [
      {
        roleName: 'Admin',
        permissions: WORKFLOW_PERMISSIONS,
      },
    ],
  });

  try {
    await enableWorkflowAutomation(db, tenantData.tenant.tenantId);

    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    const workflowPage = new WorkflowDesignerPage(page);
    await workflowPage.goto(BASE_URL);

    await workflowPage.clickNewWorkflow();
    await expect(workflowPage.nameInput).toBeVisible();
    await expect(page.getByText(CE_STUB_TEXT)).toHaveCount(0);
  } finally {
    await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
    await db.destroy();
  }
});
