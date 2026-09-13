import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Worker } from '@temporalio/worker';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { getAdminConnection, destroyAdminConnection } from '@alga-psa/db/admin';
import { tenantDb } from '@alga-psa/db';
import { verifyPassword } from '@alga-psa/core/encryption';
import * as activities from '../../activities';
import { rollbackTenantInDB } from '../../db/tenant-operations';
import type { TenantCreationInput, TenantCreationResult } from '../../types/workflow-types';

vi.hoisted(() => {
  vi.stubEnv('EMAIL_PROVIDER', 'mock');
  vi.stubEnv('NEXTAUTH_SECRET', 'tenant-workflow-isolated-test-secret');
});

it('creates a tenant and admin through the real workflow and persists their records', async () => {
  if (process.env.TEMPORAL_TENANT_E2E_ISOLATED !== 'true') {
    throw new Error('Tenant creation E2E requires an explicitly isolated database');
  }
  const tenantId = randomUUID();
  const taskQueue = `tenant-creation-${randomUUID()}`;
  const db = await getAdminConnection();
  let environment: TestWorkflowEnvironment | undefined;
  const input: TenantCreationInput = {
    tenantId, tenantName: `E2E Tenant ${tenantId}`, clientName: `E2E Client ${tenantId}`,
    companyName: `E2E Company ${tenantId}`,
    adminUser: { firstName: 'John', lastName: 'Admin', email: `admin-${tenantId}@example.test` },
  };
  try {
    environment = await TestWorkflowEnvironment.createTimeSkipping();
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue,
      workflowsPath: path.resolve(import.meta.dirname, '../../workflows/tenant-creation-workflow.ts'), activities,
    });
    await worker.runUntil(async () => {
      const result = await environment!.client.workflow.execute('tenantCreationWorkflow', {
        taskQueue, workflowId: randomUUID(), args: [input], workflowExecutionTimeout: '2m',
      }) as TenantCreationResult;
      expect(result.success).toBe(true);
      expect(result.tenantId).toBe(tenantId);
      expect(result.adminUserId).toBeTruthy();
      expect(result.clientId).toBeTruthy();
      expect(result.temporaryPassword).toBeTruthy();
      expect(result.createdAt).toBeTruthy();
      const scoped = tenantDb(db, tenantId);
      expect(await scoped.table('tenants').first()).toMatchObject({ client_name: input.companyName });
      const admin = await scoped.table('users').where({ user_id: result.adminUserId }).first();
      expect(admin).toMatchObject({
        first_name: input.adminUser.firstName, email: input.adminUser.email,
      });
      expect(await verifyPassword(result.temporaryPassword!, admin.hashed_password)).toBe(true);
      expect(await scoped.table('clients').where({ client_id: result.clientId }).first()).toMatchObject({
        client_name: input.clientName,
      });
      expect(await scoped.table('user_roles').where({ user_id: result.adminUserId }).first()).toBeTruthy();
    });
  } finally {
    try {
      await environment?.teardown();
    } finally {
      try {
        // Onboarding seeds create records outside the basic tenant rollback.
        const scoped = tenantDb(db, tenantId);
        for (const table of [
          'sla_notification_thresholds', 'sla_policy_targets', 'boards', 'priorities', 'sla_policies',
          'client_tax_rates', 'client_tax_settings', 'client_billing_profiles',
          'tax_components', 'tax_rates', 'tax_regions', 'tenant_workflow_schedule',
          'workflow_definition_versions', 'workflow_definitions', 'asset_type_registry',
          'document_default_folders', 'project_template_checklist_items', 'project_template_tasks',
          'project_template_phases', 'project_template_status_mappings', 'project_templates', 'statuses',
        ]) await scoped.table(table).delete();
        await rollbackTenantInDB(tenantId, { log: { info() {}, error: console.error } });
        expect(await tenantDb(db, tenantId).table('tenants').first()).toBeUndefined();
      } finally {
        await destroyAdminConnection();
        vi.unstubAllEnvs();
      }
    }
  }
});
