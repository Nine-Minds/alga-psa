import { expect, test, type Locator, type Page } from '@playwright/test';
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

async function openPipeSelect(page: Page): Promise<void> {
  const trigger = page
    .locator('#workflow-designer-pipe-select [role="combobox"]')
    .or(page.locator('#workflow-designer-pipe-select button'));
  await trigger.first().click();
}

const pipeIdForPath = (pipePath: string): string =>
  `workflow-designer-pipe-${pipePath.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

const getStepIdsIn = async (scope: Locator): Promise<string[]> => {
  return scope.evaluate((node) => {
    return Array.from(node.querySelectorAll(':scope > [data-step-id]')).map(
      (child) => (child as HTMLElement).dataset.stepId || ''
    ).filter(Boolean);
  });
};

const dragHandleFor = (page: Page, stepId: string): Locator =>
  page.locator(`#workflow-step-drag-${stepId}`);

const dragBetween = async (page: Page, source: Locator, target: Locator): Promise<void> => {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();

  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error('Unable to determine drag/drop bounds.');
  }

  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 25 });
  await page.waitForTimeout(150);
  await page.mouse.up();
};

test.describe('Workflow Designer UI - control blocks', () => {
  test('pipe selector includes root when no blocks exist', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await openPipeSelect(page);
      await expect(page.getByRole('option', { name: 'Root' })).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('adding control.forEach creates BODY pipe and shows config fields', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('control.forEach').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(stepId).click();

      await expect(page.locator(`#workflow-designer-block-${stepId}-body`)).toBeVisible();
      await expect(page.getByText('Item: item | Concurrency: 1')).toBeVisible();
      await expect(page.locator(`#foreach-items-${stepId}-expr`)).toBeVisible();
      await expect(page.locator(`#foreach-itemvar-${stepId}`)).toHaveValue('item');
      await expect(page.locator(`#foreach-concurrency-${stepId}`)).toHaveValue('1');
      await expect(page.getByText('On item error')).toBeVisible();
      await expect(page.locator(`#workflow-step-select-${stepId}`).getByText('Block')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('adding control.tryCatch creates TRY/CATCH pipes and capture error input', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('control.tryCatch').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(stepId).click();

      await expect(page.locator(`#workflow-designer-block-${stepId}-try`)).toBeVisible();
      await expect(page.locator(`#workflow-designer-block-${stepId}-catch`)).toBeVisible();

      const captureField = page.locator(`#trycatch-capture-${stepId}`);
      await captureField.fill('errorVar');
      await expect(captureField).toHaveValue('errorVar');
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('adding control.return shows helper text', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('control.return').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(stepId).click();

      await expect(page.getByText('Return stops workflow execution.')).toBeVisible();
      await expect(page.locator(`#workflow-step-select-${stepId}`).getByText('Return')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('control.callWorkflow input mapping add/edit/remove works', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('control.callWorkflow').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(stepId).click();

      await expect(page.locator(`#call-workflow-id-${stepId}`)).toBeVisible();
      await expect(page.locator(`#call-workflow-version-${stepId}`)).toHaveValue('1');
      await expect(page.locator(`#workflow-step-select-${stepId}`).getByText('Call Workflow')).toBeVisible();
      await expect(page.getByText('No mappings yet.')).toHaveCount(2);

      await page.locator(`#call-workflow-input-${stepId}-add`).click();

      const inputKey = page.locator(`#call-workflow-input-${stepId}-key-0`);
      const inputExpr = page.locator(`#call-workflow-input-${stepId}-expr-0-expr`);
      await expect(inputKey).toHaveValue('field_1');

      await inputExpr.fill('payload.subject');
      await inputKey.fill('emailSubject');
      await expect(inputKey).toHaveValue('emailSubject');
      await expect(inputExpr).toHaveValue('payload.subject');

      await page.locator(`#call-workflow-input-${stepId}-remove-0`).click();
      await expect(page.locator(`#call-workflow-input-${stepId}-key-0`)).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('control.callWorkflow output mapping add/edit/remove works', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('control.callWorkflow').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(stepId).click();

      await page.locator(`#call-workflow-output-${stepId}-add`).click();

      const outputKey = page.locator(`#call-workflow-output-${stepId}-key-0`);
      const outputExpr = page.locator(`#call-workflow-output-${stepId}-expr-0-expr`);
      await expect(outputKey).toHaveValue('field_1');

      await outputExpr.fill('payload.resultId');
      await outputKey.fill('resultId');
      await expect(outputKey).toHaveValue('resultId');
      await expect(outputExpr).toHaveValue('payload.resultId');

      await page.locator(`#call-workflow-output-${stepId}-remove-0`).click();
      await expect(page.locator(`#call-workflow-output-${stepId}-key-0`)).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('pipe selector updates when nested blocks are created', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('control.if').click();

      await openPipeSelect(page);
      await expect(page.getByRole('option', { name: 'If THEN' })).toBeVisible();
      await expect(page.getByRole('option', { name: 'If ELSE' })).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('clicking a pipe sets insertion target for add buttons', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('control.if').click();

      const thenPipe = page.locator(`#${pipeIdForPath('root.steps[0].then')}`);
      await expect(thenPipe).toBeVisible();
      await thenPipe.click();

      await workflowPage.addButtonFor('control.return').click();
      await expect(thenPipe.locator('[id^="workflow-step-select-"]').getByText('Return')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('dragging step reorders within same pipe', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('state.set').click();
      await workflowPage.addButtonFor('action.call').click();

      const rootPipe = page.locator('#workflow-designer-pipe-root');
      const initialOrder = await getStepIdsIn(rootPipe);
      expect(initialOrder).toHaveLength(2);

      const [firstId, secondId] = initialOrder;
      const firstHandle = dragHandleFor(page, firstId);
      const secondHandle = dragHandleFor(page, secondId);
      await expect(firstHandle).toBeVisible();
      await expect(secondHandle).toBeVisible();

      await dragBetween(page, secondHandle, firstHandle);

      await expect.poll(async () => getStepIdsIn(rootPipe)).toEqual([secondId, firstId]);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('dragging step moves between nested pipes', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('control.if').click();
      await workflowPage.addButtonFor('state.set').click();

      const rootPipe = page.locator('#workflow-designer-pipe-root');
      const rootStepIds = await getStepIdsIn(rootPipe);
      expect(rootStepIds.length).toBeGreaterThanOrEqual(2);

      const stateStepId = rootStepIds[1];
      const thenPipe = page.locator(`#${pipeIdForPath('root.steps[0].then')}`);
      await expect(thenPipe).toBeVisible();

      const handle = dragHandleFor(page, stateStepId);
      await expect(handle).toBeVisible();
      const dropHint = thenPipe.getByText('Drop steps here');
      await expect(dropHint).toBeVisible();
      await dragBetween(page, handle, dropHint);

      await expect.poll(async () => getStepIdsIn(thenPipe)).toEqual([stateStepId]);
      await expect.poll(async () => getStepIdsIn(rootPipe)).toEqual([rootStepIds[0]]);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});
