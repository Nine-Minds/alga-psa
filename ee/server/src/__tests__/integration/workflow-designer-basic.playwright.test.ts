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
    experimentalFeatures: { workflowAutomation: true },
    permissions: ADMIN_PERMISSIONS,
  });

  await ensureSystemEmailWorkflow(db);

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

function buildAppCatalogRegistryOverrides(): WorkflowPlaywrightOverrides {
  return {
    registryActions: [
      {
        id: 'slack.send_message',
        version: 1,
        ui: {
          label: 'Send Slack Message',
          description: 'Send a message to a Slack channel.',
          category: 'Apps',
          icon: 'slack',
        },
        inputSchema: {
          type: 'object',
          properties: {
            channel: { type: 'string' },
            message: { type: 'string' },
          },
        },
        outputSchema: {
          type: 'object',
          properties: {
            ts: { type: 'string' },
          },
        },
      },
      {
        id: 'github.create_issue',
        version: 1,
        ui: {
          label: 'Create GitHub Issue',
          description: 'Create an issue in GitHub.',
          category: 'Apps',
          icon: 'github',
        },
        inputSchema: {
          type: 'object',
          properties: {
            repository: { type: 'string' },
            title: { type: 'string' },
          },
        },
        outputSchema: {
          type: 'object',
          properties: {
            issue_number: { type: 'number' },
          },
        },
      },
    ],
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

const pipeIdForPath = (pipePath: string): string =>
  `workflow-designer-pipe-${pipePath.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

const dragHandleFor = (page: Page, stepId: string) =>
  page.locator(`#workflow-step-drag-${stepId}`);

async function getStepIdsIn(scope: ReturnType<Page['locator']>): Promise<string[]> {
  return scope.evaluate((node) => {
    return Array.from(node.querySelectorAll(':scope > [data-step-id]'))
      .map((child) => (child as HTMLElement).dataset.stepId || '')
      .filter(Boolean);
  });
}

async function dragBetween(
  page: Page,
  source: ReturnType<Page['locator']>,
  target: ReturnType<Page['locator']>,
  options: { targetX?: number; targetY?: number } = {}
): Promise<void> {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();

  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error('Unable to determine drag/drop bounds.');
  }

  const targetX = options.targetX ?? 0.5;
  const targetY = options.targetY ?? 0.5;
  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + targetBox.width * targetX;
  const endY = targetBox.y + targetBox.height * targetY;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 25 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

async function beginPaletteDrag(page: Page, item: ReturnType<Page['locator']>): Promise<void> {
  await item.scrollIntoViewIfNeeded();
  await item.focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(100);
}

async function setPaletteSearchValue(page: Page, value: string): Promise<void> {
  await page.locator('#workflow-designer-search').evaluate((node, nextValue) => {
    const input = node as HTMLInputElement;
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set;

    nativeValueSetter?.call(input, nextValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
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

  test('T039: grouped palette enters a usable degraded state when registry data fails to load', async ({ page }) => {
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

  test('workflow list shows counts and can open a workflow', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.workflowsTab.click();
      await expect(page.getByText(/\d+\s+total/)).toBeVisible();

      // Sanity check that at least one workflow is present and clickable.
      const firstWorkflow = page.locator('[id^="workflow-list-open-"]').first();
      await expect(firstWorkflow).toBeVisible();
      await firstWorkflow.click();

      await expect(page).toHaveURL(/tab=designer/);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('workflow list supports searching and opening workflows', async ({ page }) => {
    test.setTimeout(120000);

    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: {
        companyName: `Workflow UI ${uuidv4().slice(0, 6)}`,
      },
      completeOnboarding: { completedAt: new Date() },
      experimentalFeatures: { workflowAutomation: true },
      permissions: ADMIN_PERMISSIONS,
    });

    const workflowPage = new WorkflowDesignerPage(page);
    let seeded: { ids: string[]; names: string[] } | null = null;

    try {
      seeded = await seedWorkflowDefinitions(db, 24);
      await page.goto(`${TEST_CONFIG.baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 30_000 });
      await workflowPage.goto(TEST_CONFIG.baseUrl);

      const lastName = seeded.names[seeded.names.length - 1];
      await workflowPage.workflowsTab.click();

      const searchInput = page.getByPlaceholder('Search workflows...');
      await expect(searchInput).toBeVisible();
      await searchInput.fill(lastName);

      const openLink = page.getByRole('link', { name: lastName, exact: true });
      await expect(openLink).toBeVisible();
      await openLink.click();
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
      await expect(workflowPage.payloadSchemaSelectButton).toContainText(/payload\./);
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

      await workflowPage.setPayloadSchemaRefAdvanced('payload.UnknownPayload.v1');

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
      await workflowPage.selectPayloadSchemaRef('payload.EmailWorkflowPayload.v1');
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
      await workflowPage.setPayloadSchemaRefAdvanced('payload.CustomWorkflowPayload.v1');
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
      await expect(workflowPage.payloadSchemaSelectButton).toContainText('payload.CustomWorkflowPayload.v1');
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
      await workflowPage.setPayloadSchemaRefAdvanced('payload.CustomWorkflowPayload.v1');
      await workflowPage.triggerInput.fill('workflow.event.custom');
      await workflowPage.saveDraft();

      await page.getByRole('button', { name: workflowName }).waitFor({ state: 'visible' });

      await workflowPage.selectWorkflowByName('Inbound Email Processing');

      await expect(workflowPage.nameInput).toHaveValue('Inbound Email Processing');
      await expect(workflowPage.versionInput).toHaveValue('1');
      await expect(workflowPage.descriptionInput).toHaveValue('Process inbound emails into tickets or comments.');
      await expect(workflowPage.payloadSchemaSelectButton).toContainText('payload.EmailWorkflowPayload.v1');
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

  test('palette renders grouped business tiles instead of one tile per business action', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();

      await expect(workflowPage.addButtonFor('ticket')).toBeVisible();
      await expect(workflowPage.addButtonFor('contact')).toBeVisible();
      await expect(workflowPage.addButtonFor('client')).toBeVisible();
      await expect(workflowPage.addButtonFor('communication')).toBeVisible();
      await expect(workflowPage.addButtonFor('scheduling')).toBeVisible();
      await expect(workflowPage.addButtonFor('project')).toBeVisible();
      await expect(workflowPage.addButtonFor('time')).toBeVisible();
      await expect(workflowPage.addButtonFor('crm')).toBeVisible();

      await expect(page.getByTestId('palette-item-action:tickets.create')).toHaveCount(0);
      await expect(page.getByTestId('palette-item-action:contacts.find')).toHaveCount(0);
      await expect(page.getByTestId('palette-item-action:clients.find')).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('control blocks still render as dedicated palette entries alongside grouped tiles', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();

      await expect(workflowPage.addButtonFor('control.if')).toBeVisible();
      await expect(workflowPage.addButtonFor('control.forEach')).toBeVisible();
      await expect(workflowPage.addButtonFor('control.tryCatch')).toBeVisible();
      await expect(workflowPage.addButtonFor('control.callWorkflow')).toBeVisible();
      await expect(workflowPage.addButtonFor('control.return')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('transform renders as a top-level palette tile', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await expect(workflowPage.addButtonFor('transform')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('app/plugin catalog records render as top-level app tiles', async ({ page }) => {
    test.setTimeout(120000);
    await applyWorkflowOverrides(page, buildAppCatalogRegistryOverrides());

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();

      await expect(workflowPage.addButtonFor('app:slack')).toBeVisible();
      await expect(workflowPage.addButtonFor('app:github')).toBeVisible();
      await expect(page.locator('#workflow-designer-palette-scroll')).toContainText('Apps');
      await expect(page.getByTestId('palette-item-slack.send_message')).toHaveCount(0);
      await expect(page.getByTestId('palette-item-github.create_issue')).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('grouped tile tooltips show the tile description', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();

      const ticketTile = workflowPage.addButtonFor('ticket');
      await ticketTile.hover();

      await expect(page.getByText('Create, find, update, assign, and manage tickets.')).toBeVisible({
        timeout: 5_000,
      });
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('palette search remains interactive after a grouped tile has been inserted', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();

      const stepButtons = page.locator('[id^="workflow-step-select-"]');
      await expect(stepButtons).toHaveCount(0);

      await workflowPage.addButtonFor('ticket').click();
      await expect(stepButtons).toHaveCount(1);

      await workflowPage.searchPalette('Call Workflow');
      await expect(workflowPage.addButtonFor('control.callWorkflow')).toBeVisible();
      await expect(workflowPage.addButtonFor('ticket')).toBeHidden();

      await workflowPage.searchPalette('');
      await expect(workflowPage.addButtonFor('ticket')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('palette search remains interactive while a grouped tile is being dragged', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();

      const stepButtons = page.locator('[id^="workflow-step-select-"]');
      await expect(stepButtons).toHaveCount(0);

      await beginPaletteDrag(page, workflowPage.addButtonFor('ticket'));
      await expect(page.getByText('Drop on pipeline to add')).toBeVisible();

      await setPaletteSearchValue(page, 'Call Workflow');
      await expect(workflowPage.addButtonFor('control.callWorkflow')).toBeVisible();
      await expect(workflowPage.addButtonFor('ticket')).toBeHidden();
      await expect(page.getByText('Drop on pipeline to add')).toBeVisible();

      await setPaletteSearchValue(page, '');
      await expect(workflowPage.addButtonFor('ticket')).toBeVisible();
      await expect(stepButtons).toHaveCount(0);
    } finally {
      await page.keyboard.press('Escape').catch(() => undefined);
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('a newly inserted grouped action step becomes selected like current action.call steps', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('ticket').click();

      const stepId = await workflowPage.getFirstStepId();
      await expect(page.locator(`#workflow-step-name-${stepId}`)).toBeVisible();
      await expect(page.getByTestId(`step-card-${stepId}`)).toHaveClass(/ring-2/);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('a newly inserted grouped action step lands on the currently selected pipe like current action.call steps', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('control.tryCatch').click();

      const rootPipe = page.locator('#workflow-designer-pipe-root');
      const rootStepIds = await getStepIdsIn(rootPipe);
      expect(rootStepIds).toHaveLength(1);

      const catchPipe = page.locator(`#${pipeIdForPath('root.steps[0].catch')}`);
      await expect(catchPipe).toBeVisible();
      const initialCatchStepIds = await getStepIdsIn(catchPipe);
      await catchPipe.click();

      await workflowPage.addButtonFor('ticket').click();

      await expect.poll(async () => {
        const nextCatchStepIds = await getStepIdsIn(catchPipe);
        return nextCatchStepIds.filter((stepId) => !initialCatchStepIds.includes(stepId));
      }).toHaveLength(1);
      await expect.poll(async () => getStepIdsIn(rootPipe)).toEqual(rootStepIds);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('T234: transform grouped steps remain reorderable within the pipeline like existing action.call steps', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('ticket').click();
      await workflowPage.addButtonFor('transform').click();

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
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('grouped action steps remain movable across control-block branches', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await expect(workflowPage.addButtonFor('control.if')).toBeEnabled();
      await workflowPage.addButtonFor('control.if').click();
      await workflowPage.addButtonFor('ticket').click();

      const rootPipe = page.locator('#workflow-designer-pipe-root');
      const rootStepIds = await getStepIdsIn(rootPipe);
      expect(rootStepIds.length).toBeGreaterThanOrEqual(2);

      const groupedStepId = rootStepIds[1];
      const thenPipe = page.locator(`#${pipeIdForPath('root.steps[0].then')}`);
      await expect(thenPipe).toBeVisible();
      const initialThenStepIds = await getStepIdsIn(thenPipe);

      const handle = dragHandleFor(page, groupedStepId);
      await expect(handle).toBeVisible();
      await dragBetween(page, handle, thenPipe, { targetY: 0.75 });

      await expect.poll(async () => {
        const nextThenStepIds = await getStepIdsIn(thenPipe);
        return {
          containsGroupedStep: nextThenStepIds.includes(groupedStepId),
          length: nextThenStepIds.length,
        };
      }).toEqual({
        containsGroupedStep: true,
        length: initialThenStepIds.length + 1,
      });
      await expect.poll(async () => getStepIdsIn(rootPipe)).toEqual([rootStepIds[0]]);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('T234/T235: transform grouped steps remain movable across control-block branches and can be inserted inside control blocks', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await expect(workflowPage.addButtonFor('control.if')).toBeEnabled();
      await workflowPage.addButtonFor('control.if').click();
      await workflowPage.addButtonFor('transform').click();

      const rootPipe = page.locator('#workflow-designer-pipe-root');
      const thenPipe = page.locator(`#${pipeIdForPath('root.steps[0].then')}`);
      await expect(thenPipe).toBeVisible();

      const rootStepIds = await getStepIdsIn(rootPipe);
      expect(rootStepIds.length).toBeGreaterThanOrEqual(2);
      const movableTransformId = rootStepIds[1];

      await thenPipe.click();
      const initialThenStepIds = await getStepIdsIn(thenPipe);
      const initialRootStepIds = [...rootStepIds];

      await workflowPage.addButtonFor('transform').click();

      let insertedTransformId: string | null = null;
      await expect.poll(async () => {
        const nextThenStepIds = await getStepIdsIn(thenPipe);
        insertedTransformId =
          nextThenStepIds.find((stepId) => !initialThenStepIds.includes(stepId)) ?? null;
        return insertedTransformId;
      }).not.toBeNull();

      await expect.poll(async () => getStepIdsIn(rootPipe)).toEqual(initialRootStepIds);

      const handle = dragHandleFor(page, movableTransformId ?? '');
      await expect(handle).toBeVisible();
      await dragBetween(page, handle, thenPipe, { targetY: 0.75 });

      await expect.poll(async () => {
        const nextThenStepIds = await getStepIdsIn(thenPipe);
        return {
          insertedTransformStillPresent: nextThenStepIds.includes(insertedTransformId ?? ''),
          movedTransformPresent: nextThenStepIds.includes(movableTransformId ?? ''),
          length: nextThenStepIds.length,
        };
      }).toEqual({
        insertedTransformStillPresent: true,
        movedTransformPresent: true,
        length: initialThenStepIds.length + 2,
      });
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('grouped action steps preserve delete behavior', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('ticket').click();

      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepDeleteButton(stepId).click();

      await expect(page.locator('[id^="workflow-step-select-"]')).toHaveCount(0);
      await expect(page.getByText('Select a step to edit its configuration.')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('T079: grouped action steps preserve the current absence of duplicate behavior', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('ticket').click();

      const stepId = await workflowPage.getFirstStepId();
      await expect(workflowPage.stepDeleteButton(stepId)).toBeVisible();
      await expect(page.locator(`#workflow-step-duplicate-${stepId}`)).toHaveCount(0);
      await expect(page.getByRole('button', { name: /duplicate step/i })).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });

  test('grouped action steps preserve saveAs auto-generation behavior', async ({ page }) => {
    test.setTimeout(120000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.addButtonFor('ticket').click();

      const stepId = await workflowPage.getFirstStepId();
      await expect(page.locator(`#workflow-step-saveAs-${stepId}`)).toHaveValue('ticketsCreateResult');
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

      await expect(workflowPage.saveDraftButton).toBeDisabled();
      await expect(workflowPage.publishButton).toBeDisabled();
      await expect(workflowPage.nameInput).toHaveValue('');
      await expect(workflowPage.payloadSchemaSelectButton).toHaveCount(0);
      await expect(page.locator('#workflow-settings-save')).toHaveCount(0);

      await workflowPage.workflowsTab.click();
      await expect(page.getByText('No workflows yet')).toBeVisible();
      await expect(page.locator('[id^="workflow-list-open-"]')).toHaveCount(0);
    } finally {
      await restoreWorkflowDefinitions(db, snapshot).catch(() => {});
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      await db.destroy();
    }
  });
});
