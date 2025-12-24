import { expect, test, type Page } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { rollbackTenant } from '../../lib/testing/tenant-creation';
import type { TenantTestData } from '../../lib/testing/tenant-test-factory';
import {
  applyPlaywrightAuthEnvDefaults,
  createTenantAndLogin,
  resolvePlaywrightBaseUrl,
} from './helpers/playwrightAuthSessionHelper';
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

async function setupDesigner(page: Page): Promise<{
  db: Knex;
  tenantData: TenantTestData;
  workflowPage: WorkflowDesignerPage;
}> {
  const db = createTestDbConnection();
  const tenantData = await createTenantAndLogin(db, page, {
    tenantOptions: {
      companyName: `Workflow UI ${uuidv4().slice(0, 6)}`,
    },
    completeOnboarding: { completedAt: new Date() },
    permissions: ADMIN_PERMISSIONS,
  });

  await page.goto(`${TEST_CONFIG.baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 });

  const workflowPage = new WorkflowDesignerPage(page);
  await workflowPage.goto(TEST_CONFIG.baseUrl);
  return { db, tenantData, workflowPage };
}

async function addActionCallStep(page: Page, workflowPage: WorkflowDesignerPage): Promise<string> {
  await workflowPage.clickNewWorkflow();
  await workflowPage.addButtonFor('action.call').click();
  const stepId = await workflowPage.getFirstStepId();
  await workflowPage.stepSelectButton(stepId).click();
  return stepId;
}

test.describe('Workflow Designer UI - config fields', () => {
  test('node config renders string and number inputs for action.call schema', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      const stepId = await addActionCallStep(page, workflowPage);

      const actionIdInput = page.locator(`#config-${stepId}-actionId`);
      const versionInput = page.locator(`#config-${stepId}-version`);

      await expect(actionIdInput).toBeVisible();
      await expect(versionInput).toBeVisible();
      const actionType = await actionIdInput.getAttribute('type');
      expect(actionType === null || actionType === 'text').toBeTruthy();
      await expect(versionInput).toHaveAttribute('type', 'number');
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('json field invalid JSON shows validation error', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      const stepId = await addActionCallStep(page, workflowPage);

      const inputMappingField = page.locator(`#config-${stepId}-inputMapping-json`);
      await inputMappingField.fill('{');

      await expect(page.getByText('Invalid JSON')).toBeVisible();
      await expect(inputMappingField).toHaveClass(/border-red-500/);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('json field accepts valid JSON, clears error, and persists formatted value', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const workflowName = `UI Action Call ${uuidv4().slice(0, 6)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.nameInput.fill(workflowName);
      await workflowPage.addButtonFor('action.call').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(stepId).click();

      const inputMappingField = page.locator(`#config-${stepId}-inputMapping-json`);
      await inputMappingField.fill('{');
      await expect(page.getByText('Invalid JSON')).toBeVisible();

      const payload = '{"foo":"bar","count":2}';
      await inputMappingField.fill(payload);
      await expect(page.getByText('Invalid JSON')).toHaveCount(0);

      await workflowPage.saveDraft();
      await page.getByRole('button', { name: workflowName }).waitFor({ state: 'visible' });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await workflowPage.waitForLoaded();
      await workflowPage.selectWorkflowByName(workflowName);
      await workflowPage.stepSelectButton(stepId).click();

      const expectedFormatted = '{\n  "foo": "bar",\n  "count": 2\n}';
      await expect(page.locator(`#config-${stepId}-inputMapping-json`)).toHaveValue(expectedFormatted);
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('action.call config shows available actions count', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('action.call').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(stepId).click();

      const availableActions = page.getByText(/Available actions:\s*\d+/);
      await expect(availableActions).toBeVisible();
      const text = await availableActions.textContent();
      const match = text?.match(/Available actions:\s*(\d+)/);
      expect(match).not.toBeNull();
      expect(Number(match?.[1] ?? 0)).toBeGreaterThan(0);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('action.call config inputMapping/saveAs/idempotencyKey persist after save', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const workflowName = `UI Action Call Persist ${uuidv4().slice(0, 6)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.nameInput.fill(workflowName);
      await workflowPage.addButtonFor('action.call').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(stepId).click();

      await page.locator(`#config-${stepId}-actionId`).fill('test.action');
      await page.locator(`#config-${stepId}-version`).fill('2');
      await page.locator(`#config-${stepId}-saveAs`).fill('payload.actionResult');
      await page.locator(`#config-${stepId}-idempotencyKey-expr`).fill('payload.messageId');
      await page.locator(`#config-${stepId}-inputMapping-json`).fill('{"foo":"bar"}');

      await workflowPage.saveDraft();
      await page.getByRole('button', { name: workflowName }).waitFor({ state: 'visible' });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await workflowPage.waitForLoaded();
      await workflowPage.selectWorkflowByName(workflowName);
      await workflowPage.stepSelectButton(stepId).click();

      await expect(page.locator(`#config-${stepId}-actionId`)).toHaveValue('test.action');
      await expect(page.locator(`#config-${stepId}-version`)).toHaveValue('2');
      await expect(page.locator(`#config-${stepId}-saveAs`)).toHaveValue('payload.actionResult');
      await expect(page.locator(`#config-${stepId}-idempotencyKey-expr`)).toHaveValue('payload.messageId');
      await expect(page.locator(`#config-${stepId}-inputMapping-json`)).toHaveValue(/"foo": "bar"/);
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});
