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

type EventSeed = {
  eventId: string;
  tenantId: string;
  eventName: string;
  correlationKey?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt?: string;
  processedAt?: string | null;
  matchedRunId?: string | null;
  matchedWaitId?: string | null;
  matchedStepPath?: string | null;
  errorMessage?: string | null;
};

type WaitSeed = {
  waitId: string;
  runId: string;
  stepPath: string;
  status: string;
  eventName?: string | null;
  key?: string | null;
  timeoutAt?: string | null;
  resolvedAt?: string | null;
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

async function createWorkflowEvent(db: Knex, event: EventSeed): Promise<void> {
  await db('workflow_runtime_events').insert({
    event_id: event.eventId,
    tenant_id: event.tenantId,
    event_name: event.eventName,
    correlation_key: event.correlationKey ?? null,
    payload: event.payload ?? null,
    created_at: event.createdAt ?? new Date().toISOString(),
    processed_at: event.processedAt ?? null,
    matched_run_id: event.matchedRunId ?? null,
    matched_wait_id: event.matchedWaitId ?? null,
    matched_step_path: event.matchedStepPath ?? null,
    error_message: event.errorMessage ?? null,
  });
}

async function createWorkflowWait(db: Knex, wait: WaitSeed): Promise<void> {
  await db('workflow_run_waits').insert({
    wait_id: wait.waitId,
    run_id: wait.runId,
    step_path: wait.stepPath,
    wait_type: 'EVENT',
    key: wait.key ?? null,
    event_name: wait.eventName ?? null,
    status: wait.status,
    timeout_at: wait.timeoutAt ?? null,
    resolved_at: wait.resolvedAt ?? null,
    payload: null,
    created_at: new Date().toISOString(),
  });
}

async function openEventsTab(page: Page, tenantId: string): Promise<void> {
  await page.context().setExtraHTTPHeaders({ 'x-tenant-id': tenantId });
  await page.goto(`${TEST_CONFIG.baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  await page.goto(`${TEST_CONFIG.baseUrl}/msp/workflows`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('#workflow-designer-tabs-trigger-2').click();
  await page.locator('#workflow-events-name').waitFor({ state: 'visible', timeout: 20_000 });
  await expect(page.getByText('Loading events...')).toHaveCount(0);
}

async function selectFromCustomSelect(page: Page, containerId: string, optionText: string) {
  const container = page.locator(`#${containerId}`);
  const trigger = container.getByRole('combobox').first();
  await trigger.waitFor({ state: 'visible' });
  await trigger.click();
  await page.getByRole('option', { name: optionText, exact: true }).click();
}

async function waitForEventDetailLoaded(page: Page): Promise<void> {
  await expect(page.getByText('Loading event detail...')).toHaveCount(0);
}

async function waitForEventsLoaded(page: Page): Promise<void> {
  await expect(page.getByText('Loading events...')).toHaveCount(0);
}

test.describe('Workflow Designer UI - events tab', () => {
  test('events tab lists workflow events with status badges', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Events ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const workflow = await createWorkflowDefinition(db, `Events Status ${uuidv4().slice(0, 6)}`);
      const runId = uuidv4();
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'RUNNING',
        startedAt: new Date('2025-01-12T10:00:00Z').toISOString(),
        tenantId,
      });
      await createWorkflowEvent(db, {
        eventId: uuidv4(),
        tenantId,
        eventName: 'workflow.matched',
        correlationKey: 'corr-matched',
        matchedRunId: runId,
      });
      await createWorkflowEvent(db, {
        eventId: uuidv4(),
        tenantId,
        eventName: 'workflow.error',
        correlationKey: 'corr-error',
        errorMessage: 'boom',
      });

      await openEventsTab(page, tenantId);
      await expect(page.getByText('workflow.matched')).toBeVisible();
      await expect(page.locator('tbody').getByText('matched', { exact: true })).toBeVisible();
      await expect(page.getByText('workflow.error')).toBeVisible();
      await expect(page.locator('tbody').getByText('error', { exact: true })).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('events tab shows summary counts for matched/unmatched/error', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Events ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const workflow = await createWorkflowDefinition(db, `Events Summary ${uuidv4().slice(0, 6)}`);
      const runId = uuidv4();
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'SUCCEEDED',
        startedAt: new Date('2025-01-12T10:00:00Z').toISOString(),
        completedAt: new Date('2025-01-12T10:02:00Z').toISOString(),
        tenantId,
      });
      await createWorkflowEvent(db, {
        eventId: uuidv4(),
        tenantId,
        eventName: 'workflow.matched',
        correlationKey: 'corr-matched',
        matchedRunId: runId,
      });
      await createWorkflowEvent(db, {
        eventId: uuidv4(),
        tenantId,
        eventName: 'workflow.unmatched',
        correlationKey: 'corr-unmatched',
      });
      await createWorkflowEvent(db, {
        eventId: uuidv4(),
        tenantId,
        eventName: 'workflow.error',
        correlationKey: 'corr-error',
        errorMessage: 'boom',
      });

      await openEventsTab(page, tenantId);
      await expect(page.getByText('Total: 3', { exact: true })).toBeVisible();
      await expect(page.getByText('Matched: 1', { exact: true })).toBeVisible();
      await expect(page.getByText('Unmatched: 1', { exact: true })).toBeVisible();
      await expect(page.getByText('Errors: 1', { exact: true })).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('events filter by name updates list', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Events ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      await createWorkflowEvent(db, {
        eventId: uuidv4(),
        tenantId,
        eventName: 'workflow.alpha',
        correlationKey: 'corr-alpha',
      });
      await createWorkflowEvent(db, {
        eventId: uuidv4(),
        tenantId,
        eventName: 'workflow.beta',
        correlationKey: 'corr-beta',
      });

      await openEventsTab(page, tenantId);
      await page.locator('#workflow-events-name').fill('workflow.alpha');
      await page.locator('#workflow-events-apply').click();

      await expect(page.getByText('workflow.alpha')).toBeVisible();
      await expect(page.getByText('workflow.beta')).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('events filter by correlation key updates list', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Events ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      await createWorkflowEvent(db, {
        eventId: uuidv4(),
        tenantId,
        eventName: 'workflow.alpha',
        correlationKey: 'corr-alpha',
      });
      await createWorkflowEvent(db, {
        eventId: uuidv4(),
        tenantId,
        eventName: 'workflow.beta',
        correlationKey: 'corr-beta',
      });

      await openEventsTab(page, tenantId);
      await page.locator('#workflow-events-correlation').fill('corr-beta');
      await page.locator('#workflow-events-apply').click();

      await expect(page.getByText('workflow.beta')).toBeVisible();
      await expect(page.getByText('workflow.alpha')).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('events filter by status updates list', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Events ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      await createWorkflowEvent(db, {
        eventId: uuidv4(),
        tenantId,
        eventName: 'workflow.unmatched',
        correlationKey: 'corr-unmatched',
      });
      await createWorkflowEvent(db, {
        eventId: uuidv4(),
        tenantId,
        eventName: 'workflow.error',
        correlationKey: 'corr-error',
        errorMessage: 'boom',
      });

      await openEventsTab(page, tenantId);
      await selectFromCustomSelect(page, 'workflow-events-status', 'Error');
      await page.locator('#workflow-events-apply').click();

      await expect(page.getByText('workflow.error')).toBeVisible();
      await expect(page.getByText('workflow.unmatched')).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('events date range filters update list', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Events ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      await createWorkflowEvent(db, {
        eventId: uuidv4(),
        tenantId,
        eventName: 'workflow.in-range',
        correlationKey: 'corr-in',
        createdAt: new Date('2025-01-11T12:00:00Z').toISOString(),
      });
      await createWorkflowEvent(db, {
        eventId: uuidv4(),
        tenantId,
        eventName: 'workflow.out-range',
        correlationKey: 'corr-out',
        createdAt: new Date('2025-02-01T12:00:00Z').toISOString(),
      });

      await openEventsTab(page, tenantId);
      await page.locator('#workflow-events-from').fill('2025-01-10');
      await page.locator('#workflow-events-to').fill('2025-01-12');
      await page.locator('#workflow-events-apply').click();
      await waitForEventsLoaded(page);

      await expect(page.getByText('workflow.in-range')).toBeVisible();
      await expect(page.getByText('workflow.out-range')).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('events reset filters restores defaults', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Events ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      await createWorkflowEvent(db, {
        eventId: uuidv4(),
        tenantId,
        eventName: 'workflow.alpha',
        correlationKey: 'corr-alpha',
      });
      await createWorkflowEvent(db, {
        eventId: uuidv4(),
        tenantId,
        eventName: 'workflow.beta',
        correlationKey: 'corr-beta',
      });

      await openEventsTab(page, tenantId);
      await page.locator('#workflow-events-name').fill('workflow.alpha');
      await page.locator('#workflow-events-correlation').fill('corr-alpha');
      await selectFromCustomSelect(page, 'workflow-events-status', 'Matched');
      await page.locator('#workflow-events-apply').click();
      await waitForEventsLoaded(page);
      await expect(page.locator('#workflow-events-reset')).toBeEnabled();

      await page.locator('#workflow-events-reset').click();
      await waitForEventsLoaded(page);

      await expect(page.locator('#workflow-events-name')).toHaveValue('');
      await expect(page.locator('#workflow-events-correlation')).toHaveValue('');
      await expect(page.locator('#workflow-events-status').getByRole('combobox').first()).toHaveText(/All statuses/);
      await expect(page.getByText('workflow.alpha')).toBeVisible();
      await expect(page.getByText('workflow.beta')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('events export CSV triggers download and toast', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Events ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      await createWorkflowEvent(db, {
        eventId: uuidv4(),
        tenantId,
        eventName: 'workflow.export',
        correlationKey: 'corr-export',
      });

      await openEventsTab(page, tenantId);
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#workflow-events-export-csv').click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe('workflow-events.csv');
      await expect(page.getByText('Event export ready')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('events export JSON triggers download and toast', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Events ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      await createWorkflowEvent(db, {
        eventId: uuidv4(),
        tenantId,
        eventName: 'workflow.export',
        correlationKey: 'corr-export',
      });

      await openEventsTab(page, tenantId);
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#workflow-events-export-json').click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe('workflow-events.json');
      await expect(page.getByText('Event export ready')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('events load more appends additional results', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Events ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const createdAt = new Date('2025-01-12T10:00:00Z').toISOString();
      const events = Array.from({ length: 30 }).map((_, index) => ({
        eventId: uuidv4(),
        tenantId,
        eventName: `workflow.bulk.${index + 1}`,
        correlationKey: `corr-${index + 1}`,
        createdAt,
      }));
      for (const event of events) {
        await createWorkflowEvent(db, event);
      }

      await openEventsTab(page, tenantId);
      const rows = page.locator('tbody tr');
      await expect.poll(async () => rows.count()).toBe(25);
      await page.locator('#workflow-events-load-more').click();
      await expect.poll(async () => rows.count()).toBe(30);
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('events empty state displays when no events', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Events ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      await openEventsTab(page, tenantId);
      await expect(page.getByText('No workflow events found.')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('selecting event shows detail panel with payload and linked run', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Events ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const workflow = await createWorkflowDefinition(db, `Events Detail ${uuidv4().slice(0, 6)}`);
      const runId = uuidv4();
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'WAITING',
        startedAt: new Date('2025-01-12T10:00:00Z').toISOString(),
        tenantId,
      });
      const eventId = uuidv4();
      await createWorkflowEvent(db, {
        eventId,
        tenantId,
        eventName: 'workflow.detail',
        correlationKey: 'corr-detail',
        matchedRunId: runId,
        payload: { example: 'value' },
      });

      await openEventsTab(page, tenantId);
      await page.getByText('workflow.detail').click();
      await waitForEventDetailLoaded(page);
      await expect(page.getByText(/^Event Detail$/)).toBeVisible();
      await expect(page.locator('#workflow-event-detail-event-id')).toHaveText(eventId);
      await expect(page.locator('#workflow-event-detail-correlation')).toHaveText('corr-detail');
      await expect(page.locator('#workflow-event-payload')).toHaveValue(/"example": "value"/);
      await expect(page.locator('#workflow-event-view-run')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('event detail shows wait metadata when available', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Events ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const workflow = await createWorkflowDefinition(db, `Events Wait ${uuidv4().slice(0, 6)}`);
      const runId = uuidv4();
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'WAITING',
        startedAt: new Date('2025-01-12T10:00:00Z').toISOString(),
        tenantId,
      });
      const waitId = uuidv4();
      await createWorkflowWait(db, {
        waitId,
        runId,
        stepPath: 'root.steps[0]',
        status: 'WAITING',
        eventName: 'event.wait',
        key: 'corr-wait',
      });
      await createWorkflowEvent(db, {
        eventId: uuidv4(),
        tenantId,
        eventName: 'workflow.wait',
        correlationKey: 'corr-wait',
        matchedRunId: runId,
        matchedWaitId: waitId,
        matchedStepPath: 'root.steps[0]',
      });

      await openEventsTab(page, tenantId);
      await page.getByText('workflow.wait').click();
      await waitForEventDetailLoaded(page);
      await expect(page.locator('#workflow-event-detail-wait-id')).toHaveText(`Wait ID: ${waitId}`);
      await expect(page.locator('#workflow-event-detail-wait-status')).toHaveText('Status: WAITING');
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('event detail shows run metadata when matched', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Events ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const workflow = await createWorkflowDefinition(db, `Events Run ${uuidv4().slice(0, 6)}`);
      const runId = uuidv4();
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'RUNNING',
        startedAt: new Date('2025-01-12T10:00:00Z').toISOString(),
        tenantId,
      });
      await createWorkflowEvent(db, {
        eventId: uuidv4(),
        tenantId,
        eventName: 'workflow.run',
        correlationKey: 'corr-run',
        matchedRunId: runId,
      });

      await openEventsTab(page, tenantId);
      await page.getByText('workflow.run').click();
      await waitForEventDetailLoaded(page);
      await expect(page.getByText(/^Matched run$/)).toBeVisible();
      await expect(page.locator('#workflow-event-detail-run-id')).toHaveText(runId);
      await expect(page.locator('#workflow-event-detail-run-status')).toHaveText('Status: RUNNING');
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('event detail handles missing wait/run gracefully', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Events ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      await createWorkflowEvent(db, {
        eventId: uuidv4(),
        tenantId,
        eventName: 'workflow.missing',
        correlationKey: 'corr-missing',
        matchedRunId: uuidv4(),
        matchedWaitId: uuidv4(),
      });

      await openEventsTab(page, tenantId);
      await page.getByText('workflow.missing').click();
      await waitForEventDetailLoaded(page);
      await expect(page.getByText(/^Event Detail$/)).toBeVisible();
      await expect(page.getByText(/^Matched run$/)).toHaveCount(0);
      await expect(page.getByText('Wait ID:')).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('event detail view run button opens run details panel', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Events ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const workflow = await createWorkflowDefinition(db, `Events View Run ${uuidv4().slice(0, 6)}`);
      const runId = uuidv4();
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'RUNNING',
        startedAt: new Date('2025-01-12T10:00:00Z').toISOString(),
        tenantId,
      });
      await createWorkflowEvent(db, {
        eventId: uuidv4(),
        tenantId,
        eventName: 'workflow.view-run',
        correlationKey: 'corr-view',
        matchedRunId: runId,
      });

      await openEventsTab(page, tenantId);
      await page.getByText('workflow.view-run').click();
      await waitForEventDetailLoaded(page);
      await page.locator('#workflow-event-view-run').click();
      await expect(page.locator('#workflow-run-detail-id')).toHaveText(runId);
      await expect(page.locator('#workflow-run-close')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});
