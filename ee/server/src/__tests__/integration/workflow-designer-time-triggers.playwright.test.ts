import { expect, test, type Page } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF } from '@shared/workflow/runtime';
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

function parseJsonValue<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

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

  await ensureSystemEmailWorkflow(db);
  await page.goto(`${TEST_CONFIG.baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 });

  const workflowPage = new WorkflowDesignerPage(page);
  await workflowPage.goto(TEST_CONFIG.baseUrl);
  await workflowPage.waitForLoaded();
  return { db, tenantData, workflowPage };
}

test.describe('Workflow Designer UI - time triggers', () => {
  test('T018: user can select One-time schedule trigger and save a draft definition', async ({ page }) => {
    test.setTimeout(180000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const workflowName = `One-time ${uuidv4().slice(0, 8)}`;
    const localRunAt = '2030-05-01T09:30';

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.setName(workflowName);
      await workflowPage.selectTriggerType('One-time schedule');
      await workflowPage.setOneTimeRunAt(localRunAt);

      await expect(page.locator('#workflow-designer-trigger-schedule-panel')).toBeVisible();
      await expect(page.locator('#workflow-designer-trigger-clock-contract')).toContainText(WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF);

      await workflowPage.saveDraft();

      const row = await db('workflow_definitions')
        .where({ name: workflowName, tenant: tenantData.tenant.tenantId })
        .first([
          'trigger',
          'draft_definition',
          'payload_schema_ref',
          'payload_schema_mode',
          'pinned_payload_schema_ref'
        ]);

      expect(row).toBeDefined();
      const trigger = parseJsonValue<{ type: string; runAt?: string }>(row?.trigger);
      const draftDefinition = parseJsonValue<{ trigger?: { type: string; runAt?: string } }>(row?.draft_definition);

      expect(trigger.type).toBe('schedule');
      expect(trigger.runAt).toBe(new Date(localRunAt).toISOString());
      expect(draftDefinition.trigger?.type).toBe('schedule');
      expect(row?.payload_schema_ref).toBe(WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF);
      expect(row?.payload_schema_mode).toBe('pinned');
      expect(row?.pinned_payload_schema_ref).toBe(WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF);
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('T019: user can select Recurring schedule trigger and save a draft definition', async ({ page }) => {
    test.setTimeout(180000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const workflowName = `Recurring ${uuidv4().slice(0, 8)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.setName(workflowName);
      await workflowPage.selectTriggerType('Recurring schedule');
      await workflowPage.setRecurringCron('15 9 * * 1-5');
      await workflowPage.selectRecurringTimezone('America/New_York');

      await expect(page.locator('#workflow-designer-trigger-recurring-panel')).toBeVisible();

      await workflowPage.saveDraft();

      const row = await db('workflow_definitions')
        .where({ name: workflowName, tenant: tenantData.tenant.tenantId })
        .first([
          'trigger',
          'draft_definition',
          'payload_schema_ref',
          'payload_schema_mode',
          'pinned_payload_schema_ref'
        ]);

      expect(row).toBeDefined();
      const trigger = parseJsonValue<{ type: string; cron?: string; timezone?: string }>(row?.trigger);
      const draftDefinition = parseJsonValue<{ trigger?: { type: string; cron?: string; timezone?: string } }>(row?.draft_definition);

      expect(trigger).toEqual({
        type: 'recurring',
        cron: '15 9 * * 1-5',
        timezone: 'America/New_York'
      });
      expect(draftDefinition.trigger).toEqual({
        type: 'recurring',
        cron: '15 9 * * 1-5',
        timezone: 'America/New_York'
      });
      expect(row?.payload_schema_ref).toBe(WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF);
      expect(row?.payload_schema_mode).toBe('pinned');
      expect(row?.pinned_payload_schema_ref).toBe(WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF);
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('T020: time-trigger selection hides event catalog and trigger mapping controls', async ({ page }) => {
    test.setTimeout(180000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.selectTriggerType('Event');
      await workflowPage.selectTriggerEvent('INBOUND_EMAIL_RECEIVED');
      await workflowPage.ensureContractAdvancedOpen();

      await expect(workflowPage.triggerInput).toBeVisible();
      await expect(page.locator('#workflow-designer-trigger-source-schema')).toBeVisible();

      await workflowPage.selectTriggerType('One-time schedule');

      await expect(workflowPage.triggerInput).toHaveCount(0);
      await expect(page.locator('#workflow-designer-trigger-source-schema')).toHaveCount(0);
      await expect(page.locator('#workflow-designer-trigger-mapping-toggle')).toHaveCount(0);
      await expect(page.locator('#workflow-designer-trigger-schedule-panel')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('T021: time-trigger selection shows the fixed clock payload schema preview', async ({ page }) => {
    test.setTimeout(180000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.selectTriggerType('Recurring schedule');

      const contractCard = page.locator('#workflow-designer-trigger-clock-contract');
      await expect(contractCard).toBeVisible();
      await expect(contractCard).toContainText(WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF);
      await expect(contractCard).toContainText('triggerType');
      await expect(contractCard).toContainText('scheduleId');
      await expect(contractCard).toContainText('scheduledFor');
      await expect(contractCard).toContainText('firedAt');
      await expect(contractCard).toContainText('timezone');
      await expect(contractCard).toContainText('workflowId');
      await expect(contractCard).toContainText('workflowVersion');
      await expect(contractCard).toContainText('cron (recurring only)');
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});
