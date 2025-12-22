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

async function getStepIds(page: Page): Promise<string[]> {
  const buttons = page.locator('[id^="workflow-step-select-"]');
  const count = await buttons.count();
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = await buttons.nth(i).getAttribute('id');
    if (id) {
      ids.push(id.replace('workflow-step-select-', ''));
    }
  }
  return ids;
}

type WorkflowPlaywrightOverrides = {
  failPublish?: boolean;
  publishDelayMs?: number;
};

async function applyWorkflowOverrides(page: Page, overrides: WorkflowPlaywrightOverrides): Promise<void> {
  await page.addInitScript((config) => {
    (window as typeof window & { __ALGA_PLAYWRIGHT_WORKFLOW__?: WorkflowPlaywrightOverrides })
      .__ALGA_PLAYWRIGHT_WORKFLOW__ = config;
  }, overrides);
}

async function setupDesigner(page: Page): Promise<{
  db: Knex;
  tenantData: TenantTestData;
  workflowPage: WorkflowDesignerPage;
}>;
async function setupDesigner(
  page: Page,
  overrides?: WorkflowPlaywrightOverrides
): Promise<{
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

  if (overrides) {
    await applyWorkflowOverrides(page, overrides);
  }

  await page.goto(`${TEST_CONFIG.baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 });

  const workflowPage = new WorkflowDesignerPage(page);
  await workflowPage.goto(TEST_CONFIG.baseUrl);
  return { db, tenantData, workflowPage };
}

test.describe('Workflow Designer UI - publish', () => {
  test('publish without saving draft shows toast instructing to save first', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.publishButton.click();
      await expect(page.getByText('Save the workflow before publishing')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('publish failure shows error cards, breadcrumbs, and step badges', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const workflowName = `UI Publish Errors ${uuidv4().slice(0, 6)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.nameInput.fill(workflowName);
      await workflowPage.addButtonFor('action.call').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.saveDraft();
      await page.getByRole('button', { name: workflowName }).waitFor({ state: 'visible' });

      await workflowPage.publishButton.click();
      await expect(page.getByText('Publish failed - fix validation errors')).toBeVisible();

      const errorHeading = page.getByRole('heading', { name: 'Publish Errors' });
      await expect(errorHeading).toBeVisible();
      const errorCards = errorHeading.locator('..').locator('.border-red-200');
      await expect(errorCards.first()).toBeVisible();
      await expect(errorCards.first()).toContainText(/INVALID_/);
      await expect(errorCards.first().locator('div').nth(1)).not.toHaveText('');

      const breadcrumb = errorCards.first().locator('div').last();
      await expect(breadcrumb).toContainText('action.call');

      const errorBadge = workflowPage.stepSelectButton(stepId).getByText(/\d+ errors/);
      await expect(errorBadge).toBeVisible();
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('publish warnings display warning badge count', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const workflowName = `UI Publish Warnings ${uuidv4().slice(0, 6)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.nameInput.fill(workflowName);
      await workflowPage.addButtonFor('transform.assign').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(stepId).click();

      await page.locator(`#config-${stepId}-assign-add`).click();
      await page.locator(`#config-${stepId}-assign-key-0`).fill('payload.unknownField');
      await page.locator(`#config-${stepId}-assign-expr-0-expr`).fill('payload.subject');

      await workflowPage.saveDraft();
      await page.getByRole('button', { name: workflowName }).waitFor({ state: 'visible' });

      await workflowPage.publishButton.click();
      await expect(page.getByText('Workflow published')).toBeVisible();

      const warningBadge = page.getByText(/\d+ warnings/);
      await expect(warningBadge).toBeVisible();
      const text = await warningBadge.textContent();
      const match = text?.match(/(\d+)\s+warnings/);
      expect(match).not.toBeNull();
      expect(Number(match?.[1] ?? 0)).toBeGreaterThan(0);
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('publish success clears publish errors and warnings', async ({ page }) => {
    test.setTimeout(150000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const workflowName = `UI Publish Clear ${uuidv4().slice(0, 6)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.nameInput.fill(workflowName);
      await workflowPage.addButtonFor('action.call').click();
      await workflowPage.addButtonFor('transform.assign').click();

      const [actionStepId, assignStepId] = await getStepIds(page);
      await workflowPage.stepSelectButton(assignStepId).click();
      await page.locator(`#config-${assignStepId}-assign-add`).click();
      await page.locator(`#config-${assignStepId}-assign-key-0`).fill('payload.unknownField');
      await page.locator(`#config-${assignStepId}-assign-expr-0-expr`).fill('payload.tenantId');

      await workflowPage.saveDraft();
      await page.getByRole('button', { name: workflowName }).waitFor({ state: 'visible' });

      await workflowPage.publishButton.click();
      await expect(page.getByText('Publish failed - fix validation errors')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Publish Errors' })).toBeVisible();
      await expect(page.getByText(/\d+ warnings/)).toBeVisible();

      await workflowPage.stepDeleteButton(actionStepId).click();
      await workflowPage.stepDeleteButton(assignStepId).click();

      await workflowPage.publishButton.click();
      await expect(page.getByText('Workflow published')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Publish Errors' })).toHaveCount(0);
      await expect(page.getByText(/\d+ warnings/)).toHaveCount(0);
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('publish errors reset when switching workflows', async ({ page }) => {
    test.setTimeout(150000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const workflowNameA = `UI Publish Errors ${uuidv4().slice(0, 6)}`;
    const workflowNameB = `UI Publish Clean ${uuidv4().slice(0, 6)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.nameInput.fill(workflowNameA);
      await workflowPage.addButtonFor('action.call').click();
      await workflowPage.saveDraft();
      await page.getByRole('button', { name: workflowNameA }).waitFor({ state: 'visible' });

      await workflowPage.clickNewWorkflow();
      await workflowPage.nameInput.fill(workflowNameB);
      await workflowPage.saveDraft();
      await page.getByRole('button', { name: workflowNameB }).waitFor({ state: 'visible' });

      await workflowPage.selectWorkflowByName(workflowNameA);
      await workflowPage.publishButton.click();
      await expect(page.getByText('Publish failed - fix validation errors')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Publish Errors' })).toBeVisible();

      await workflowPage.selectWorkflowByName(workflowNameB);
      await expect(page.getByRole('heading', { name: 'Publish Errors' })).toHaveCount(0);
      await expect(page.getByText(/\d+ warnings/)).toHaveCount(0);
    } finally {
      await db('workflow_definitions').whereIn('name', [workflowNameA, workflowNameB]).del().catch(() => undefined);
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('publish button disables while publish in progress', async ({ page }) => {
    test.setTimeout(150000);

    const { db, tenantData, workflowPage } = await setupDesigner(page, { publishDelayMs: 1500 });
    const workflowName = `UI Publish Delay ${uuidv4().slice(0, 6)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.nameInput.fill(workflowName);
      await workflowPage.saveDraft();
      await page.getByRole('button', { name: workflowName }).waitFor({ state: 'visible' });

      await workflowPage.publishButton.click();
      await expect(workflowPage.publishButton).toBeDisabled();
      await expect(workflowPage.publishButton).toHaveText('Publishing...');

      await expect(page.getByText('Workflow published')).toBeVisible();
      await expect(workflowPage.publishButton).toBeEnabled();
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('publish action failure shows toast and preserves draft', async ({ page }) => {
    test.setTimeout(150000);

    const { db, tenantData, workflowPage } = await setupDesigner(page, { failPublish: true });
    const workflowName = `UI Publish Fail ${uuidv4().slice(0, 6)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.nameInput.fill(workflowName);
      await workflowPage.addButtonFor('transform.assign').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.saveDraft();
      await page.getByRole('button', { name: workflowName }).waitFor({ state: 'visible' });

      await workflowPage.publishButton.click();
      await expect(page.getByText('Failed to publish workflow')).toBeVisible();
      await expect(workflowPage.nameInput).toHaveValue(workflowName);
      await expect(workflowPage.stepSelectButton(stepId)).toBeVisible();
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('publish success sets latest published version in UI', async ({ page }) => {
    test.setTimeout(150000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const workflowName = `UI Publish Version ${uuidv4().slice(0, 6)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.nameInput.fill(workflowName);
      await workflowPage.versionInput.fill('2');
      await workflowPage.saveDraft();
      await page.getByRole('button', { name: workflowName }).waitFor({ state: 'visible' });

      await workflowPage.publishButton.click();
      await expect(page.getByText('Workflow published')).toBeVisible();
      await expect(page.locator('#workflow-designer-published-version')).toContainText('2');
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});
