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

  const workflowPage = new WorkflowDesignerPage(page);
  await workflowPage.goto(TEST_CONFIG.baseUrl);
  return { db, tenantData, workflowPage };
}

async function createIfStep(page: Page, workflowPage: WorkflowDesignerPage): Promise<string> {
  await workflowPage.clickNewWorkflow();
  await workflowPage.addButtonFor('control.if').click();
  const stepId = await workflowPage.getFirstStepId();
  await workflowPage.stepSelectButton(stepId).click();
  return stepId;
}

async function openExpressionPicker(page: Page, idPrefix: string): Promise<void> {
  const trigger = page
    .locator(`#${idPrefix}-picker [role="combobox"]`)
    .or(page.locator(`#${idPrefix}-picker button`));
  await trigger.first().click();
}

test.describe('Workflow Designer UI - expressions', () => {
  test('field picker includes payload, vars, meta, and error roots', async ({ page }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page);

    try {
      const stepId = await createIfStep(page, workflowPage);
      const idPrefix = `if-condition-${stepId}`;

      await openExpressionPicker(page, idPrefix);
      const listbox = page.locator('[role="listbox"]');
      await expect(listbox).toBeVisible({ timeout: 15000 });
      await expect(listbox).toContainText('payload', { timeout: 15000 });
      await expect(listbox).toContainText('vars');
      await expect(listbox).toContainText('meta');
      await expect(listbox).toContainText('meta.state');
      await expect(listbox).toContainText('meta.traceId');
      await expect(listbox).toContainText('error');
      await expect(listbox).toContainText('error.message');
      await page.keyboard.press('Escape');
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('expression field inserts selected payload field from picker', async ({ page }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page);

    try {
      const stepId = await createIfStep(page, workflowPage);
      const idPrefix = `if-condition-${stepId}`;
      const exprField = page.locator(`#${idPrefix}-expr`);

      await openExpressionPicker(page, idPrefix);
      await page.getByRole('option', { name: 'payload' }).click();

      await expect(exprField).toHaveValue('payload');
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('expression field combines existing text with inserted field', async ({ page }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page);

    try {
      const stepId = await createIfStep(page, workflowPage);
      const idPrefix = `if-condition-${stepId}`;
      const exprField = page.locator(`#${idPrefix}-expr`);

      await exprField.fill('payload.subject ==');
      await openExpressionPicker(page, idPrefix);
      await page.getByRole('option', { name: 'payload' }).click();

      await expect(exprField).toHaveValue(/payload\.subject == payload/);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('expression field shows validation error for invalid syntax and clears on valid', async ({ page }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page);

    try {
      const stepId = await createIfStep(page, workflowPage);
      const exprField = page.locator(`#if-condition-${stepId}-expr`);

      await exprField.fill('(');
      await expect(exprField).toHaveClass(/border-red-500/);

      await exprField.fill('payload.subject');
      await expect(exprField).not.toHaveClass(/border-red-500/);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('expression field supports multi-line expressions', async ({ page }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page);

    try {
      const stepId = await createIfStep(page, workflowPage);
      const exprField = page.locator(`#if-condition-${stepId}-expr`);

      const multiLine = 'payload.subject\n&& payload.sender';
      await exprField.fill(multiLine);
      await expect(exprField).toHaveValue(multiLine);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('expression field accepts empty input without error', async ({ page }) => {
    test.setTimeout(120000);
    const { db, tenantData, workflowPage } = await setupDesigner(page);

    try {
      const stepId = await createIfStep(page, workflowPage);
      const exprField = page.locator(`#if-condition-${stepId}-expr`);

      await exprField.fill('payload.subject');
      await exprField.fill('');

      await expect(exprField).toHaveValue('');
      await expect(exprField).not.toHaveClass(/border-red-500/);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});
