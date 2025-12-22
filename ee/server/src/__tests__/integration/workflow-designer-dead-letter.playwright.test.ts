import { expect, test, type Page } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { rollbackTenant } from '../../lib/testing/tenant-creation';
import {
  applyPlaywrightAuthEnvDefaults,
  createTenantAndLogin,
  resolvePlaywrightBaseUrl,
} from './helpers/playwrightAuthSessionHelper';

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
};

type RunStepSeed = {
  runId: string;
  stepId: string;
  stepPath: string;
  definitionStepId: string;
  status: string;
  attempt: number;
  startedAt: string;
  completedAt?: string | null;
};

async function createWorkflowDefinition(db: ReturnType<typeof createTestDbConnection>, name: string, version = 1): Promise<WorkflowSeed> {
  const workflowId = uuidv4();
  const now = new Date().toISOString();
  const definition = {
    id: workflowId,
    version,
    name,
    description: '',
    payloadSchemaRef: 'payload.EmailWorkflowPayload.v1',
    steps: [],
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
    version,
    definition_json: definition,
    payload_schema_json: null,
    published_by: null,
    published_at: now,
    created_at: now,
    updated_at: now,
  });

  return { workflowId, name, version };
}

async function createWorkflowRun(db: ReturnType<typeof createTestDbConnection>, run: RunSeed): Promise<void> {
  await db('workflow_runs').insert({
    run_id: run.runId,
    workflow_id: run.workflowId,
    workflow_version: run.version,
    tenant_id: run.tenantId,
    status: run.status,
    node_path: null,
    input_json: null,
    error_json: null,
    started_at: run.startedAt,
    updated_at: run.updatedAt ?? run.startedAt,
    completed_at: run.completedAt ?? null,
  });
}

async function createWorkflowRunStep(db: ReturnType<typeof createTestDbConnection>, step: RunStepSeed): Promise<void> {
  await db('workflow_run_steps').insert({
    step_id: step.stepId,
    run_id: step.runId,
    step_path: step.stepPath,
    definition_step_id: step.definitionStepId,
    status: step.status,
    attempt: step.attempt,
    duration_ms: null,
    error_json: null,
    snapshot_id: null,
    started_at: step.startedAt,
    completed_at: step.completedAt ?? null,
  });
}

async function seedDeadLetterRun(
  db: ReturnType<typeof createTestDbConnection>,
  tenantId: string,
  attempt: number
): Promise<{ runId: string; workflowId: string; workflowName: string }> {
  const workflowName = `Dead Letter ${uuidv4().slice(0, 6)}`;
  const workflow = await createWorkflowDefinition(db, workflowName, 1);
  const runId = uuidv4();
  const startedAt = new Date('2025-02-02T12:00:00Z').toISOString();

  await createWorkflowRun(db, {
    runId,
    workflowId: workflow.workflowId,
    version: workflow.version,
    status: 'FAILED',
    startedAt,
    tenantId,
  });
  await createWorkflowRunStep(db, {
    runId,
    stepId: uuidv4(),
    stepPath: 'root.steps[0]',
    definitionStepId: 'step-1',
    status: 'FAILED',
    attempt,
    startedAt,
    completedAt: startedAt,
  });

  return { runId, workflowId: workflow.workflowId, workflowName };
}

async function openDeadLetterTab(page: Page, tenantId: string): Promise<void> {
  await page.context().setExtraHTTPHeaders({ 'x-tenant-id': tenantId });
  await page.goto(`${TEST_CONFIG.baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  await page.goto(`${TEST_CONFIG.baseUrl}/msp/workflows`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('#workflow-designer-tabs-trigger-3').click();
  await page.locator('#workflow-dead-letter-min-retries').waitFor({ state: 'visible', timeout: 20_000 });
  await expect(page.getByText('Loading dead-letter runs...')).toHaveCount(0);
}

test.describe('Workflow Designer UI - dead letter queue', () => {
  test('dead letter tab lists runs exceeding retry threshold', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Dead Letter ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const { runId } = await seedDeadLetterRun(db, tenantId, 4);
      await openDeadLetterTab(page, tenantId);
      const table = page.locator('table').filter({
        has: page.getByRole('columnheader', { name: 'Run ID' })
      });
      await expect(table.getByText(runId)).toBeVisible();
      const row = table.getByRole('row', { name: new RegExp(runId) });
      await expect(row.getByText('FAILED', { exact: true })).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('dead letter min retries filter updates list', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Dead Letter ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const lowAttempt = await seedDeadLetterRun(db, tenantId, 2);
      const highAttempt = await seedDeadLetterRun(db, tenantId, 5);

      await openDeadLetterTab(page, tenantId);
      const table = page.locator('table').filter({
        has: page.getByRole('columnheader', { name: 'Run ID' })
      });
      await expect(table.getByText(highAttempt.runId)).toBeVisible();
      await expect(table.getByText(lowAttempt.runId)).toHaveCount(0);

      await page.locator('#workflow-dead-letter-min-retries').fill('2');
      await page.locator('#workflow-dead-letter-refresh').click();
      await expect(table.getByText(lowAttempt.runId)).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('dead letter refresh reloads list', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Dead Letter ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const first = await seedDeadLetterRun(db, tenantId, 4);
      await openDeadLetterTab(page, tenantId);
      const table = page.locator('table').filter({
        has: page.getByRole('columnheader', { name: 'Run ID' })
      });
      await expect(table.getByText(first.runId)).toBeVisible();

      const second = await seedDeadLetterRun(db, tenantId, 4);
      await page.locator('#workflow-dead-letter-refresh').click();
      await expect(table.getByText(second.runId)).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('dead letter load more appends additional results', async ({ page }) => {
    test.setTimeout(240000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Dead Letter ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      for (let i = 0; i < 30; i += 1) {
        await seedDeadLetterRun(db, tenantId, 4);
      }
      await openDeadLetterTab(page, tenantId);
      const table = page.locator('table').filter({
        has: page.getByRole('columnheader', { name: 'Run ID' })
      });
      const rows = table.locator('tbody tr');
      const initialCount = await rows.count();
      const loadMore = page.locator('#workflow-dead-letter-load-more');
      await loadMore.scrollIntoViewIfNeeded();
      await expect(loadMore).toBeVisible();
      await loadMore.click();
      await expect.poll(async () => rows.count()).toBeGreaterThan(initialCount);
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('dead letter empty state displays when none present', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Dead Letter ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      await openDeadLetterTab(page, tenantId);
      await expect(page.getByText('No dead-letter runs found.')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('selecting dead-letter run opens run details panel', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Dead Letter ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const { runId } = await seedDeadLetterRun(db, tenantId, 4);
      await openDeadLetterTab(page, tenantId);
      await page.getByText(runId).click();
      await expect(page.locator('#workflow-run-detail-id')).toHaveText(runId);
      await expect(page.locator('#workflow-run-close')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});

test.describe('Workflow Designer UI - error handling', () => {
  test('dead letter fetch error shows toast', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Dead Letter ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    try {
      await openDeadLetterTab(page, tenantId);
      const adminRole = await db('roles')
        .where({ tenant: tenantId, role_name: 'Admin' })
        .first();
      const adminPermission = await db('permissions')
        .where({ tenant: tenantId, resource: 'workflow', action: 'admin' })
        .first();
      if (adminRole && adminPermission) {
        await db('role_permissions')
          .where({
            tenant: tenantId,
            role_id: adminRole.role_id,
            permission_id: adminPermission.permission_id,
          })
          .delete();
      }

      await page.locator('#workflow-dead-letter-refresh').click();
      await expect(
        page.getByText(/Failed to load dead-letter runs|Forbidden|Unauthorized|Internal Server Error|boom/)
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});
