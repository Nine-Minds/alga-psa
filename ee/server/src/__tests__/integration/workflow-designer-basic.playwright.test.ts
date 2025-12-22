import { test, expect, type Page } from '@playwright/test';
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
import { ensureSystemEmailWorkflow } from './helpers/workflowSeedHelper';

applyPlaywrightAuthEnvDefaults();

const TEST_CONFIG = {
  baseUrl: resolvePlaywrightBaseUrl(),
};

type WorkflowDefinitionSnapshot = {
  definitions: Array<Record<string, any>>;
  versions: Array<Record<string, any>>;
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

type WorkflowPlaywrightOverrides = {
  failPermissions?: boolean;
  failRegistries?: boolean;
  failSaveDraft?: boolean;
  saveDraftDelayMs?: number;
  registryNodes?: Array<Record<string, any>>;
  registryActions?: Array<Record<string, any>>;
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
}> {
  const db = createTestDbConnection();
  const tenantData = await createTenantAndLogin(db, page, {
    tenantOptions: {
      companyName: `Workflow UI ${uuidv4().slice(0, 6)}`,
    },
    completeOnboarding: { completedAt: new Date() },
    permissions: ADMIN_PERMISSIONS,
  });

  await ensureSystemEmailWorkflow(db);

  await page.goto(`${TEST_CONFIG.baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 });

  const workflowPage = new WorkflowDesignerPage(page);
  await workflowPage.goto(TEST_CONFIG.baseUrl);
  return { db, tenantData, workflowPage };
}

async function seedWorkflowDefinitions(db: Knex, count: number): Promise<{ ids: string[]; names: string[] }> {
  const ids: string[] = [];
  const names: string[] = [];
  const now = new Date().toISOString();
  const records = Array.from({ length: count }).map((_, index) => {
    const workflowId = uuidv4();
    const name = `UI Bulk ${index + 1} ${uuidv4().slice(0, 6)}`;
    const definition = {
      id: workflowId,
      version: 1,
      name,
      description: '',
      payloadSchemaRef: 'payload.EmailWorkflowPayload.v1',
      steps: [],
    };
    ids.push(workflowId);
    names.push(name);
    return {
      workflow_id: workflowId,
      name,
      description: null,
      payload_schema_ref: definition.payloadSchemaRef,
      trigger: null,
      draft_definition: definition,
      draft_version: definition.version,
      status: 'draft',
      created_at: now,
      updated_at: now,
    };
  });

  if (records.length) {
    await db('workflow_definitions').insert(records);
  }

  return { ids, names };
}

function buildSchemaTestNode() {
  return {
    id: 'test.schema',
    ui: {
      label: 'Schema Test',
      category: 'Test',
      description: 'Schema coverage node',
    },
    configSchema: {
      title: 'test.schema',
      type: 'object',
      properties: {
        flag: { type: 'boolean', default: true },
        mode: { type: 'string', enum: ['alpha', 'beta'], default: 'beta' },
        requiredName: { type: 'string' },
        nested: {
          type: 'object',
          properties: {
            label: { type: 'string', default: 'nested-default' },
          },
          required: ['label'],
        },
        items: { type: 'array', default: [] },
        mapping: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              $expr: { type: 'string' },
            },
            required: ['$expr'],
          },
        },
        exprField: {
          type: 'object',
          properties: {
            $expr: { type: 'string' },
          },
        },
      },
      required: ['requiredName'],
    },
  };
}

async function snapshotWorkflowDefinitions(db: Knex): Promise<WorkflowDefinitionSnapshot> {
  const definitions = await db('workflow_definitions').select();
  const versions = await db('workflow_definition_versions').select();
  return { definitions, versions };
}

async function restoreWorkflowDefinitions(db: Knex, snapshot: WorkflowDefinitionSnapshot): Promise<void> {
  await db('workflow_definitions').del();
  if (snapshot.definitions.length) {
    await db('workflow_definitions').insert(snapshot.definitions);
  }
  if (snapshot.versions.length) {
    await db('workflow_definition_versions').insert(snapshot.versions);
  }
}

test.describe('Workflow Designer UI - basic', () => {
  test('unauthenticated visit redirects to sign in', async ({ page }) => {
    test.setTimeout(60000);

    await page.goto(`${TEST_CONFIG.baseUrl}/msp/workflows`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    await expect(page).toHaveURL(/\/auth\/msp\/signin/);
  });

  test('loads the workflow designer page', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await expect(workflowPage.header).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Designer' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Runs' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Events' })).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('permissions fetch failure surfaces toast and hides privileged controls', async ({ page }) => {
    test.setTimeout(120000);
    await applyWorkflowOverrides(page, { failPermissions: true });

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await expect(page.getByText('Failed to load permissions')).toBeVisible();
      await expect(workflowPage.newWorkflowButton).toHaveCount(0);
      await expect(workflowPage.saveDraftButton).toHaveCount(0);
      await expect(workflowPage.publishButton).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('registry discovery failure surfaces toast and disables palette usage', async ({ page }) => {
    test.setTimeout(120000);
    await applyWorkflowOverrides(page, { failRegistries: true });

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await expect(page.getByText('Failed to load workflow registries')).toBeVisible();
      await expect(page.locator('#workflow-designer-search')).toBeDisabled();
      await expect(workflowPage.addButtonFor('control.if')).toBeDisabled();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('workflow list shows total count and buttons for each definition', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      const countLabel = page.getByText(/\d+ workflows/);
      await expect(countLabel).toBeVisible();

      const buttons = page.locator('[id^="workflow-designer-open-"]');
      await expect(buttons.first()).toBeVisible();
      const buttonCount = await buttons.count();
      expect(buttonCount).toBeGreaterThan(0);

      await expect.poll(async () => {
        const labelText = (await countLabel.textContent()) ?? '';
        const match = labelText.match(/(\d+)\s+workflows/);
        return match ? Number(match[1]) : null;
      }).toBe(buttonCount);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('workflow list handles large counts with horizontal scroll', async ({ page }) => {
    test.setTimeout(120000);

    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: {
        companyName: `Workflow UI ${uuidv4().slice(0, 6)}`,
      },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });

    const workflowPage = new WorkflowDesignerPage(page);
    let seeded: { ids: string[]; names: string[] } | null = null;

    try {
      seeded = await seedWorkflowDefinitions(db, 24);
      await page.goto(`${TEST_CONFIG.baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 30_000 });
      await workflowPage.goto(TEST_CONFIG.baseUrl);

      const listContainer = page.locator('#workflow-designer-list');
      const lastName = seeded.names[seeded.names.length - 1];

      await expect(page.getByRole('button', { name: lastName })).toBeVisible();

      const hasOverflow = await listContainer.evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(hasOverflow).toBeTruthy();

      await listContainer.evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      });
      await page.getByRole('button', { name: lastName }).click();
      await expect(workflowPage.nameInput).toHaveValue(lastName);
    } finally {
      if (seeded?.ids.length) {
        await db('workflow_definitions').whereIn('workflow_id', seeded.ids).del().catch(() => undefined);
      }
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('creates a new workflow and shows empty pipe', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      const workflowName = await workflowPage.nameInput.inputValue();
      await expect(workflowPage.nameInput).toHaveValue(/.+/);
      await expect(workflowPage.versionInput).toHaveValue('1');
      await expect(workflowPage.payloadSchemaInput).toHaveValue(/.+/);
      await expect(workflowPage.dropStepsHereText()).toBeVisible();
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('editing payload schema ref updates field picker options', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('control.if').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(stepId).click();

      const picker = page.locator(`button#if-condition-${stepId}-picker`);
      await picker.click();
      await expect(page.getByRole('option', { name: 'payload.emailData' })).toBeVisible();
      await page.keyboard.press('Escape');

      await workflowPage.payloadSchemaInput.fill('payload.UnknownPayload.v1');

      await expect.poll(async () => {
        await picker.click();
        const count = await page.getByRole('option', { name: 'payload.emailData' }).count();
        await page.keyboard.press('Escape');
        return count;
      }).toBe(0);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('edits metadata and saves draft', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      const workflowName = `UI Workflow ${uuidv4().slice(0, 6)}`;

      await workflowPage.nameInput.fill(workflowName);
      await workflowPage.descriptionInput.fill('Workflow for UI tests');
      await workflowPage.payloadSchemaInput.fill('payload.EmailWorkflowPayload.v1');
      await workflowPage.triggerInput.fill('workflow.event.test');

      await workflowPage.saveDraft();

      await expect(page.getByRole('button', { name: workflowName })).toBeVisible({ timeout: 10_000 });
      await expect(workflowPage.triggerInput).toHaveValue('workflow.event.test');
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('save draft shows loading state while saving', async ({ page }) => {
    test.setTimeout(120000);
    await applyWorkflowOverrides(page, { saveDraftDelayMs: 1200 });

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    let workflowName = '';
    try {
      await workflowPage.clickNewWorkflow();
      workflowName = await workflowPage.nameInput.inputValue();

      await workflowPage.saveDraftButton.click();
      await expect(workflowPage.saveDraftButton).toHaveText('Saving...');
      await expect(workflowPage.saveDraftButton).toBeDisabled();
      await expect(workflowPage.saveDraftButton).toHaveText('Save Draft');
    } finally {
      if (workflowName) {
        await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      }
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('save draft error surfaces toast and leaves draft intact', async ({ page }) => {
    test.setTimeout(120000);
    await applyWorkflowOverrides(page, { failSaveDraft: true });

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const workflowName = `UI Error ${uuidv4().slice(0, 6)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.nameInput.fill(workflowName);
      await workflowPage.saveDraftButton.click();

      await expect(page.getByText('Failed to save workflow')).toBeVisible();
      await expect(page.getByRole('button', { name: workflowName })).toHaveCount(0);
      await expect(workflowPage.nameInput).toHaveValue(workflowName);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('save draft persists metadata and steps after reload', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const workflowName = `UI Workflow ${uuidv4().slice(0, 6)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.nameInput.fill(workflowName);
      await workflowPage.descriptionInput.fill('Draft workflow metadata');
      await workflowPage.payloadSchemaInput.fill('payload.CustomWorkflowPayload.v1');
      await workflowPage.triggerInput.fill('workflow.event.persist');

      const addStateButton = workflowPage.addButtonFor('state.set');
      await addStateButton.scrollIntoViewIfNeeded();
      await addStateButton.click();

      const stepId = await workflowPage.getFirstStepId();

      await workflowPage.saveDraft();
      await page.getByRole('button', { name: workflowName }).waitFor({ state: 'visible' });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await workflowPage.waitForLoaded();
      await workflowPage.selectWorkflowByName(workflowName);

      await expect(workflowPage.nameInput).toHaveValue(workflowName);
      await expect(workflowPage.descriptionInput).toHaveValue('Draft workflow metadata');
      await expect(workflowPage.payloadSchemaInput).toHaveValue('payload.CustomWorkflowPayload.v1');
      await expect(workflowPage.triggerInput).toHaveValue('workflow.event.persist');

      const stepButton = workflowPage.stepSelectButton(stepId);
      await expect(stepButton).toBeVisible();
      await expect(stepButton).toContainText('Set State');
      await expect(stepButton).toContainText(stepId);
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('selecting a workflow loads draft metadata fields', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const workflowName = `UI Workflow ${uuidv4().slice(0, 6)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.nameInput.fill(workflowName);
      await workflowPage.descriptionInput.fill('Draft workflow metadata');
      await workflowPage.payloadSchemaInput.fill('payload.CustomWorkflowPayload.v1');
      await workflowPage.triggerInput.fill('workflow.event.custom');
      await workflowPage.saveDraft();

      await page.getByRole('button', { name: workflowName }).waitFor({ state: 'visible' });

      await workflowPage.selectWorkflowByName('Inbound Email Processing');

      await expect(workflowPage.nameInput).toHaveValue('Inbound Email Processing');
      await expect(workflowPage.versionInput).toHaveValue('1');
      await expect(workflowPage.descriptionInput).toHaveValue('Process inbound emails into tickets or comments.');
      await expect(workflowPage.payloadSchemaInput).toHaveValue('payload.EmailWorkflowPayload.v1');
      await expect(workflowPage.triggerInput).toHaveValue('INBOUND_EMAIL_RECEIVED');
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('editing workflow version accepts numeric input', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    let workflowName = '';

    try {
      await workflowPage.clickNewWorkflow();
      workflowName = await workflowPage.nameInput.inputValue();

      await workflowPage.versionInput.fill('2');
      await expect(workflowPage.versionInput).toHaveValue('2');
    } finally {
      if (workflowName) {
        await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      }
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('clearing trigger event name removes trigger from draft', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    let workflowName = '';

    try {
      await workflowPage.clickNewWorkflow();
      workflowName = await workflowPage.nameInput.inputValue();

      await workflowPage.triggerInput.fill('workflow.event.clear');
      await expect(workflowPage.triggerInput).toHaveValue('workflow.event.clear');

      await workflowPage.triggerInput.fill('');
      await expect(workflowPage.triggerInput).toHaveValue('');
    } finally {
      if (workflowName) {
        await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      }
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('palette search filters nodes and restores list', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      const callWorkflowButton = workflowPage.addButtonFor('control.callWorkflow');
      const forEachButton = workflowPage.addButtonFor('control.forEach');

      await workflowPage.searchPalette('Call Workflow');
      await expect(callWorkflowButton).toBeVisible();
      await expect(forEachButton).toBeHidden();

      await workflowPage.searchPalette('');
      await expect(forEachButton).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('palette search filters nodes by id', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      const stateSetButton = workflowPage.addButtonFor('state.set');
      const callWorkflowButton = workflowPage.addButtonFor('control.callWorkflow');

      await workflowPage.searchPalette('state.set');
      await expect(stateSetButton).toBeVisible();
      await expect(callWorkflowButton).toBeHidden();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('adds a control.if step and shows config panel', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('control.if').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(stepId).click();

      await expect(page.getByLabel('Condition')).toBeVisible();
      await expect(page.getByText('THEN')).toBeVisible();
      await expect(page.getByText('ELSE')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('expression validation shows and clears error styling', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('control.if').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(stepId).click();

      const conditionField = page.getByLabel('Condition');
      await conditionField.fill('(');
      await expect(conditionField).toHaveClass(/border-red-500/);

      await conditionField.fill('payload.subject');
      await expect(conditionField).not.toHaveClass(/border-red-500/);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('deletes a step from the pipeline', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('control.if').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepDeleteButton(stepId).click();

      await expect(workflowPage.dropStepsHereText()).toBeVisible();
      await expect(page.locator('[id^="workflow-step-select-"]')).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('forEach config persists items expression and settings', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const workflowName = `UI ForEach ${uuidv4().slice(0, 6)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.nameInput.fill(workflowName);
      await workflowPage.addButtonFor('control.forEach').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(stepId).click();

      const itemsExpr = page.locator(`#foreach-items-${stepId}-expr`);
      await itemsExpr.fill('payload.items');
      await expect(itemsExpr).not.toHaveClass(/border-red-500/);

      await page.locator(`#foreach-itemvar-${stepId}`).fill('itemRow');
      await page.locator(`#foreach-concurrency-${stepId}`).fill('3');

      const onItemErrorSelect = page.locator(`#foreach-onitemerror-${stepId}[role="combobox"]`);
      await onItemErrorSelect.click();
      await page.getByRole('option', { name: 'Fail' }).click();
      await expect(onItemErrorSelect).toContainText('Fail');

      await workflowPage.saveDraft();
      await page.getByRole('button', { name: workflowName }).waitFor({ state: 'visible' });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await workflowPage.waitForLoaded();
      await workflowPage.selectWorkflowByName(workflowName);
      await workflowPage.stepSelectButton(stepId).click();

      await expect(page.locator(`#foreach-items-${stepId}-expr`)).toHaveValue('payload.items');
      await expect(page.locator(`#foreach-itemvar-${stepId}`)).toHaveValue('itemRow');
      await expect(page.locator(`#foreach-concurrency-${stepId}`)).toHaveValue('3');
      await expect(page.locator(`#foreach-onitemerror-${stepId}[role="combobox"]`)).toContainText('Fail');
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('forEach items expression invalid value shows validation error', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('control.forEach').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(stepId).click();

      const itemsExpr = page.locator(`#foreach-items-${stepId}-expr`);
      await itemsExpr.fill('(');
      await expect(itemsExpr).toHaveClass(/border-red-500/);
      await expect(page.getByText('Invalid expression')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('try/catch capture error persists and clears', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const workflowName = `UI TryCatch ${uuidv4().slice(0, 6)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.nameInput.fill(workflowName);
      await workflowPage.addButtonFor('control.tryCatch').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(stepId).click();

      const captureInputId = `#trycatch-capture-${stepId}`;
      await page.locator(captureInputId).fill('errorVar');

      await workflowPage.saveDraft();
      await page.getByRole('button', { name: workflowName }).waitFor({ state: 'visible' });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await workflowPage.waitForLoaded();
      await workflowPage.selectWorkflowByName(workflowName);
      await workflowPage.stepSelectButton(stepId).click();
      await expect(page.locator(captureInputId)).toHaveValue('errorVar');

      await page.locator(captureInputId).fill('');
      await expect(page.locator(captureInputId)).toHaveValue('');
      await workflowPage.saveDraft();

      await page.reload({ waitUntil: 'domcontentloaded' });
      await workflowPage.waitForLoaded();
      await workflowPage.selectWorkflowByName(workflowName);
      await workflowPage.stepSelectButton(stepId).click();
      await expect(page.locator(captureInputId)).toHaveValue('');
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('call workflow inputs persist after save', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const workflowName = `UI CallWF ${uuidv4().slice(0, 6)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.nameInput.fill(workflowName);
      await workflowPage.addButtonFor('control.callWorkflow').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(stepId).click();

      const workflowIdValue = uuidv4();
      await page.locator(`#call-workflow-id-${stepId}`).fill(workflowIdValue);
      await page.locator(`#call-workflow-version-${stepId}`).fill('2');

      await workflowPage.saveDraft();
      await page.getByRole('button', { name: workflowName }).waitFor({ state: 'visible' });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await workflowPage.waitForLoaded();
      await workflowPage.selectWorkflowByName(workflowName);
      await workflowPage.stepSelectButton(stepId).click();

      await expect(page.locator(`#call-workflow-id-${stepId}`)).toHaveValue(workflowIdValue);
      await expect(page.locator(`#call-workflow-version-${stepId}`)).toHaveValue('2');
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('node config renders schema field types and defaults', async ({ page }) => {
    test.setTimeout(120000);
    await applyWorkflowOverrides(page, {
      registryNodes: [buildSchemaTestNode()],
      registryActions: [],
    });

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('test.schema').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(stepId).click();

      const flagSwitch = page.locator(`#config-${stepId}-flag`);
      await expect(flagSwitch).toBeVisible();
      await expect(flagSwitch).toHaveAttribute('aria-checked', 'true');

      const enumSelect = page.locator(`[data-automation-id="config-${stepId}-mode"]`);
      await expect(enumSelect).toBeVisible();
      await expect(enumSelect).toContainText('beta');

      const nestedLabel = page.locator(`#config-${stepId}-nested-label`);
      await expect(nestedLabel).toBeVisible();
      await expect(nestedLabel).toHaveValue('nested-default');

      const arrayJson = page.locator(`#config-${stepId}-items-json`);
      await expect(arrayJson).toBeVisible();
      await expect(arrayJson).toHaveValue('[]');

      const mappingAdd = page.locator(`#config-${stepId}-mapping-add`);
      await expect(mappingAdd).toBeVisible();
      await mappingAdd.click();
      await expect(page.locator(`#config-${stepId}-mapping-key-0`)).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('node config expression validation and required fields update', async ({ page }) => {
    test.setTimeout(120000);
    await applyWorkflowOverrides(page, {
      registryNodes: [buildSchemaTestNode()],
      registryActions: [],
    });

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('test.schema').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(stepId).click();

      await expect(page.getByText('Missing required: requiredName')).toBeVisible();
      await page.locator(`#config-${stepId}-requiredName`).fill('Required value');
      await expect(page.locator('text=Missing required: requiredName')).toHaveCount(0);

      const exprField = page.locator(`#config-${stepId}-exprField-expr`);
      await exprField.fill('(');
      await expect(exprField).toHaveClass(/border-red-500/);
      await expect(page.getByText('Invalid expression')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('empty workflow list disables draft/publish actions and shows no selection', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const snapshot = await snapshotWorkflowDefinitions(db);

    try {
      await db('workflow_definitions').del();

      await page.reload({ waitUntil: 'domcontentloaded' });
      await workflowPage.waitForLoaded();

      await expect(page.getByText('0 workflows')).toBeVisible();
      await expect(page.locator('[id^="workflow-designer-open-"]')).toHaveCount(0);

      await expect(workflowPage.saveDraftButton).toBeDisabled();
      await expect(workflowPage.publishButton).toBeDisabled();
      await expect(workflowPage.nameInput).toHaveValue('');
      await expect(workflowPage.payloadSchemaInput).toHaveValue('');
      await expect(page.locator('#workflow-settings-save')).toHaveCount(0);
    } finally {
      await restoreWorkflowDefinitions(db, snapshot).catch(() => {});
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });
});
