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
      { resource: 'workflow', action: 'read' },
      { resource: 'workflow', action: 'manage' },
      { resource: 'workflow', action: 'publish' },
      { resource: 'workflow', action: 'admin' },
    ],
  },
];

type WorkflowSeed = {
  workflowId: string;
  name: string;
  version: number;
};

type RunSeed = {
  runId: string;
  workflowId: string;
  version: number;
  status: string;
  startedAt: string;
  updatedAt?: string;
  completedAt?: string | null;
  tenantId: string;
  nodePath?: string | null;
};

async function setupDesigner(page: Page): Promise<{
  db: Knex;
  tenantData: TenantTestData;
  workflowPage: WorkflowDesignerPage;
}> {
  const db = createTestDbConnection();
  const tenantData = await createTenantAndLogin(db, page, {
    tenantOptions: {
      companyName: `Workflow E2E ${uuidv4().slice(0, 6)}`,
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

async function createWorkflowDefinition(db: Knex, name: string, steps: Record<string, unknown>[] = []): Promise<WorkflowSeed> {
  const workflowId = uuidv4();
  const now = new Date().toISOString();
  const definition = {
    id: workflowId,
    version: 1,
    name,
    description: '',
    payloadSchemaRef: 'payload.EmailWorkflowPayload.v1',
    steps,
  };

  await db('workflow_definitions').insert({
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
  });
  await db('workflow_definition_versions').insert({
    version_id: uuidv4(),
    workflow_id: workflowId,
    version: 1,
    definition_json: definition,
    payload_schema_json: null,
    published_by: null,
    published_at: now,
    created_at: now,
    updated_at: now,
  });

  return { workflowId, name, version: 1 };
}

async function createWorkflowRun(db: Knex, run: RunSeed): Promise<void> {
  await db('workflow_runs').insert({
    run_id: run.runId,
    workflow_id: run.workflowId,
    workflow_version: run.version,
    tenant_id: run.tenantId,
    status: run.status,
    node_path: run.nodePath ?? null,
    input_json: null,
    error_json: null,
    started_at: run.startedAt,
    updated_at: run.updatedAt ?? run.startedAt,
    completed_at: run.completedAt ?? null,
  });
}

async function createWaitKey(db: Knex, runId: string, key: string, waitType = 'EVENT'): Promise<void> {
  await db('workflow_run_waits').insert({
    wait_id: uuidv4(),
    run_id: runId,
    step_path: 'root.steps[0]',
    wait_type: waitType,
    key,
    event_name: 'WAIT_FOR_EVENT',
    status: 'WAITING',
    payload: null,
    created_at: new Date().toISOString(),
  });
}

async function openRunsTab(page: Page): Promise<void> {
  await page.goto(`${TEST_CONFIG.baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  await page.goto(`${TEST_CONFIG.baseUrl}/msp/workflows`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('heading', { name: 'Workflow Designer' }).waitFor({ state: 'visible', timeout: 20_000 });
  const runsTab = page.getByRole('tab', { name: 'Runs', exact: true });
  await runsTab.waitFor({ state: 'visible', timeout: 20_000 });
  await runsTab.click();
  await expect(runsTab).toHaveAttribute('data-state', 'active', { timeout: 10_000 });
  await page.locator('#workflow-runs-search').waitFor({ state: 'visible', timeout: 20_000 });
  const loadingRow = page.getByText('Loading workflow runs...');
  if (await loadingRow.isVisible().catch(() => false)) {
    await expect(loadingRow).toBeHidden({ timeout: 20_000 });
  }
}

function findRunRow(page: Page, runId: string) {
  const table = page.locator('table').filter({
    has: page.getByRole('columnheader', { name: 'Run ID' })
  });
  return table.locator('tbody tr').filter({ has: page.getByText(runId) });
}

test.describe('Workflow Designer UI - E2E flows', () => {
  test('create workflow draft with metadata and steps and see it in list', async ({ page }) => {
    test.setTimeout(180000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const workflowName = `E2E Draft ${uuidv4().slice(0, 6)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.nameInput.fill(workflowName);
      await workflowPage.descriptionInput.fill('E2E draft workflow');
      await workflowPage.selectPayloadSchemaRef('payload.EmailWorkflowPayload.v1');
      await workflowPage.triggerInput.fill('workflow.e2e.draft');

      const addAssign = workflowPage.addButtonFor('transform.assign');
      await addAssign.scrollIntoViewIfNeeded();
      await addAssign.click();
      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(stepId).click();
      await page.locator(`#config-${stepId}-assign-add`).click();
      await page.locator(`#config-${stepId}-assign-key-0`).fill('payload.subject');
      await page.locator(`#config-${stepId}-assign-expr-0-expr`).fill('payload.subject');

      await workflowPage.saveDraft();
      await expect(page.getByRole('button', { name: workflowName })).toBeVisible({ timeout: 10_000 });
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('publish workflow from designer and see publish success state', async ({ page }) => {
    test.setTimeout(180000);

    const { db, tenantData, workflowPage } = await setupDesigner(page);
    const workflowName = `E2E Publish ${uuidv4().slice(0, 6)}`;

    try {
      await workflowPage.clickNewWorkflow();
      await workflowPage.nameInput.fill(workflowName);
      await workflowPage.selectPayloadSchemaRef('payload.EmailWorkflowPayload.v1');

      const addAssign = workflowPage.addButtonFor('transform.assign');
      await addAssign.scrollIntoViewIfNeeded();
      await addAssign.click();
      const stepId = await workflowPage.getFirstStepId();
      await workflowPage.stepSelectButton(stepId).click();
      await page.locator(`#config-${stepId}-assign-add`).click();
      await page.locator(`#config-${stepId}-assign-key-0`).fill('payload.subject');
      await page.locator(`#config-${stepId}-assign-expr-0-expr`).fill('payload.subject');

      await workflowPage.saveDraft();
      await expect(page.getByRole('button', { name: workflowName })).toBeVisible({ timeout: 10_000 });

      await workflowPage.publishButton.click();
      await expect(page.getByText('Workflow published')).toBeVisible();
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('trigger workflow run via API and see it in Runs tab', async ({ page }) => {
    test.setTimeout(240000);

    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow E2E ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    const workflowName = `E2E Run ${uuidv4().slice(0, 6)}`;

    try {
      const workflow = await createWorkflowDefinition(db, workflowName);
      const response = await page.request.post(`${TEST_CONFIG.baseUrl}/api/workflow-runs`, {
        data: {
          workflowId: workflow.workflowId,
          payload: { subject: 'hello' },
        },
      });
      expect(response.ok()).toBeTruthy();
      const payload = (await response.json()) as { runId: string };
      const runId = payload.runId;

      await openRunsTab(page);
      await page.locator('#workflow-runs-search').fill(runId);
      await page.locator('#workflow-runs-apply').click();
      const row = findRunRow(page, runId);
      await expect(row).toBeVisible();
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('admin resumes waiting run from run details and status updates in list', async ({ page }) => {
    test.setTimeout(240000);

    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow E2E ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    const workflowName = `E2E Resume ${uuidv4().slice(0, 6)}`;

    try {
      const workflow = await createWorkflowDefinition(db, workflowName, [
        {
          id: 'wait-step',
          type: 'event.wait',
          name: 'wait-step',
          config: {
            eventName: 'WAIT_FOR_EVENT',
            correlationKey: { $expr: 'payload.correlationKey' }
          }
        }
      ]);
      const runId = uuidv4();
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: workflow.version,
        status: 'WAITING',
        startedAt: new Date('2025-02-05T10:00:00Z').toISOString(),
        tenantId,
        nodePath: 'root.steps[0]'
      });
      await createWaitKey(db, runId, `wait-${uuidv4().slice(0, 6)}`);

      await openRunsTab(page);
      await page.locator('#workflow-runs-search').fill(runId);
      await page.locator('#workflow-runs-apply').click();
      await page.locator(`#workflow-runs-view-${runId}`).click();
      await page.locator('#workflow-run-resume').click();
      await page.locator('#workflow-run-resume-reason').fill('Resume run');
      await page.locator('#workflow-run-resume-confirm-confirm').click();
      await expect(page.getByText('Run resumed')).toBeVisible();
      await page.locator('#workflow-run-close').click();

      await page.locator('#workflow-runs-refresh').click();
      const row = findRunRow(page, runId);
      await expect(row).toContainText(/SUCCEEDED|RUNNING|FAILED/);
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('admin cancels run from run details and status updates in list', async ({ page }) => {
    test.setTimeout(240000);

    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow E2E ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    const workflowName = `E2E Cancel ${uuidv4().slice(0, 6)}`;

    try {
      const workflow = await createWorkflowDefinition(db, workflowName);
      const runId = uuidv4();
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: workflow.version,
        status: 'RUNNING',
        startedAt: new Date('2025-02-06T10:00:00Z').toISOString(),
        tenantId,
      });

      await openRunsTab(page);
      await page.locator('#workflow-runs-search').fill(runId);
      await page.locator('#workflow-runs-apply').click();
      await page.locator(`#workflow-runs-view-${runId}`).click();
      await page.locator('#workflow-run-cancel').click();
      await page.locator('#workflow-run-cancel-reason').fill('Cancel run');
      await page.locator('#workflow-run-cancel-confirm-confirm').click();
      await expect(page.getByText('Run canceled')).toBeVisible();
      await page.locator('#workflow-run-close').click();

      await page.locator('#workflow-runs-refresh').click();
      const row = findRunRow(page, runId);
      await expect(row).toContainText('CANCELED');
    } finally {
      await db('workflow_definitions').where({ name: workflowName }).del().catch(() => undefined);
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});
