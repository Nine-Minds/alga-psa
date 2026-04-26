import { expect, test, type Page } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { rollbackTenant } from '../../lib/testing/tenant-creation';
import type { TenantTestData } from '../../lib/testing/tenant-test-factory';
import {
  applyPlaywrightAuthEnvDefaults,
  createTenantAndLogin,
  resolvePlaywrightBaseUrl
} from './helpers/playwrightAuthSessionHelper';
import { ensureSystemEmailWorkflow } from './helpers/workflowSeedHelper';
import { WorkflowDesignerPage } from '../page-objects/WorkflowDesignerPage';

applyPlaywrightAuthEnvDefaults();

const TEST_CONFIG = {
  baseUrl: resolvePlaywrightBaseUrl()
};

const ADMIN_PERMISSIONS = [
  {
    roleName: 'Admin',
    permissions: [
      { resource: 'user', action: 'read' },
      { resource: 'workflow', action: 'manage' },
      { resource: 'workflow', action: 'publish' },
      { resource: 'workflow', action: 'admin' }
    ]
  }
];

async function setupDesigner(page: Page): Promise<{
  db: Knex;
  tenantData: TenantTestData;
  workflowPage: WorkflowDesignerPage;
}> {
  const db = createTestDbConnection();
  const tenantData = await createTenantAndLogin(db, page, {
    tenantOptions: {
      companyName: `Workflow Trigger ${uuidv4().slice(0, 6)}`
    },
    completeOnboarding: { completedAt: new Date() },
    permissions: ADMIN_PERMISSIONS
  });

  await ensureSystemEmailWorkflow(db, tenantData.tenant.tenantId);
  await page.goto(`${TEST_CONFIG.baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 });

  const workflowPage = new WorkflowDesignerPage(page);
  await workflowPage.goto(TEST_CONFIG.baseUrl);
  await workflowPage.waitForLoaded();
  return { db, tenantData, workflowPage };
}

test.describe('Workflow Designer UI - external schedules', () => {
  test('T047: trigger selector only shows No trigger and Event', async ({ page }) => {
    test.setTimeout(180000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.triggerTypeInput.click();

      await expect(page.getByRole('option', { name: 'No trigger', exact: true })).toBeVisible();
      await expect(page.getByRole('option', { name: 'Event', exact: true })).toBeVisible();
      await expect(page.getByRole('option', { name: 'One-time schedule', exact: true })).toHaveCount(0);
      await expect(page.getByRole('option', { name: 'Recurring schedule', exact: true })).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('T048: one-time and recurring inline trigger panels are removed', async ({ page }) => {
    test.setTimeout(180000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);

    try {
      await workflowPage.clickNewWorkflow();

      await expect(page.locator('#workflow-designer-trigger-schedule-panel')).toHaveCount(0);
      await expect(page.locator('#workflow-designer-trigger-recurring-panel')).toHaveCount(0);
      await expect(page.locator('#workflow-designer-trigger-clock-contract')).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('T049: no-trigger workflow still allows manual run using the existing run dialog', async ({ page }) => {
    test.setTimeout(180000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const workflowName = `Manual Run ${uuidv4().slice(0, 8)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.setName(workflowName);
      await workflowPage.setContractModePinned();
      await workflowPage.saveDraft();

      await expect(page.locator('#workflow-designer-run')).toBeEnabled({ timeout: 60_000 });
      await page.locator('#workflow-designer-run').click();

      await expect(page.getByRole('dialog', { name: /Run Workflow/i })).toBeVisible();
      await expect(page.getByText('Start Run')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('T050: event-trigger workflow still shows event catalog and mapping controls', async ({ page }) => {
    test.setTimeout(180000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.selectTriggerType('Event');
      await workflowPage.selectTriggerEvent('INBOUND_EMAIL_RECEIVED');
      await workflowPage.ensureContractAdvancedOpen();

      await expect(workflowPage.triggerInput).toBeVisible();
      await expect(page.locator('#workflow-designer-trigger-source-schema')).toBeVisible();
      await expect(page.getByText('Trigger mapping', { exact: true })).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('T051: workflow-context schedules link opens the schedules screen filtered to the current workflow', async ({ page }) => {
    test.setTimeout(180000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const workflowName = `Schedules Link ${uuidv4().slice(0, 8)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.setName(workflowName);
      await workflowPage.saveDraft();

      const currentUrl = new URL(page.url());
      const workflowId = currentUrl.searchParams.get('workflowId');
      expect(workflowId).toBeTruthy();

      await workflowPage.schedulesButton.click();

      await expect(page).toHaveURL(new RegExp(`tab=schedules.*scheduleWorkflowId=${workflowId}`));
      await expect(page.getByRole('heading', { name: 'Schedules' })).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});
