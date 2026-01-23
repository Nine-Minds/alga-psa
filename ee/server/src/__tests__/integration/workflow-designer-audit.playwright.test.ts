import { expect, test, type Page } from '@playwright/test';
import type { Knex } from 'knex';
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
};

type WorkflowDefinitionSnapshot = {
  definitions: Array<Record<string, any>>;
  versions: Array<Record<string, any>>;
};

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

async function createWorkflowDefinition(db: Knex, name: string): Promise<WorkflowSeed> {
  const workflowId = uuidv4();
  const now = new Date().toISOString();
  const definition = {
    id: workflowId,
    version: 1,
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
    version: 1,
    definition_json: definition,
    payload_schema_json: null,
    published_by: null,
    published_at: now,
    created_at: now,
    updated_at: now,
  });

  return { workflowId, name };
}

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
      table_name: 'workflow_definitions',
      record_id: log.recordId,
      changed_data: log.changedData ?? {},
      details: log.details ?? {},
      timestamp: log.timestamp ?? new Date().toISOString()
    });
  });
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
  await db('workflow_definition_versions').del();
  if (snapshot.versions.length) {
    await db('workflow_definition_versions').insert(snapshot.versions);
  }
}

async function openAuditTab(page: Page, tenantId: string, workflowName?: string): Promise<void> {
  await page.context().setExtraHTTPHeaders({ 'x-tenant-id': tenantId });

  await page.goto(`${TEST_CONFIG.baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 });

  await page.goto(`${TEST_CONFIG.baseUrl}/msp/workflows`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (workflowName) {
    await page.getByRole('button', { name: workflowName }).click();
  }
  await page.locator('#workflow-designer-tabs-trigger-4').click();
}

test.describe('Workflow Designer UI - audit tab', () => {
  test('audit tab prompts to select workflow when none active', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Audit ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    const snapshot = await snapshotWorkflowDefinitions(db);

    try {
      await db.raw(`
        TRUNCATE
          workflow_run_logs,
          workflow_run_steps,
          workflow_run_waits,
          workflow_action_invocations,
          workflow_run_snapshots,
          workflow_runtime_events,
          workflow_runs,
          workflow_definition_versions,
          workflow_definitions
        RESTART IDENTITY CASCADE;
      `);

      await openAuditTab(page, tenantId);
      await expect(page.getByText('Select a workflow to view audit history.')).toBeVisible();
    } finally {
      await restoreWorkflowDefinitions(db, snapshot).catch(() => undefined);
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('audit tab lists workflow definition audit entries', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Audit ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    let workflow: WorkflowSeed | null = null;

    try {
      workflow = await createWorkflowDefinition(db, `Audit ${uuidv4().slice(0, 6)}`);
      await createWorkflowAuditLog(db, {
        auditId: uuidv4(),
        tenantId,
        recordId: workflow.workflowId,
        operation: 'workflow_definition_update',
        details: { field: 'name' },
        userId: tenantData.adminUser.userId
      });

      await openAuditTab(page, tenantId, workflow.name);
      const table = page.locator('table').filter({
        has: page.getByRole('columnheader', { name: 'Operation' })
      });
      await expect(table.getByText('workflow_definition_update')).toBeVisible();
    } finally {
      if (workflow) {
        await db('workflow_definitions')
          .where({ workflow_id: workflow.workflowId })
          .del()
          .catch(() => undefined);
      }
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('audit tab export CSV triggers download', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Audit ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    let workflow: WorkflowSeed | null = null;

    try {
      workflow = await createWorkflowDefinition(db, `Audit ${uuidv4().slice(0, 6)}`);
      await createWorkflowAuditLog(db, {
        auditId: uuidv4(),
        tenantId,
        recordId: workflow.workflowId,
        operation: 'workflow_definition_export',
        details: { type: 'csv' },
        userId: tenantData.adminUser.userId
      });

      await openAuditTab(page, tenantId, workflow.name);
      const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
      await page.locator('#workflow-audit-export').click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(`workflow-definition-${workflow.workflowId}-audit.csv`);
      await expect(page.getByText('Audit export ready')).toBeVisible();
    } finally {
      if (workflow) {
        await db('workflow_definitions')
          .where({ workflow_id: workflow.workflowId })
          .del()
          .catch(() => undefined);
      }
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('audit tab load more appends additional entries', async ({ page }) => {
    test.setTimeout(240000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Audit ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    let workflow: WorkflowSeed | null = null;

    try {
      workflow = await createWorkflowDefinition(db, `Audit ${uuidv4().slice(0, 6)}`);
      const base = new Date('2025-02-02T12:30:00Z').getTime();
      for (let i = 0; i < 30; i += 1) {
        await createWorkflowAuditLog(db, {
          auditId: uuidv4(),
          tenantId,
          recordId: workflow.workflowId,
          operation: `workflow_definition_op_${i}`,
          details: { seq: i },
          userId: tenantData.adminUser.userId,
          timestamp: new Date(base + i * 1000).toISOString()
        });
      }

      await openAuditTab(page, tenantId, workflow.name);
      const table = page.locator('table').filter({
        has: page.getByRole('columnheader', { name: 'Operation' })
      });
      const rows = table.locator('tbody tr');
      const initialCount = await rows.count();
      const loadMore = page.locator('#workflow-audit-load-more');
      await loadMore.scrollIntoViewIfNeeded();
      await expect(loadMore).toBeVisible();
      await loadMore.click();
      await expect.poll(async () => rows.count()).toBeGreaterThan(initialCount);
    } finally {
      if (workflow) {
        await db('workflow_definitions')
          .where({ workflow_id: workflow.workflowId })
          .del()
          .catch(() => undefined);
      }
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });

  test('audit tab empty state displays when no entries present', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Audit ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    let workflow: WorkflowSeed | null = null;

    try {
      workflow = await createWorkflowDefinition(db, `Audit ${uuidv4().slice(0, 6)}`);
      await openAuditTab(page, tenantId, workflow.name);
      await expect(page.getByText('No audit entries yet.')).toBeVisible();
    } finally {
      if (workflow) {
        await db('workflow_definitions')
          .where({ workflow_id: workflow.workflowId })
          .del()
          .catch(() => undefined);
      }
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});

test.describe('Workflow Designer UI - error handling', () => {
  test('audit log fetch error shows toast', async ({ page }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    const tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Workflow Audit ${uuidv4().slice(0, 6)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: ADMIN_PERMISSIONS,
    });
    const tenantId = tenantData.tenant.tenantId;
    let workflow: WorkflowSeed | null = null;

    try {
      workflow = await createWorkflowDefinition(db, `Audit ${uuidv4().slice(0, 6)}`);
      await openAuditTab(page, tenantId, workflow.name);
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

      await page.locator('#workflow-designer-tabs-trigger-0').click();
      await page.locator('#workflow-designer-tabs-trigger-4').click();
      const errorToast = page.locator('[role="status"]').filter({
        hasText: /Failed to load audit logs|Forbidden|Unauthorized|Internal Server Error|boom/
      });
      await expect.poll(async () => errorToast.count()).toBeGreaterThan(0);
    } finally {
      if (workflow) {
        await db('workflow_definitions')
          .where({ workflow_id: workflow.workflowId })
          .del()
          .catch(() => undefined);
      }
      await rollbackTenant(db, tenantId).catch(() => undefined);
      await db.destroy();
    }
  });
});
