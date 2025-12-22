import { expect, test, type Page } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { rollbackTenant } from '../../lib/testing/tenant-creation';
import {
  applyPlaywrightAuthEnvDefaults,
  createTenantAndLogin,
  resolvePlaywrightBaseUrl,
  type TenantPermissionTuple
} from './helpers/playwrightAuthSessionHelper';
import { WorkflowDesignerPage } from '../page-objects/WorkflowDesignerPage';

applyPlaywrightAuthEnvDefaults();

const BASE_URL = resolvePlaywrightBaseUrl();

const MANAGE_ONLY_PERMISSIONS: TenantPermissionTuple[] = [
  { resource: 'user', action: 'read' },
  { resource: 'workflow', action: 'read' },
  { resource: 'workflow', action: 'manage' }
];

const PUBLISH_ONLY_PERMISSIONS: TenantPermissionTuple[] = [
  { resource: 'user', action: 'read' },
  { resource: 'workflow', action: 'read' },
  { resource: 'workflow', action: 'publish' }
];

const MANAGE_PERMISSIONS: TenantPermissionTuple[] = [
  { resource: 'user', action: 'read' },
  { resource: 'workflow', action: 'read' },
  { resource: 'workflow', action: 'manage' },
  { resource: 'workflow', action: 'publish' }
];

const READ_ONLY_PERMISSIONS: TenantPermissionTuple[] = [
  { resource: 'user', action: 'read' },
  { resource: 'workflow', action: 'read' }
];

const ADMIN_PERMISSIONS: TenantPermissionTuple[] = [
  { resource: 'user', action: 'read' },
  { resource: 'workflow', action: 'read' },
  { resource: 'workflow', action: 'admin' }
];

type WorkflowPlaywrightOverrides = {
  failSaveSettings?: boolean;
};

async function applyWorkflowOverrides(page: Page, overrides: WorkflowPlaywrightOverrides): Promise<void> {
  await page.addInitScript((config) => {
    (window as typeof window & { __ALGA_PLAYWRIGHT_WORKFLOW__?: WorkflowPlaywrightOverrides })
      .__ALGA_PLAYWRIGHT_WORKFLOW__ = config;
  }, overrides);
}

async function createWorkflowTenant(
  page: Page,
  permissions: TenantPermissionTuple[]
) {
  const db = createTestDbConnection();
  const tenantData = await createTenantAndLogin(db, page, {
    tenantOptions: {
      companyName: `Workflow UI ${uuidv4().slice(0, 6)}`
    },
    completeOnboarding: { completedAt: new Date() },
    permissions: [
      {
        roleName: 'Admin',
        permissions
      }
    ]
  });

  // Warm the session on the base URL to ensure cookies apply correctly
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });

  return { db, tenantData };
}

async function createSavedWorkflow(workflowPage: WorkflowDesignerPage): Promise<string> {
  await workflowPage.clickNewWorkflow();
  const workflowName = await workflowPage.nameInput.inputValue();
  await workflowPage.clickSaveDraft();
  await workflowPage.page.getByRole('button', { name: workflowName }).waitFor({ state: 'visible' });
  return workflowName;
}

test.describe('Workflow Designer UI - permissions and selection', () => {
  test('manage-only users see Save Draft but not Publish', async ({ page }) => {
    test.setTimeout(120000);
    const { db, tenantData } = await createWorkflowTenant(page, MANAGE_ONLY_PERMISSIONS);

    try {
      const workflowPage = new WorkflowDesignerPage(page);
      await workflowPage.goto();
      await workflowPage.waitForLoaded();

      await expect(workflowPage.saveDraftButton).toBeVisible();
      await expect(workflowPage.publishButton).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('publish-only users see Publish button enabled', async ({ page }) => {
    test.setTimeout(120000);
    const { db, tenantData } = await createWorkflowTenant(page, PUBLISH_ONLY_PERMISSIONS);

    try {
      const workflowPage = new WorkflowDesignerPage(page);
      await workflowPage.goto();
      await workflowPage.waitForLoaded();

      await expect(workflowPage.publishButton).toBeVisible();
      await expect(workflowPage.publishButton).toBeEnabled();
      await expect(workflowPage.saveDraftButton).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('active workflow button styling persists across tab switches', async ({ page }) => {
    test.setTimeout(120000);
    const { db, tenantData } = await createWorkflowTenant(page, MANAGE_PERMISSIONS);

    try {
      const workflowPage = new WorkflowDesignerPage(page);
      await workflowPage.goto();
      await workflowPage.waitForLoaded();

      const activeButton = page.getByRole('button', { name: 'Inbound Email Processing' });
      await expect(activeButton).toBeVisible();
      await expect(activeButton).toHaveClass(/bg-\[rgb\(var\(--color-primary-500\)\)\]/);

      await page.getByRole('tab', { name: 'Runs' }).click();
      await page.getByRole('tab', { name: 'Designer' }).click();
      await expect(activeButton).toBeVisible();
      await expect(activeButton).toHaveClass(/bg-\[rgb\(var\(--color-primary-500\)\)\]/);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('switching workflows clears selected step in config panel', async ({ page }) => {
    test.setTimeout(120000);
    const { db, tenantData } = await createWorkflowTenant(page, MANAGE_PERMISSIONS);
    const newWorkflowName = `Secondary ${uuidv4().slice(0, 6)}`;

    try {
      const workflowPage = new WorkflowDesignerPage(page);
      await workflowPage.goto();
      await workflowPage.waitForLoaded();

      await workflowPage.clickNewWorkflow();
      await workflowPage.setName(newWorkflowName);
      await workflowPage.clickSaveDraft();
      await page.getByRole('button', { name: newWorkflowName }).waitFor({ state: 'visible' });

      await workflowPage.selectWorkflowByName('Inbound Email Processing');
      await workflowPage.selectStepById('state-processing-inbound');
      await expect(page.locator('#workflow-step-name-state-processing-inbound')).toBeVisible();

      await workflowPage.selectWorkflowByName(newWorkflowName);
      await expect(page.getByText('Select a step to edit its configuration.')).toBeVisible();
    } finally {
      await db('workflow_definitions').where({ name: newWorkflowName }).del().catch(() => undefined);
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('read-only users see read-only message and cannot edit steps', async ({ page }) => {
    test.setTimeout(120000);
    const { db, tenantData } = await createWorkflowTenant(page, READ_ONLY_PERMISSIONS);

    try {
      const workflowPage = new WorkflowDesignerPage(page);
      await workflowPage.goto();
      await workflowPage.waitForLoaded();

      await workflowPage.selectWorkflowByName('Inbound Email Processing');
      await workflowPage.selectStepById('state-processing-inbound');

      await expect(page.getByText('Read-only access: step editing is disabled.')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('read-only users do not see New Workflow or Save Draft controls', async ({ page }) => {
    test.setTimeout(120000);
    const { db, tenantData } = await createWorkflowTenant(page, READ_ONLY_PERMISSIONS);

    try {
      const workflowPage = new WorkflowDesignerPage(page);
      await workflowPage.goto();
      await workflowPage.waitForLoaded();

      await expect(workflowPage.newWorkflowButton).toHaveCount(0);
      await expect(workflowPage.saveDraftButton).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('non-admin users do not see Dead Letter or Audit tabs', async ({ page }) => {
    test.setTimeout(120000);
    const { db, tenantData } = await createWorkflowTenant(page, MANAGE_PERMISSIONS);

    try {
      const workflowPage = new WorkflowDesignerPage(page);
      await workflowPage.goto();
      await workflowPage.waitForLoaded();

      await expect(page.getByRole('tab', { name: 'Dead Letter' })).toHaveCount(0);
      await expect(page.getByRole('tab', { name: 'Audit' })).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('workflow settings panel hidden for system workflows without admin', async ({ page }) => {
    test.setTimeout(120000);
    const { db, tenantData } = await createWorkflowTenant(page, MANAGE_ONLY_PERMISSIONS);

    try {
      const workflowPage = new WorkflowDesignerPage(page);
      await workflowPage.goto();
      await workflowPage.waitForLoaded();

      await expect(workflowPage.nameInput).toHaveValue('Inbound Email Processing');
      await expect(page.locator('#workflow-settings-save')).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('workflow settings panel visible for system workflows with admin', async ({ page }) => {
    test.setTimeout(120000);
    const { db, tenantData } = await createWorkflowTenant(page, ADMIN_PERMISSIONS);

    try {
      const workflowPage = new WorkflowDesignerPage(page);
      await workflowPage.goto();
      await workflowPage.waitForLoaded();

      await expect(workflowPage.nameInput).toHaveValue('Inbound Email Processing');
      await expect(page.locator('#workflow-settings-save')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('admin users can access Dead Letter and Audit tabs', async ({ page }) => {
    test.setTimeout(120000);
    const { db, tenantData } = await createWorkflowTenant(page, ADMIN_PERMISSIONS);

    try {
      const workflowPage = new WorkflowDesignerPage(page);
      await workflowPage.goto();
      await workflowPage.waitForLoaded();

      const deadLetterTab = page.getByRole('tab', { name: 'Dead Letter' });
      const auditTab = page.getByRole('tab', { name: 'Audit' });

      await expect(deadLetterTab).toBeVisible();
      await expect(auditTab).toBeVisible();

      await deadLetterTab.click();
      await expect(page.locator('#workflow-dead-letter-min-retries')).toBeVisible();

      await auditTab.click();
      await expect(page.locator('#workflow-audit-export')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('workflow settings toggles update draft values', async ({ page }) => {
    test.setTimeout(120000);
    const { db, tenantData } = await createWorkflowTenant(page, ADMIN_PERMISSIONS);
    let workflowName = '';

    try {
      const workflowPage = new WorkflowDesignerPage(page);
      await workflowPage.goto();
      await workflowPage.waitForLoaded();

      workflowName = await createSavedWorkflow(workflowPage);

      const visibleToggle = page.locator('[data-automation-id="workflow-settings-visible"]');
      const pausedToggle = page.locator('[data-automation-id="workflow-settings-paused"]');
      const concurrencyInput = page.locator('[data-automation-id="workflow-settings-concurrency"]');
      const autoPauseToggle = page.locator('[data-automation-id="workflow-settings-auto-pause"]');
      const failureThresholdInput = page.locator('[data-automation-id="workflow-settings-failure-threshold"]');
      const failureMinInput = page.locator('[data-automation-id="workflow-settings-failure-min"]');

      await expect(page.locator('#workflow-settings-save')).toBeVisible();

      const visibleState = await visibleToggle.getAttribute('data-state');
      await visibleToggle.click();
      await expect(visibleToggle).toHaveAttribute(
        'data-state',
        visibleState === 'checked' ? 'unchecked' : 'checked'
      );

      const pausedState = await pausedToggle.getAttribute('data-state');
      await pausedToggle.click();
      await expect(pausedToggle).toHaveAttribute(
        'data-state',
        pausedState === 'checked' ? 'unchecked' : 'checked'
      );

      await concurrencyInput.fill('5');
      await expect(concurrencyInput).toHaveValue('5');
      await concurrencyInput.fill('');
      await expect(concurrencyInput).toHaveValue('');

      await expect(failureThresholdInput).toBeDisabled();
      await expect(failureMinInput).toBeDisabled();

      await autoPauseToggle.click();
      await expect(failureThresholdInput).toBeEnabled();
      await expect(failureMinInput).toBeEnabled();
    } finally {
      if (workflowName) {
        await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      }
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('save settings persists workflow metadata overrides', async ({ page }) => {
    test.setTimeout(120000);
    const { db, tenantData } = await createWorkflowTenant(page, ADMIN_PERMISSIONS);
    let workflowName = '';

    try {
      const workflowPage = new WorkflowDesignerPage(page);
      await workflowPage.goto();
      await workflowPage.waitForLoaded();

      workflowName = await createSavedWorkflow(workflowPage);

      const visibleToggle = page.locator('[data-automation-id="workflow-settings-visible"]');
      const pausedToggle = page.locator('[data-automation-id="workflow-settings-paused"]');
      const concurrencyInput = page.locator('[data-automation-id="workflow-settings-concurrency"]');
      const autoPauseToggle = page.locator('[data-automation-id="workflow-settings-auto-pause"]');
      const failureThresholdInput = page.locator('[data-automation-id="workflow-settings-failure-threshold"]');
      const failureMinInput = page.locator('[data-automation-id="workflow-settings-failure-min"]');
      const saveButton = page.locator('#workflow-settings-save');

      if ((await visibleToggle.getAttribute('data-state')) === 'checked') {
        await visibleToggle.click();
      }
      if ((await pausedToggle.getAttribute('data-state')) !== 'checked') {
        await pausedToggle.click();
      }
      if ((await autoPauseToggle.getAttribute('data-state')) !== 'checked') {
        await autoPauseToggle.click();
      }

      await concurrencyInput.fill('3');
      await failureThresholdInput.fill('0.25');
      await failureMinInput.fill('7');

      await saveButton.click();
      await expect(saveButton).toBeEnabled();

      await page.reload({ waitUntil: 'domcontentloaded' });
      await workflowPage.waitForLoaded();
      await workflowPage.selectWorkflowByName(workflowName);

      await expect(visibleToggle).toHaveAttribute('data-state', 'unchecked');
      await expect(pausedToggle).toHaveAttribute('data-state', 'checked');
      await expect(concurrencyInput).toHaveValue('3');
      await expect(autoPauseToggle).toHaveAttribute('data-state', 'checked');
      await expect(failureThresholdInput).toHaveValue('0.25');
      await expect(failureMinInput).toHaveValue('7');

      const record = await db('workflow_definitions').where({ name: workflowName }).first();
      expect(record).toBeTruthy();
      expect(record.is_visible).toBe(false);
      expect(record.is_paused).toBe(true);
      expect(Number(record.concurrency_limit)).toBe(3);
      expect(record.auto_pause_on_failure).toBe(true);
      expect(Number(record.failure_rate_threshold)).toBeCloseTo(0.25, 3);
      expect(Number(record.failure_rate_min_runs)).toBe(7);
    } finally {
      if (workflowName) {
        await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      }
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('save settings error surfaces toast without losing draft values', async ({ page }) => {
    test.setTimeout(120000);
    await applyWorkflowOverrides(page, { failSaveSettings: true });

    const { db, tenantData } = await createWorkflowTenant(page, ADMIN_PERMISSIONS);
    let workflowName = '';

    try {
      const workflowPage = new WorkflowDesignerPage(page);
      await workflowPage.goto();
      await workflowPage.waitForLoaded();

      workflowName = await createSavedWorkflow(workflowPage);

      const visibleToggle = page.locator('[data-automation-id="workflow-settings-visible"]');
      const pausedToggle = page.locator('[data-automation-id="workflow-settings-paused"]');
      const concurrencyInput = page.locator('[data-automation-id="workflow-settings-concurrency"]');
      const autoPauseToggle = page.locator('[data-automation-id="workflow-settings-auto-pause"]');
      const failureThresholdInput = page.locator('[data-automation-id="workflow-settings-failure-threshold"]');
      const failureMinInput = page.locator('[data-automation-id="workflow-settings-failure-min"]');
      const saveButton = page.locator('#workflow-settings-save');

      if ((await visibleToggle.getAttribute('data-state')) === 'checked') {
        await visibleToggle.click();
      }
      if ((await pausedToggle.getAttribute('data-state')) !== 'checked') {
        await pausedToggle.click();
      }
      if ((await autoPauseToggle.getAttribute('data-state')) !== 'checked') {
        await autoPauseToggle.click();
      }

      await concurrencyInput.fill('4');
      await failureThresholdInput.fill('0.5');
      await failureMinInput.fill('9');

      await saveButton.click();
      await expect(page.getByText('Failed to update workflow settings')).toBeVisible();

      await expect(visibleToggle).toHaveAttribute('data-state', 'unchecked');
      await expect(pausedToggle).toHaveAttribute('data-state', 'checked');
      await expect(concurrencyInput).toHaveValue('4');
      await expect(autoPauseToggle).toHaveAttribute('data-state', 'checked');
      await expect(failureThresholdInput).toHaveValue('0.5');
      await expect(failureMinInput).toHaveValue('9');
    } finally {
      if (workflowName) {
        await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      }
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});
