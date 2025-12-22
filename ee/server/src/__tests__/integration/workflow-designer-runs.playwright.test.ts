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

async function createWorkflowDefinition(db: Knex, name: string, version = 1): Promise<WorkflowSeed> {
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

async function createWorkflowRun(db: Knex, run: RunSeed): Promise<void> {
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

async function createWaitKey(db: Knex, runId: string, key: string): Promise<void> {
  await db('workflow_run_waits').insert({
    wait_id: uuidv4(),
    run_id: runId,
    step_path: 'root.steps[0]',
    wait_type: 'EVENT',
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
  await page.locator('#workflow-designer-tabs-trigger-1').click();
  await page.locator('#workflow-runs-search').waitFor({ state: 'visible', timeout: 20_000 });
  const loadingRow = page.getByText('Loading workflow runs...');
  if (await loadingRow.isVisible().catch(() => false)) {
    await expect(loadingRow).toBeHidden({ timeout: 20_000 });
  }
}

async function selectFromCustomSelect(page: Page, containerId: string, optionText: string) {
  const container = page.locator(`#${containerId}`);
  const trigger = container.getByRole('combobox').first();
  await trigger.waitFor({ state: 'visible' });
  await trigger.click();
  await page.getByRole('option', { name: optionText, exact: true }).click();
}

test.describe('Workflow Designer UI - runs tab', () => {
  test('runs tab lists workflow runs with status badges', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Runs ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    const runId = uuidv4();

    try {
      const workflow = await createWorkflowDefinition(db, `Runs List ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'RUNNING',
        startedAt: new Date('2025-01-10T10:00:00Z').toISOString(),
        tenantId,
      });

      await openRunsTab(page);
      await expect(page.getByText(runId)).toBeVisible();
      await expect(page.locator('tbody').getByText('RUNNING', { exact: true })).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('runs tab shows summary counts by status', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Runs ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const workflow = await createWorkflowDefinition(db, `Runs Summary ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId: uuidv4(),
        workflowId: workflow.workflowId,
        version: 1,
        status: 'SUCCEEDED',
        startedAt: new Date('2025-01-10T10:00:00Z').toISOString(),
        completedAt: new Date('2025-01-10T10:05:00Z').toISOString(),
        tenantId,
      });
      await createWorkflowRun(db, {
        runId: uuidv4(),
        workflowId: workflow.workflowId,
        version: 1,
        status: 'FAILED',
        startedAt: new Date('2025-01-10T11:00:00Z').toISOString(),
        completedAt: new Date('2025-01-10T11:01:00Z').toISOString(),
        tenantId,
      });

      await openRunsTab(page);
      await expect(page.getByText('Total: 2')).toBeVisible();
      await expect(page.getByText('SUCCEEDED: 1')).toBeVisible();
      await expect(page.getByText('FAILED: 1')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('runs filter by status updates list', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Runs ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    const runningId = uuidv4();
    const failedId = uuidv4();

    try {
      const workflow = await createWorkflowDefinition(db, `Runs Status ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId: runningId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'RUNNING',
        startedAt: new Date('2025-01-11T10:00:00Z').toISOString(),
        tenantId,
      });
      await createWorkflowRun(db, {
        runId: failedId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'FAILED',
        startedAt: new Date('2025-01-11T11:00:00Z').toISOString(),
        tenantId,
      });

      await openRunsTab(page);
      await selectFromCustomSelect(page, 'workflow-runs-status', 'Failed');
      await page.locator('#workflow-runs-apply').click();

      await expect(page.getByText(failedId)).toBeVisible();
      await expect(page.getByText(runningId)).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('runs filter by workflow id and version updates list', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Runs ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    const workflowA = await createWorkflowDefinition(db, `Runs Filter A ${uuidv4().slice(0, 6)}`, 1);
    const workflowB = await createWorkflowDefinition(db, `Runs Filter B ${uuidv4().slice(0, 6)}`, 2);
    const runA = uuidv4();
    const runB = uuidv4();

    try {
      await createWorkflowRun(db, {
        runId: runA,
        workflowId: workflowA.workflowId,
        version: 1,
        status: 'SUCCEEDED',
        startedAt: new Date('2025-01-12T09:00:00Z').toISOString(),
        completedAt: new Date('2025-01-12T09:05:00Z').toISOString(),
        tenantId,
      });
      await createWorkflowRun(db, {
        runId: runB,
        workflowId: workflowB.workflowId,
        version: 2,
        status: 'SUCCEEDED',
        startedAt: new Date('2025-01-12T10:00:00Z').toISOString(),
        completedAt: new Date('2025-01-12T10:05:00Z').toISOString(),
        tenantId,
      });

      await openRunsTab(page);
      await selectFromCustomSelect(page, 'workflow-runs-workflow', workflowA.name);
      await page.locator('#workflow-runs-version').fill('1');
      await page.locator('#workflow-runs-apply').click();

      await expect(page.getByText(runA)).toBeVisible();
      await expect(page.getByText(runB)).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('runs search filters by run id or correlation key', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Runs ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    const runId = uuidv4();
    const correlationKey = `corr-${uuidv4().slice(0, 6)}`;

    try {
      const workflow = await createWorkflowDefinition(db, `Runs Search ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'WAITING',
        startedAt: new Date('2025-01-12T11:00:00Z').toISOString(),
        tenantId,
      });
      await createWaitKey(db, runId, correlationKey);

      await openRunsTab(page);
      await page.locator('#workflow-runs-search').fill(runId);
      await page.locator('#workflow-runs-apply').click();
      await expect(page.getByText(runId)).toBeVisible();

      await page.locator('#workflow-runs-search').fill(correlationKey);
      await page.locator('#workflow-runs-apply').click();
      await expect(page.getByText(runId)).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('runs date range filters update list', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Runs ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    const earlyRun = uuidv4();
    const lateRun = uuidv4();

    try {
      const workflow = await createWorkflowDefinition(db, `Runs Date ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId: earlyRun,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'SUCCEEDED',
        startedAt: new Date('2025-01-01T08:00:00Z').toISOString(),
        completedAt: new Date('2025-01-01T08:10:00Z').toISOString(),
        tenantId,
      });
      await createWorkflowRun(db, {
        runId: lateRun,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'SUCCEEDED',
        startedAt: new Date('2025-01-10T08:00:00Z').toISOString(),
        completedAt: new Date('2025-01-10T08:05:00Z').toISOString(),
        tenantId,
      });

      await openRunsTab(page);
      await page.locator('#workflow-runs-from').fill('2025-01-05');
      await page.locator('#workflow-runs-to').fill('2025-01-12');
      await page.locator('#workflow-runs-apply').click();

      await expect(page.getByText(lateRun)).toBeVisible();
      await expect(page.getByText(earlyRun)).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('runs sort order changes list ordering', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Runs ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    const earlyRun = uuidv4();
    const lateRun = uuidv4();

    try {
      const workflow = await createWorkflowDefinition(db, `Runs Sort ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId: earlyRun,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'SUCCEEDED',
        startedAt: new Date('2025-01-02T08:00:00Z').toISOString(),
        completedAt: new Date('2025-01-02T08:05:00Z').toISOString(),
        tenantId,
      });
      await createWorkflowRun(db, {
        runId: lateRun,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'SUCCEEDED',
        startedAt: new Date('2025-01-03T08:00:00Z').toISOString(),
        completedAt: new Date('2025-01-03T08:05:00Z').toISOString(),
        tenantId,
      });

      await openRunsTab(page);
      await selectFromCustomSelect(page, 'workflow-runs-sort', 'Oldest first');
      await page.locator('#workflow-runs-apply').click();

      const firstRow = page.locator('tbody tr').first();
      await expect(firstRow).toContainText(earlyRun);
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('runs reset filters restores defaults and reloads list', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Runs ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    const runningId = uuidv4();
    const failedId = uuidv4();

    try {
      const workflow = await createWorkflowDefinition(db, `Runs Reset ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId: runningId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'RUNNING',
        startedAt: new Date('2025-01-04T08:00:00Z').toISOString(),
        tenantId,
      });
      await createWorkflowRun(db, {
        runId: failedId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'FAILED',
        startedAt: new Date('2025-01-04T09:00:00Z').toISOString(),
        tenantId,
      });

      await openRunsTab(page);
      await selectFromCustomSelect(page, 'workflow-runs-status', 'Failed');
      await page.locator('#workflow-runs-apply').click();
      await expect(page.getByText(failedId)).toBeVisible();
      await expect(page.getByText(runningId)).toHaveCount(0);

      await page.locator('#workflow-runs-reset').click();
      await expect(page.getByText(failedId)).toBeVisible();
      await expect(page.getByText(runningId)).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('runs quick range buttons set date inputs', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Runs ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      await createWorkflowDefinition(db, `Runs Quick ${uuidv4().slice(0, 6)}`);
      await openRunsTab(page);

      await page.locator('#workflow-runs-last-24h').click();
      const from24h = await page.locator('#workflow-runs-from').inputValue();
      const to24h = await page.locator('#workflow-runs-to').inputValue();
      expect(from24h).not.toBe('');
      expect(to24h).not.toBe('');

      await page.locator('#workflow-runs-last-7d').click();
      const from7d = await page.locator('#workflow-runs-from').inputValue();
      const to7d = await page.locator('#workflow-runs-to').inputValue();
      expect(from7d).not.toBe('');
      expect(to7d).not.toBe('');
      expect(from7d <= to7d).toBeTruthy();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('runs refresh reloads list without changing filters', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Runs ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    const initialRun = uuidv4();
    const newRun = uuidv4();

    try {
      const workflow = await createWorkflowDefinition(db, `Runs Refresh ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId: initialRun,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'RUNNING',
        startedAt: new Date('2025-01-05T08:00:00Z').toISOString(),
        tenantId,
      });

      await openRunsTab(page);
      await selectFromCustomSelect(page, 'workflow-runs-status', 'Running');
      await page.locator('#workflow-runs-apply').click();
      await expect(page.getByText(initialRun)).toBeVisible();

      await createWorkflowRun(db, {
        runId: newRun,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'RUNNING',
        startedAt: new Date('2025-01-05T09:00:00Z').toISOString(),
        tenantId,
      });

      await page.locator('#workflow-runs-refresh').click();
      await expect(page.getByText(newRun)).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('runs export triggers CSV download and success toast', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Runs ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const workflow = await createWorkflowDefinition(db, `Runs Export ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId: uuidv4(),
        workflowId: workflow.workflowId,
        version: 1,
        status: 'SUCCEEDED',
        startedAt: new Date('2025-01-06T08:00:00Z').toISOString(),
        completedAt: new Date('2025-01-06T08:03:00Z').toISOString(),
        tenantId,
      });

      await openRunsTab(page);
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#workflow-runs-export').click(),
      ]);
      expect(download.suggestedFilename()).toBe('workflow-runs.csv');
      await expect(page.getByText('Run export ready')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('runs load more appends additional results', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Runs ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const workflow = await createWorkflowDefinition(db, `Runs Load ${uuidv4().slice(0, 6)}`);
      const baseTime = new Date('2025-01-07T08:00:00Z').getTime();
      for (let i = 0; i < 30; i += 1) {
        await createWorkflowRun(db, {
          runId: uuidv4(),
          workflowId: workflow.workflowId,
          version: 1,
          status: 'SUCCEEDED',
          startedAt: new Date(baseTime + i * 60_000).toISOString(),
          completedAt: new Date(baseTime + i * 60_000 + 10_000).toISOString(),
          tenantId,
        });
      }

      await openRunsTab(page);
      const loadMore = page.locator('#workflow-runs-load-more');
      await loadMore.scrollIntoViewIfNeeded();
      await expect(loadMore).toBeVisible();
      const initialCount = await page.locator('tbody tr').count();
      await loadMore.click();
      await expect
        .poll(() => page.locator('tbody tr').count(), { timeout: 10_000 })
        .toBeGreaterThan(initialCount);
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('runs empty state displays when no runs available', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Runs ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      await createWorkflowDefinition(db, `Runs Empty ${uuidv4().slice(0, 6)}`);
      await openRunsTab(page);
      const emptyState = page.getByText('No workflow runs match the current filters.');
      await emptyState.scrollIntoViewIfNeeded();
      await expect(emptyState).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('runs row click opens run details panel', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Runs ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    const runId = uuidv4();

    try {
      const workflow = await createWorkflowDefinition(db, `Runs Details ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'RUNNING',
        startedAt: new Date('2025-01-12T10:00:00Z').toISOString(),
        tenantId,
      });

      await openRunsTab(page);
      const viewButton = page.locator(`#workflow-runs-view-${runId}`);
      await viewButton.scrollIntoViewIfNeeded();
      await viewButton.click();
      await expect(page.locator('#workflow-run-detail-id')).toHaveText(runId);
      await expect(page.locator('#workflow-run-close')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('run details panel shows run metadata and status badge', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Runs ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    const runId = uuidv4();

    try {
      const workflow = await createWorkflowDefinition(db, `Runs Meta ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'FAILED',
        startedAt: new Date('2025-01-13T10:00:00Z').toISOString(),
        completedAt: new Date('2025-01-13T10:05:00Z').toISOString(),
        tenantId,
      });

      await openRunsTab(page);
      const viewButton = page.locator(`#workflow-runs-view-${runId}`);
      await viewButton.scrollIntoViewIfNeeded();
      await viewButton.click();
      await expect(page.getByText(`${workflow.name} · v1`)).toBeVisible();
      await expect(page.locator('#workflow-run-detail-status')).toHaveText('FAILED');
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('admin sees run selection checkboxes and bulk action controls', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Runs ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    const runId = uuidv4();

    try {
      const workflow = await createWorkflowDefinition(db, `Runs Admin ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'RUNNING',
        startedAt: new Date('2025-01-14T10:00:00Z').toISOString(),
        tenantId,
      });

      await openRunsTab(page);
      const selectAll = page.locator('[data-automation-id="workflow-runs-select-all"]');
      await expect(selectAll).toBeVisible();
      const rowCheckbox = page.locator(`[data-automation-id="workflow-runs-select-${runId}"]`);
      await rowCheckbox.scrollIntoViewIfNeeded();
      await rowCheckbox.click();
      await expect(page.locator('#workflow-runs-bulk-resume')).toBeVisible();
      await expect(page.locator('#workflow-runs-bulk-cancel')).toBeVisible();
      await expect(page.locator('#workflow-runs-clear-selection')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('select all toggles selection for visible runs', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Runs ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    const runA = uuidv4();
    const runB = uuidv4();

    try {
      const workflow = await createWorkflowDefinition(db, `Runs Select ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId: runA,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'RUNNING',
        startedAt: new Date('2025-01-15T10:00:00Z').toISOString(),
        tenantId,
      });
      await createWorkflowRun(db, {
        runId: runB,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'WAITING',
        startedAt: new Date('2025-01-15T10:05:00Z').toISOString(),
        tenantId,
      });

      await openRunsTab(page);
      const selectAll = page.locator('[data-automation-id="workflow-runs-select-all"]');
      await selectAll.click();
      await expect(page.locator(`[data-automation-id="workflow-runs-select-${runA}"]`)).toBeChecked();
      await expect(page.locator(`[data-automation-id="workflow-runs-select-${runB}"]`)).toBeChecked();
      await selectAll.click();
      await expect(page.locator(`[data-automation-id="workflow-runs-select-${runA}"]`)).not.toBeChecked();
      await expect(page.locator(`[data-automation-id="workflow-runs-select-${runB}"]`)).not.toBeChecked();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('bulk resume prompts for reason and submits admin resume', async ({ page }) => {
    test.setTimeout(240000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Runs ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    const runId = uuidv4();

    try {
      const workflow = await createWorkflowDefinition(db, `Runs Resume ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'WAITING',
        startedAt: new Date('2025-01-16T10:00:00Z').toISOString(),
        tenantId,
      });
      await createWaitKey(db, runId, `wait-${uuidv4().slice(0, 6)}`);

      await openRunsTab(page);
      const rowCheckbox = page.locator(`[data-automation-id="workflow-runs-select-${runId}"]`);
      await rowCheckbox.scrollIntoViewIfNeeded();
      await rowCheckbox.click();
      await page.locator('#workflow-runs-bulk-resume').click();
      const reasonField = page.locator('[data-automation-id="workflow-runs-bulk-resume-reason"]');
      await reasonField.fill('resume run');
      await page.locator('#workflow-runs-bulk-resume-confirm-confirm').click();
      await expect(page.getByText('Resumed 1 run(s).')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('bulk cancel prompts for reason and submits admin cancel', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Runs ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    const runId = uuidv4();

    try {
      const workflow = await createWorkflowDefinition(db, `Runs Cancel ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'RUNNING',
        startedAt: new Date('2025-01-17T10:00:00Z').toISOString(),
        tenantId,
      });

      await openRunsTab(page);
      const rowCheckbox = page.locator(`[data-automation-id="workflow-runs-select-${runId}"]`);
      await rowCheckbox.scrollIntoViewIfNeeded();
      await rowCheckbox.click();
      await page.locator('#workflow-runs-bulk-cancel').click();
      const reasonField = page.locator('[data-automation-id="workflow-runs-bulk-cancel-reason"]');
      await reasonField.fill('cancel run');
      await page.locator('#workflow-runs-bulk-cancel-confirm-confirm').click();
      await expect(page.getByText('Canceled 1 run(s).')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('bulk action clears selection after completion', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Runs ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    const runId = uuidv4();

    try {
      const workflow = await createWorkflowDefinition(db, `Runs Clear ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'RUNNING',
        startedAt: new Date('2025-01-18T10:00:00Z').toISOString(),
        tenantId,
      });

      await openRunsTab(page);
      const rowCheckbox = page.locator(`[data-automation-id="workflow-runs-select-${runId}"]`);
      await rowCheckbox.scrollIntoViewIfNeeded();
      await rowCheckbox.click();
      await page.locator('#workflow-runs-bulk-cancel').click();
      await page.locator('[data-automation-id="workflow-runs-bulk-cancel-reason"]').fill('clear selection');
      await page.locator('#workflow-runs-bulk-cancel-confirm-confirm').click();
      await expect(page.getByText('Canceled 1 run(s).')).toBeVisible();
      await expect(page.locator('[data-automation-id="workflow-runs-select-all"]')).not.toBeChecked();
      await expect(page.locator(`[data-automation-id="workflow-runs-select-${runId}"]`)).not.toBeChecked();
      await expect(page.locator('#workflow-runs-bulk-resume')).toBeHidden();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});
