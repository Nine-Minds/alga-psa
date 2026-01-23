import { expect, test, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { rollbackTenant } from '../../lib/testing/tenant-creation';
import type { TenantTestData } from '../../lib/testing/tenant-test-factory';
import {
  applyPlaywrightAuthEnvDefaults,
  createTenantAndLogin,
} from './helpers/playwrightAuthSessionHelper';
import { WorkflowDesignerPage } from '../page-objects/WorkflowDesignerPage';

applyPlaywrightAuthEnvDefaults();

const ADMIN_PERMISSIONS = [
  {
    roleName: 'Admin',
    permissions: [
      { resource: 'user', action: 'read' },
      { resource: 'workflow', action: 'manage' },
      { resource: 'workflow', action: 'publish' },
      { resource: 'workflow', action: 'admin' },
      { resource: 'secrets', action: 'view' },
    ],
  },
];

async function setupDesigner(
  page: Page,
  baseURL: string,
): Promise<{ db: Knex; tenantData: TenantTestData; workflowPage: WorkflowDesignerPage }> {
  const db = createTestDbConnection();
  const tenantData = await createTenantAndLogin(db, page, {
    tenantOptions: {
      companyName: `Mapping Visuals ${uuidv4().slice(0, 6)}`,
    },
    completeOnboarding: { completedAt: new Date() },
    permissions: ADMIN_PERMISSIONS,
  });

  const workflowPage = new WorkflowDesignerPage(page);
  await workflowPage.goto(baseURL);
  return { db, tenantData, workflowPage };
}

async function getStepIds(page: Page): Promise<string[]> {
  const stepButtons = await page.locator('[id^="workflow-step-select-"]').all();
  const ids: string[] = [];
  for (const stepButton of stepButtons) {
    const id = await stepButton.getAttribute('id');
    if (id) {
      ids.push(id.replace('workflow-step-select-', ''));
    }
  }
  return ids;
}

async function addActionStep(
  page: Page,
  workflowPage: WorkflowDesignerPage,
  actionId: string,
  paletteSearch: string
): Promise<string> {
  const existingStepIds = await getStepIds(page);

  await workflowPage.searchPalette(paletteSearch);
  await page.locator(`[id="workflow-designer-add-action:${actionId}"]`).click();
  await expect(page.locator('[id^="workflow-step-select-"]')).toHaveCount(
    existingStepIds.length + 1,
    { timeout: 5000 }
  );

  const updatedStepIds = await getStepIds(page);
  const newStepId = updatedStepIds.find((id) => !existingStepIds.includes(id));
  if (!newStepId) {
    throw new Error('Failed to locate new action step');
  }

  await workflowPage.stepSelectButton(newStepId).click();
  return newStepId;
}

test('mapping editor visuals render correctly for action.call mapping panel', async ({ page, baseURL }) => {
  test.setTimeout(180000);

  const { db, tenantData, workflowPage } = await setupDesigner(page, baseURL!);

  try {
    await workflowPage.clickNewWorkflow();

    const stepId = await addActionStep(page, workflowPage, 'create_ticket_from_email', 'create ticket');

    const mappingLabel = page.getByText('Input Mapping');
    await expect(mappingLabel).toBeVisible({ timeout: 15000 });

    await page.locator(`#add-mapping-${stepId}-title`).click();
    await page.locator(`#mapping-${stepId}-title-expr`).fill('payload.emailData.subject');

    await page.locator(`#add-mapping-${stepId}-description`).click();
    await page.locator(`#mapping-${stepId}-description-expr`).fill('payload.emailData.body.text');

    await page.waitForTimeout(750);

    const mappingRoot = page.locator(`[data-automation-id="mapping-panel-${stepId}"]`);
    await expect(mappingRoot).toBeVisible();

    const overlay = mappingRoot.locator('svg.absolute.inset-0');
    await expect(overlay).toBeVisible();

    const visiblePathCount = await overlay.evaluate((svg) => {
      const paths = Array.from(svg.querySelectorAll('path[stroke]'));
      return paths.filter((path) => {
        const stroke = path.getAttribute('stroke');
        return stroke && stroke !== 'transparent' && stroke !== 'rgba(0,0,0,0.1)';
      }).length;
    });
    expect(visiblePathCount).toBeGreaterThan(0);

    fs.mkdirSync(path.resolve('playwright-artifacts'), { recursive: true });

    await mappingRoot.screenshot({
      path: 'playwright-artifacts/mapping-editor-visuals.png',
    });

    await page.screenshot({
      path: 'playwright-artifacts/mapping-editor-visuals-full.png',
      fullPage: true,
    });
  } finally {
    await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
    await db.destroy();
  }
});
