import { expect, test, type Page } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import type { Step } from '@shared/workflow/runtime';
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

const RUN_DETAIL_STEP_IDS = {
  ifBlock: 'if-block',
  thenStep: 'set-state',
  elseStep: 'call-action',
  returnStep: 'return-step'
};

const RUN_DETAIL_PATHS = {
  ifBlock: 'root.steps[0]',
  thenStep: 'root.steps[0].then[0]',
  elseStep: 'root.steps[0].else[0]',
  returnStep: 'root.steps[1]'
};

const RUN_DETAIL_STEPS: Step[] = [
  {
    id: RUN_DETAIL_STEP_IDS.ifBlock,
    type: 'control.if',
    condition: { $expr: 'payload.isVip' },
    then: [
      {
        id: RUN_DETAIL_STEP_IDS.thenStep,
        type: 'core.setState',
        config: { state: 'processing' }
      }
    ],
    else: [
      {
        id: RUN_DETAIL_STEP_IDS.elseStep,
        type: 'action.call',
        config: { actionId: 'test.action', version: 1, args: { value: 'foo' } }
      }
    ]
  },
  {
    id: RUN_DETAIL_STEP_IDS.returnStep,
    type: 'control.return'
  }
];

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
  errorJson?: Record<string, unknown> | null;
  inputJson?: Record<string, unknown> | null;
};

async function createWorkflowDefinition(
  db: Knex,
  name: string,
  version = 1,
  steps: Step[] = []
): Promise<WorkflowSeed> {
  const workflowId = uuidv4();
  const now = new Date().toISOString();
  const definition = {
    id: workflowId,
    version,
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
    node_path: run.nodePath ?? null,
    input_json: run.inputJson ?? null,
    error_json: run.errorJson ?? null,
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

type RunWaitSeed = {
  waitId: string;
  runId: string;
  stepPath: string;
  waitType: string;
  status: string;
  eventName?: string | null;
  key?: string | null;
  timeoutAt?: string | null;
  resolvedAt?: string | null;
};

async function createWorkflowRunWait(db: Knex, wait: RunWaitSeed): Promise<void> {
  await db('workflow_run_waits').insert({
    wait_id: wait.waitId,
    run_id: wait.runId,
    step_path: wait.stepPath,
    wait_type: wait.waitType,
    key: wait.key ?? null,
    event_name: wait.eventName ?? null,
    status: wait.status,
    timeout_at: wait.timeoutAt ?? null,
    resolved_at: wait.resolvedAt ?? null,
    payload: null,
    created_at: new Date().toISOString()
  });
}

type RunStepSeed = {
  runId: string;
  stepId: string;
  stepPath: string;
  definitionStepId: string;
  status: string;
  attempt: number;
  startedAt: string;
  completedAt?: string | null;
  durationMs?: number | null;
  errorJson?: Record<string, unknown> | null;
  snapshotId?: string | null;
};

async function createWorkflowRunStep(db: Knex, step: RunStepSeed): Promise<void> {
  await db('workflow_run_steps').insert({
    step_id: step.stepId,
    run_id: step.runId,
    step_path: step.stepPath,
    definition_step_id: step.definitionStepId,
    status: step.status,
    attempt: step.attempt,
    duration_ms: step.durationMs ?? null,
    error_json: step.errorJson ?? null,
    snapshot_id: step.snapshotId ?? null,
    started_at: step.startedAt,
    completed_at: step.completedAt ?? null,
  });
}

type SnapshotSeed = {
  snapshotId: string;
  runId: string;
  stepPath: string;
  envelopeJson: Record<string, unknown>;
  createdAt?: string;
};

async function createWorkflowRunSnapshot(db: Knex, snapshot: SnapshotSeed): Promise<void> {
  const serialized = JSON.stringify(snapshot.envelopeJson ?? {});
  await db('workflow_run_snapshots').insert({
    snapshot_id: snapshot.snapshotId,
    run_id: snapshot.runId,
    step_path: snapshot.stepPath,
    envelope_json: snapshot.envelopeJson,
    size_bytes: serialized.length,
    created_at: snapshot.createdAt ?? new Date().toISOString()
  });
}

type InvocationSeed = {
  invocationId: string;
  runId: string;
  stepPath: string;
  actionId: string;
  actionVersion: number;
  status: string;
  attempt: number;
  inputJson?: Record<string, unknown> | null;
  outputJson?: Record<string, unknown> | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string;
};

async function createWorkflowActionInvocation(db: Knex, invocation: InvocationSeed): Promise<void> {
  await db('workflow_action_invocations').insert({
    invocation_id: invocation.invocationId,
    run_id: invocation.runId,
    step_path: invocation.stepPath,
    action_id: invocation.actionId,
    action_version: invocation.actionVersion,
    idempotency_key: uuidv4(),
    status: invocation.status,
    attempt: invocation.attempt,
    input_json: invocation.inputJson ?? null,
    output_json: invocation.outputJson ?? null,
    error_message: invocation.errorMessage ?? null,
    created_at: invocation.createdAt ?? new Date().toISOString(),
    started_at: invocation.startedAt ?? null,
    completed_at: invocation.completedAt ?? null
  });
}

type LogSeed = {
  logId: string;
  runId: string;
  tenantId: string;
  level: string;
  message: string;
  stepPath?: string | null;
  eventName?: string | null;
  correlationKey?: string | null;
  contextJson?: Record<string, unknown> | null;
  createdAt?: string;
};

async function createWorkflowRunLog(db: Knex, log: LogSeed): Promise<void> {
  await db('workflow_run_logs').insert({
    log_id: log.logId,
    run_id: log.runId,
    tenant_id: log.tenantId,
    step_path: log.stepPath ?? null,
    level: log.level,
    message: log.message,
    context_json: log.contextJson ?? null,
    correlation_key: log.correlationKey ?? null,
    event_name: log.eventName ?? null,
    source: 'ui',
    created_at: log.createdAt ?? new Date().toISOString()
  });
}

type AuditLogSeed = {
  auditId: string;
  tenantId: string;
  recordId: string;
  operation: string;
  details?: Record<string, unknown> | null;
  changedData?: Record<string, unknown> | null;
  userId?: string | null;
  timestamp?: string;
};

async function createWorkflowAuditLog(db: Knex, log: AuditLogSeed): Promise<void> {
  const userId = log.userId && log.userId.trim() ? log.userId : null;
  await db.transaction(async (trx) => {
    await trx.raw('select set_config(?, ?, true)', ['app.current_tenant', log.tenantId]);
    if (userId) {
      await trx.raw('select set_config(?, ?, true)', ['app.current_user', userId]);
    }
    await trx('audit_logs').insert({
      audit_id: log.auditId,
      tenant: log.tenantId,
      user_id: userId,
      operation: log.operation,
      table_name: 'workflow_runs',
      record_id: log.recordId,
      changed_data: log.changedData ?? {},
      details: log.details ?? {},
      timestamp: log.timestamp ?? new Date().toISOString()
    });
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

async function openRunDetails(page: Page, runId: string): Promise<void> {
  await openRunsTab(page);
  const viewButton = page.locator(`#workflow-runs-view-${runId}`);
  await viewButton.scrollIntoViewIfNeeded();
  await viewButton.click();
  await page.locator('#workflow-run-detail-id').waitFor({ state: 'visible', timeout: 20_000 });
}

type RunDetailFixtureOptions = {
  includeSnapshot?: boolean;
  includeInvocations?: boolean;
  includeWaits?: boolean;
  includeLogs?: number;
  includeAuditLogs?: number;
  runStatus?: string;
  userId?: string | null;
};

async function seedRunDetailFixture(
  db: Knex,
  tenantId: string,
  options: RunDetailFixtureOptions = {}
) {
  const workflow = await createWorkflowDefinition(db, `Run Detail ${uuidv4().slice(0, 6)}`, 1, RUN_DETAIL_STEPS);
  const runId = uuidv4();
  const baseTime = new Date('2025-02-01T10:00:00Z').toISOString();
  await createWorkflowRun(db, {
    runId,
    workflowId: workflow.workflowId,
    version: 1,
    status: options.runStatus ?? 'RUNNING',
    startedAt: baseTime,
    tenantId
  });

  const stepRuntimeIds = {
    ifBlock: uuidv4(),
    thenStep: uuidv4(),
    elseStep: uuidv4(),
    returnStep: uuidv4()
  };

  await createWorkflowRunStep(db, {
    runId,
    stepId: stepRuntimeIds.ifBlock,
    stepPath: RUN_DETAIL_PATHS.ifBlock,
    definitionStepId: RUN_DETAIL_STEP_IDS.ifBlock,
    status: 'SUCCEEDED',
    attempt: 1,
    startedAt: new Date('2025-02-01T10:00:10Z').toISOString(),
    completedAt: new Date('2025-02-01T10:00:11Z').toISOString(),
    durationMs: 1000
  });
  await createWorkflowRunStep(db, {
    runId,
    stepId: stepRuntimeIds.thenStep,
    stepPath: RUN_DETAIL_PATHS.thenStep,
    definitionStepId: RUN_DETAIL_STEP_IDS.thenStep,
    status: 'FAILED',
    attempt: 1,
    startedAt: new Date('2025-02-01T10:00:12Z').toISOString(),
    completedAt: new Date('2025-02-01T10:00:13Z').toISOString(),
    durationMs: 1500,
    errorJson: { message: 'Step failed', category: 'Runtime', at: '2025-02-01T10:00:13Z' }
  });
  await createWorkflowRunStep(db, {
    runId,
    stepId: stepRuntimeIds.elseStep,
    stepPath: RUN_DETAIL_PATHS.elseStep,
    definitionStepId: RUN_DETAIL_STEP_IDS.elseStep,
    status: 'STARTED',
    attempt: 2,
    startedAt: new Date('2025-02-01T10:00:14Z').toISOString(),
    durationMs: 500
  });
  await createWorkflowRunStep(db, {
    runId,
    stepId: stepRuntimeIds.returnStep,
    stepPath: RUN_DETAIL_PATHS.returnStep,
    definitionStepId: RUN_DETAIL_STEP_IDS.returnStep,
    status: 'CANCELED',
    attempt: 1,
    startedAt: new Date('2025-02-01T10:00:15Z').toISOString(),
    completedAt: new Date('2025-02-01T10:00:16Z').toISOString(),
    durationMs: 800
  });

  if (options.includeWaits) {
    await createWorkflowRunWait(db, {
      waitId: uuidv4(),
      runId,
      stepPath: RUN_DETAIL_PATHS.thenStep,
      waitType: 'event',
      status: 'WAITING',
      eventName: 'WAIT_FOR_EVENT',
      key: 'wait-key-1',
      timeoutAt: new Date('2025-02-01T10:05:00Z').toISOString()
    });
  }

  if (options.includeSnapshot) {
    await createWorkflowRunSnapshot(db, {
      snapshotId: uuidv4(),
      runId,
      stepPath: RUN_DETAIL_PATHS.thenStep,
      envelopeJson: {
        payload: { subject: 'Hello', apiKey: 'secret-key' },
        vars: { count: 3, token: 'secret-token' },
        meta: { state: 'RUNNING', redactions: ['payload.apiKey'] },
        error: { message: 'boom' }
      },
      createdAt: new Date('2025-02-01T10:00:20Z').toISOString()
    });
  }

  if (options.includeInvocations) {
    await createWorkflowActionInvocation(db, {
      invocationId: uuidv4(),
      runId,
      stepPath: RUN_DETAIL_PATHS.thenStep,
      actionId: 'test.action',
      actionVersion: 1,
      status: 'FAILED',
      attempt: 1,
      inputJson: { invocationSecret: 'secret-key', nested: { password: 'secret' } },
      outputJson: { ok: false, outputSecret: 'secret-token' },
      errorMessage: 'Invocation failed',
      startedAt: new Date('2025-02-01T10:00:21Z').toISOString(),
      completedAt: new Date('2025-02-01T10:00:22Z').toISOString()
    });
  }

  if (options.includeLogs) {
    const base = new Date('2025-02-01T10:10:00Z').getTime();
    for (let i = 0; i < options.includeLogs; i += 1) {
      await createWorkflowRunLog(db, {
        logId: uuidv4(),
        runId,
        tenantId,
        level: i % 2 === 0 ? 'INFO' : 'ERROR',
        message: i % 2 === 0 ? `Info log ${i}` : `Error log ${i}`,
        stepPath: i % 2 === 0 ? RUN_DETAIL_PATHS.ifBlock : RUN_DETAIL_PATHS.thenStep,
        contextJson: { seq: i },
        createdAt: new Date(base + i * 1000).toISOString()
      });
    }
  }

  if (options.includeAuditLogs) {
    const base = new Date('2025-02-01T11:00:00Z').getTime();
    for (let i = 0; i < options.includeAuditLogs; i += 1) {
      await createWorkflowAuditLog(db, {
        auditId: uuidv4(),
        tenantId,
        recordId: runId,
        operation: `workflow_run_action_${i}`,
        details: { reason: `Reason ${i}` },
        changedData: { status: 'RUNNING' },
        userId: options.userId ?? null,
        timestamp: new Date(base + i * 1000).toISOString()
      });
    }
  }

  return { workflow, runId, stepRuntimeIds };
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

  test('run details shows run error card when run failed', async ({ page }) => {
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
      const workflow = await createWorkflowDefinition(db, `Runs Error ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'FAILED',
        startedAt: new Date('2025-01-19T10:00:00Z').toISOString(),
        completedAt: new Date('2025-01-19T10:02:00Z').toISOString(),
        tenantId,
        errorJson: {
          message: 'Failure in workflow execution',
          category: 'Runtime',
          at: '2025-01-19T10:02:00Z',
        },
      });

      await openRunDetails(page, runId);
      await expect(page.getByText('Failure in workflow execution')).toBeVisible();
      await expect(page.getByText('Runtime')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('run details export downloads run detail bundle', async ({ page }) => {
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
      const workflow = await createWorkflowDefinition(db, `Runs Export ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'RUNNING',
        startedAt: new Date('2025-01-20T10:00:00Z').toISOString(),
        tenantId,
      });

      await openRunDetails(page, runId);
      const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
      await page.locator('#workflow-run-export').click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(`workflow-run-${runId}.json`);
      await expect(page.getByText('Run export ready')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('admin resume action prompts for reason and submits resume', async ({ page }) => {
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
        startedAt: new Date('2025-01-21T10:00:00Z').toISOString(),
        tenantId,
      });
      await createWaitKey(db, runId, `wait-${uuidv4().slice(0, 6)}`);

      await openRunDetails(page, runId);
      await page.locator('#workflow-run-resume').click();
      await page.locator('#workflow-run-resume-reason').fill('Resume run');
      await page.locator('#workflow-run-resume-confirm-confirm').click();
      await expect(page.getByText('Run resumed')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('admin cancel action prompts for reason and submits cancel', async ({ page }) => {
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
        startedAt: new Date('2025-01-22T10:00:00Z').toISOString(),
        tenantId,
      });

      await openRunDetails(page, runId);
      await page.locator('#workflow-run-cancel').click();
      await page.locator('#workflow-run-cancel-reason').fill('Cancel run');
      await page.locator('#workflow-run-cancel-confirm-confirm').click();
      await expect(page.getByText('Run canceled')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('admin retry action prompts for reason and submits retry', async ({ page }) => {
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
      const workflow = await createWorkflowDefinition(db, `Runs Retry ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'FAILED',
        startedAt: new Date('2025-01-23T10:00:00Z').toISOString(),
        completedAt: new Date('2025-01-23T10:02:00Z').toISOString(),
        tenantId,
      });
      await createWorkflowRunStep(db, {
        runId,
        stepId: uuidv4(),
        stepPath: 'root.steps[0]',
        definitionStepId: 'step-1',
        status: 'FAILED',
        attempt: 1,
        startedAt: new Date('2025-01-23T10:01:00Z').toISOString(),
        completedAt: new Date('2025-01-23T10:02:00Z').toISOString(),
        errorJson: { message: 'Step failed' },
      });

      await openRunDetails(page, runId);
      await page.locator('#workflow-run-retry').click();
      await page.locator('#workflow-run-retry-reason').fill('Retry run');
      await page.locator('#workflow-run-retry-confirm-confirm').click();
      await expect(page.getByText('Run retry started')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('admin replay action prompts for reason and accepts payload override', async ({ page }) => {
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
      const workflow = await createWorkflowDefinition(db, `Runs Replay ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'SUCCEEDED',
        startedAt: new Date('2025-01-24T10:00:00Z').toISOString(),
        completedAt: new Date('2025-01-24T10:02:00Z').toISOString(),
        tenantId,
      });

      await openRunDetails(page, runId);
      await page.locator('#workflow-run-replay').click();
      await page.locator('#workflow-run-replay-reason').fill('Replay run');
      await page.locator('#workflow-run-replay-payload').fill('{"ticketId":123}');
      await page.locator('#workflow-run-replay-confirm-confirm').click();
      await expect(page.getByText('Run replay started')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('admin requeue action prompts for reason and submits requeue', async ({ page }) => {
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
      const workflow = await createWorkflowDefinition(db, `Runs Requeue ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'FAILED',
        startedAt: new Date('2025-01-25T10:00:00Z').toISOString(),
        completedAt: new Date('2025-01-25T10:02:00Z').toISOString(),
        tenantId,
      });
      await createWaitKey(db, runId, `wait-${uuidv4().slice(0, 6)}`, 'event');

      await openRunDetails(page, runId);
      await page.locator('#workflow-run-requeue').click();
      await page.locator('#workflow-run-requeue-reason').fill('Requeue wait');
      await page.locator('#workflow-run-requeue-confirm-confirm').click();
      await expect(page.getByText('Event wait requeued')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});

test.describe('Workflow Designer UI - run details panel', () => {
  test('step timeline filter by status narrows visible steps', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Run Details ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const { runId } = await seedRunDetailFixture(db, tenantId, { includeSnapshot: true });
      await openRunDetails(page, runId);
      await selectFromCustomSelect(page, 'workflow-run-step-status-filter', 'Failed');
      const stepTable = page.locator('table').filter({
        has: page.getByRole('columnheader', { name: 'Step Path' })
      });
      await expect(stepTable.getByRole('cell', { name: RUN_DETAIL_PATHS.thenStep, exact: true })).toBeVisible();
      await expect(stepTable.getByRole('cell', { name: RUN_DETAIL_PATHS.ifBlock, exact: true })).toHaveCount(0);
      await expect(stepTable.getByRole('cell', { name: RUN_DETAIL_PATHS.returnStep, exact: true })).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('step timeline filter by node type narrows visible steps', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Run Details ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const { runId } = await seedRunDetailFixture(db, tenantId, { includeSnapshot: true });
      await openRunDetails(page, runId);
      await selectFromCustomSelect(page, 'workflow-run-step-type-filter', 'core.setState');
      const stepTable = page.locator('table').filter({
        has: page.getByRole('columnheader', { name: 'Step Path' })
      });
      await expect(stepTable.getByRole('cell', { name: RUN_DETAIL_PATHS.thenStep, exact: true })).toBeVisible();
      await expect(stepTable.getByRole('cell', { name: RUN_DETAIL_PATHS.ifBlock, exact: true })).toHaveCount(0);
      await expect(stepTable.getByRole('cell', { name: RUN_DETAIL_PATHS.elseStep, exact: true })).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('collapse nested blocks hides nested step rows', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Run Details ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const { runId } = await seedRunDetailFixture(db, tenantId, { includeSnapshot: true });
      await openRunDetails(page, runId);
      await page.locator('#workflow-run-collapse-nested').click();
      const stepTable = page.locator('table').filter({
        has: page.getByRole('columnheader', { name: 'Step Path' })
      });
      await expect(stepTable.getByRole('cell', { name: RUN_DETAIL_PATHS.thenStep, exact: true })).toHaveCount(0);
      await expect(stepTable.getByRole('cell', { name: RUN_DETAIL_PATHS.elseStep, exact: true })).toHaveCount(0);
      await expect(stepTable.getByRole('cell', { name: RUN_DETAIL_PATHS.ifBlock, exact: true })).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('step timeline view button selects step and shows details', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Run Details ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const { runId, stepRuntimeIds } = await seedRunDetailFixture(db, tenantId, { includeSnapshot: true });
      await openRunDetails(page, runId);
      await page.locator(`#workflow-run-step-${stepRuntimeIds.thenStep}`).click();
      const detailsCard = page.getByText('Step Details').locator('..').locator('..');
      await expect(detailsCard.getByText(RUN_DETAIL_PATHS.thenStep)).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('step details show attempt, duration, and definition step id', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Run Details ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const { runId, stepRuntimeIds } = await seedRunDetailFixture(db, tenantId, { includeSnapshot: true });
      await openRunDetails(page, runId);
      await page.locator(`#workflow-run-step-${stepRuntimeIds.thenStep}`).click();
      const detailsCard = page.getByText('Step Details').locator('..').locator('..');
      await expect(detailsCard.getByText('Attempt')).toBeVisible();
      const attemptField = detailsCard.getByText('Attempt', { exact: true }).locator('..');
      await expect(attemptField).toContainText('1');
      const durationField = detailsCard.getByText('Duration', { exact: true }).locator('..');
      await expect(durationField).toContainText('1.5s');
      const definitionField = detailsCard.getByText('Definition Step ID', { exact: true }).locator('..');
      await expect(definitionField.getByText(RUN_DETAIL_STEP_IDS.thenStep, { exact: true })).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('step error card shown when selected step has error', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Run Details ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const { runId, stepRuntimeIds } = await seedRunDetailFixture(db, tenantId, { includeSnapshot: true });
      await openRunDetails(page, runId);
      await page.locator(`#workflow-run-step-${stepRuntimeIds.thenStep}`).click();
      const detailsCard = page.getByText('Step Details').locator('..').locator('..');
      await expect(detailsCard.getByText('Step failed', { exact: true })).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('step wait history renders event and timeout details', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Run Details ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const { runId, stepRuntimeIds } = await seedRunDetailFixture(db, tenantId, {
        includeSnapshot: true,
        includeWaits: true
      });
      await openRunDetails(page, runId);
      await page.locator(`#workflow-run-step-${stepRuntimeIds.thenStep}`).click();
      await expect(page.getByText('Wait History')).toBeVisible();
      await expect(page.getByText('WAIT_FOR_EVENT')).toBeVisible();
      await expect(page.getByText('Key: wait-key-1')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('envelope tabs switch between payload, vars, meta, error, raw', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Run Details ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const { runId, stepRuntimeIds } = await seedRunDetailFixture(db, tenantId, { includeSnapshot: true });
      await openRunDetails(page, runId);
      await page.locator(`#workflow-run-step-${stepRuntimeIds.thenStep}`).click();

      await page.getByRole('tab', { name: 'Payload' }).click();
      await expect(page.getByText('"subject": "Hello"')).toBeVisible();

      await page.getByRole('tab', { name: 'Vars' }).click();
      await expect(page.getByText('"count": 3')).toBeVisible();

      await page.getByRole('tab', { name: 'Meta' }).click();
      await expect(page.getByText('"state": "RUNNING"')).toBeVisible();

      await page.getByRole('tab', { name: 'Error' }).click();
      await expect(page.getByText('"message": "boom"')).toBeVisible();

      await page.getByRole('tab', { name: 'Raw' }).click();
      await expect(page.getByText('"payload"')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('envelope view shows redaction notice when values masked', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Run Details ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const { runId, stepRuntimeIds } = await seedRunDetailFixture(db, tenantId, { includeSnapshot: true });
      await openRunDetails(page, runId);
      await page.locator(`#workflow-run-step-${stepRuntimeIds.thenStep}`).click();
      const detailsCard = page.getByText('Step Details').locator('..').locator('..');
      const envelopeSection = detailsCard.getByText('Envelope Data', { exact: true }).locator('..');
      await expect(envelopeSection.getByText('Redacted values shown as ***.', { exact: true })).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('envelope view shows empty-state when no snapshot available', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Run Details ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const { runId, stepRuntimeIds } = await seedRunDetailFixture(db, tenantId, { includeSnapshot: false });
      await openRunDetails(page, runId);
      await page.locator(`#workflow-run-step-${stepRuntimeIds.thenStep}`).click();
      await expect(page.getByText('No snapshot available.')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('action invocations list renders inputs/outputs with redaction markers', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Run Details ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const { runId, stepRuntimeIds } = await seedRunDetailFixture(db, tenantId, {
        includeSnapshot: true,
        includeInvocations: true
      });
      await openRunDetails(page, runId);
      await page.locator(`#workflow-run-step-${stepRuntimeIds.thenStep}`).click();
      await expect(page.getByText('test.action@1')).toBeVisible();
      await expect(page.getByText('"invocationSecret": "***"')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('action invocations empty state shown when none recorded', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Run Details ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const { runId, stepRuntimeIds } = await seedRunDetailFixture(db, tenantId, { includeSnapshot: true });
      await openRunDetails(page, runId);
      await page.locator(`#workflow-run-step-${stepRuntimeIds.thenStep}`).click();
      await expect(page.getByText('No action calls recorded for this step.')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('run logs tab filters by search and level', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Run Details ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const { runId } = await seedRunDetailFixture(db, tenantId, { includeLogs: 4 });
      await openRunDetails(page, runId);
      await page.locator('#workflow-run-logs-search').fill('Error log 1');
      await selectFromCustomSelect(page, 'workflow-run-logs-level', 'Error');
      await page.locator('#workflow-run-logs-apply').click();
      const logsTable = page.locator('table').filter({
        has: page.getByRole('columnheader', { name: 'Correlation' })
      });
      await expect(logsTable.getByText('Error log 1')).toBeVisible();
      await expect(logsTable.getByText('Info log 0')).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('run logs export downloads log CSV', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Run Details ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const { runId } = await seedRunDetailFixture(db, tenantId, { includeLogs: 2 });
      await openRunDetails(page, runId);
      const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
      await page.locator('#workflow-run-logs-export').click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(`workflow-run-${runId}-logs.csv`);
      await expect(page.getByText('Log export ready')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('run logs load more appends additional entries', async ({ page }) => {
    test.setTimeout(240000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Run Details ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const { runId } = await seedRunDetailFixture(db, tenantId, { includeLogs: 55 });
      await openRunDetails(page, runId);
      const logsTable = page.locator('table').filter({
        has: page.getByRole('columnheader', { name: 'Correlation' })
      });
      const loadMore = page.locator('#workflow-run-logs-load-more');
      await loadMore.scrollIntoViewIfNeeded();
      await expect(loadMore).toBeVisible();
      const initialCount = await logsTable.locator('tbody tr').count();
      await loadMore.click();
      await expect
        .poll(() => logsTable.locator('tbody tr').count(), { timeout: 10_000 })
        .toBeGreaterThan(initialCount);
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('run logs empty state shown when no logs available', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Run Details ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const { runId } = await seedRunDetailFixture(db, tenantId);
      await openRunDetails(page, runId);
      await expect(page.getByText('No log entries found.')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('run audit logs tab loads entries and supports export', async ({ page }) => {
    test.setTimeout(240000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Run Details ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const { runId } = await seedRunDetailFixture(db, tenantId, {
        includeAuditLogs: 2,
        userId: tenantData.adminUser.userId
      });
      await openRunDetails(page, runId);
      const auditTable = page.locator('table').filter({
        has: page.getByRole('columnheader', { name: 'Operation' })
      });
      await expect(auditTable.getByText('workflow_run_action_0')).toBeVisible();
      const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
      await page.locator('#workflow-run-audit-export').click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(`workflow-run-${runId}-audit.csv`);
      await expect(page.getByText('Audit export ready')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('run audit logs load more appends additional entries', async ({ page }) => {
    test.setTimeout(240000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Run Details ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const { runId } = await seedRunDetailFixture(db, tenantId, {
        includeAuditLogs: 30,
        userId: tenantData.adminUser.userId
      });
      await openRunDetails(page, runId);
      const auditTable = page.locator('table').filter({
        has: page.getByRole('columnheader', { name: 'Operation' })
      });
      const loadMore = page.locator('#workflow-run-audit-load-more');
      await loadMore.scrollIntoViewIfNeeded();
      await expect(loadMore).toBeVisible();
      const initialCount = await auditTable.locator('tbody tr').count();
      await loadMore.click();
      await expect
        .poll(() => auditTable.locator('tbody tr').count(), { timeout: 10_000 })
        .toBeGreaterThan(initialCount);
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('run audit logs empty state shown when no entries available', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Run Details ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      const { runId } = await seedRunDetailFixture(db, tenantId);
      await openRunDetails(page, runId);
      await expect(page.getByText('No audit entries yet.')).toBeVisible();
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});

test.describe('Workflow Designer UI - error handling', () => {
  test('run list fetch error shows toast and preserves filters', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Run Error ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;

    try {
      await openRunsTab(page);
      await page.locator('#workflow-runs-version').fill('0');
      await page.locator('#workflow-runs-apply').click();
      await expect(page.getByText(/Failed to load workflow runs|greater than 0|Expected number/i)).toBeVisible();
      await expect(page.locator('#workflow-runs-version')).toHaveValue('0');
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('run details fetch error shows toast and closes details panel', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Run Error ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    const runId = uuidv4();

    try {
      const workflow = await createWorkflowDefinition(db, `Runs Error ${uuidv4().slice(0, 6)}`);
      await createWorkflowRun(db, {
        runId,
        workflowId: workflow.workflowId,
        version: 1,
        status: 'RUNNING',
        startedAt: new Date('2025-02-02T10:00:00Z').toISOString(),
        tenantId,
      });

      await openRunsTab(page);
      await db('workflow_runs').where({ run_id: runId }).del();
      const viewButton = page.locator(`#workflow-runs-view-${runId}`);
      await viewButton.scrollIntoViewIfNeeded();
      await viewButton.click();
      await expect(page.getByText(/Failed to load run details|Not found|Internal Server Error/i)).toBeVisible();
      await expect(page.locator('#workflow-run-detail-id')).toHaveCount(0);
    } finally {
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});
