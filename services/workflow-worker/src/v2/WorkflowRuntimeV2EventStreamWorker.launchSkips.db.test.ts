import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import type { Knex } from 'knex';
import { createTenantKnex, getCurrentTenantId } from '@alga-psa/db';
import {
  createWorkflowDefinitionAction,
  publishWorkflowDefinitionAction,
  getWorkflowLaunchSkipSummaryAction
} from '@alga-psa/workflows/actions';
import { getSchemaRegistry, initializeWorkflowRuntimeV2 } from '@alga-psa/workflows/runtime';
import { WorkflowRuntimeV2EventStreamWorker } from './WorkflowRuntimeV2EventStreamWorker.js';
// Connects to the already-migrated disposable schema; never creates, drops or migrates a database.
// Deliberately NOT server/test-utils/dbConfig: importing that would add a workflow-worker -> server
// project edge (server must never depend on workflow-worker, and vice versa, or nx sees a cycle).
import { createWorkspaceTestDbConnection } from '../../../../packages/db/test-utils/workspaceConnection';

// Worker-level acceptance test for alga0002106 (surface per-workflow event launch skips).
//
// Needs a migrated test database; CI runs it in the workspace-db lane (scripts/run-workspace-db-tests.mjs).
// Locally, provision one by running any server DB integration suite with a private name (it
// drops/recreates that DB and leaves it migrated), then run this file against it:
//   cd server && TEST_DB_NAME=<name>_test npx vitest run src/test/integration/workflowRuntimeV2TriggerLaunch.integration.test.ts --coverage.enabled=false
//   cd services/workflow-worker && TEST_DB_NAME=<name>_test DB_PASSWORD_SERVER=<app_user pw> \
//     npx vitest run src/v2/WorkflowRuntimeV2EventStreamWorker.launchSkips.db.test.ts
// Without TEST_DB_NAME the suite is skipped, unless REQUIRE_DB=1, in which case it fails.

const TEST_SCHEMA_REF = 'payload.TestPayload.v1';
const TEST_SOURCE_SCHEMA_REF = 'payload.TestSourcePayload.v1';

// Worker code may not import the auth package root (eslint no-restricted-imports), so the
// mocked getCurrentUser is reached through a hoisted handle instead of an import.
const { startWorkflowRuntimeV2TemporalRunMock, getCurrentUserMock } = vi.hoisted(() => ({
  startWorkflowRuntimeV2TemporalRunMock: vi.fn(),
  getCurrentUserMock: vi.fn()
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(),
    getCurrentTenantId: vi.fn(),
    auditLog: vi.fn().mockResolvedValue(undefined)
  };
});

vi.mock('@alga-psa/auth', () => {
  const user = () => ({ user_id: userId, tenant: tenantId, roles: [] });
  const withAuth = (action: (user: any, ctx: { tenant: string }, ...args: any[]) => Promise<any>) =>
    async (...args: any[]) => action(user(), { tenant: tenantId }, ...args);
  const withOptionalAuth = withAuth;
  const withAuthCheck = (action: (user: any, ...args: any[]) => Promise<any>) =>
    async (...args: any[]) => action(user(), ...args);

  return {
    withAuth,
    withOptionalAuth,
    withAuthCheck,
    AuthenticationError: class AuthenticationError extends Error {},
    hasPermission: vi.fn().mockResolvedValue(true),
    checkMultiplePermissions: vi.fn().mockResolvedValue(true),
    getCurrentUser: getCurrentUserMock,
    preCheckDeletion: vi.fn()
  };
});

// The worker resolves its DB through the shared admin helper; point it at the test database.
vi.mock('@shared/db/admin.js', () => ({
  getAdminConnection: async () => db
}));

vi.mock('@alga-psa/workflows/lib/workflowRuntimeV2Temporal', () => ({
  startWorkflowRuntimeV2TemporalRun: (...args: unknown[]) => startWorkflowRuntimeV2TemporalRunMock(...args)
}));

const mockedCreateTenantKnex = vi.mocked(createTenantKnex);
const mockedGetCurrentTenantId = vi.mocked(getCurrentTenantId);

let db: Knex;
let tenantId: string;
let userId: string;

const dbConfigured = Boolean(process.env.TEST_DB_NAME);
if (!dbConfigured && process.env.REQUIRE_DB === '1') {
  throw new Error('WorkflowRuntimeV2EventStreamWorker.launchSkips.db requires TEST_DB_NAME and DB_PASSWORD_SERVER');
}

function registerTestSchemas(): void {
  initializeWorkflowRuntimeV2();
  const registry = getSchemaRegistry();
  if (!registry.has(TEST_SCHEMA_REF)) {
    registry.register(
      TEST_SCHEMA_REF,
      z.object({
        foo: z.string().optional(),
        bar: z.number().optional(),
        items: z.array(z.any()).optional(),
        email: z.record(z.any()).optional(),
        secretRef: z.string().optional(),
        nested: z.record(z.any()).optional()
      }).passthrough()
    );
  }
  if (!registry.has(TEST_SOURCE_SCHEMA_REF)) {
    registry.register(
      TEST_SOURCE_SCHEMA_REF,
      z.object({ foo: z.string().optional(), bar: z.number().optional() }).passthrough()
    );
  }
}

describe.skipIf(!dbConfigured)('WorkflowRuntimeV2EventStreamWorker launch skips (DB-backed)', () => {
  beforeAll(() => {
    registerTestSchemas();
    db = createWorkspaceTestDbConnection();
  });

  beforeEach(async () => {
    // Each test gets its own tenant; every query below is tenant-scoped, so no shared-table reset is needed.
    tenantId = uuidv4();
    userId = uuidv4();
    mockedCreateTenantKnex.mockResolvedValue({ knex: db, tenant: tenantId });
    mockedGetCurrentTenantId.mockReturnValue(tenantId);
    getCurrentUserMock.mockResolvedValue({ user_id: userId, tenant: tenantId, roles: [] } as any);
    startWorkflowRuntimeV2TemporalRunMock.mockReset();
    startWorkflowRuntimeV2TemporalRunMock.mockResolvedValue({
      workflowId: 'workflow-runtime-v2:run:run-e2e',
      firstExecutionRunId: 'temporal-run-e2e'
    });
    await db('tenants').insert({
      tenant: tenantId,
      client_name: `Workflow E2E ${tenantId}`,
      email: `workflow-e2e+${tenantId}@example.com`,
      created_at: new Date(),
      updated_at: new Date()
    });
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('a published workflow whose schema differs from the event schema (no mapping) is skipped and surfaced as schema_mismatch (alga0002106 acceptance).', async () => {
    const eventName = 'PING_SKIP_MISMATCH';

    // Publish while the catalog schema matches the workflow's, then let the catalog drift to a
    // different schema. That is how a previously healthy workflow starts being declined at runtime:
    // publish-time validation only sees the schema as it was then.
    await db('event_catalog').insert({
      event_id: uuidv4(),
      event_type: eventName,
      name: 'Ping Skip Mismatch',
      description: 'test',
      category: 'Test',
      payload_schema: {},
      payload_schema_ref: TEST_SCHEMA_REF,
      tenant: tenantId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    const created = await createWorkflowDefinitionAction({
      definition: {
        id: uuidv4(),
        version: 1,
        name: 'Test Workflow',
        description: 'Test workflow',
        payloadSchemaRef: TEST_SCHEMA_REF,
        trigger: { type: 'event', eventName },
        steps: [{ id: 'state-1', type: 'state.set', config: { state: 'READY' } } as any]
      }
    });
    const workflowId = created.workflowId;
    const publish = await publishWorkflowDefinitionAction({ workflowId, version: 1 });
    expect(JSON.stringify((publish as any)?.errors ?? [])).toBe('[]');
    expect((publish as any)?.ok).toBe(true);

    await db('event_catalog')
      .where({ tenant: tenantId, event_type: eventName })
      .update({ payload_schema_ref: TEST_SOURCE_SCHEMA_REF });

    const metrics = { recordLaunchSkip: vi.fn(), recordLaunch: vi.fn() };
    const worker = new WorkflowRuntimeV2EventStreamWorker('skip-acceptance', metrics as any);
    const eventId = uuidv4();
    await (worker as any).processEvent({
      event_id: eventId,
      event_name: eventName,
      event_type: eventName,
      tenant: tenantId,
      payload: { foo: 'bar' },
      timestamp: new Date().toISOString()
    });

    expect(startWorkflowRuntimeV2TemporalRunMock).not.toHaveBeenCalled();

    const summary = await getWorkflowLaunchSkipSummaryAction({ workflowId });
    expect(summary.alarming.total).toBe(1);
    expect(summary.alarming.byReason).toEqual([
      expect.objectContaining({ reason: 'schema_mismatch', count: 1 })
    ]);
    expect(summary.intentional.total).toBe(0);

    const row = await db('workflow_event_launch_skips').where({ tenant: tenantId, event_id: eventId }).first();
    expect(row).toMatchObject({ workflow_id: workflowId, reason: 'schema_mismatch', intentional: false, event_name: eventName });
    expect(metrics.recordLaunchSkip).toHaveBeenCalledWith(
      expect.objectContaining({ tenant: tenantId, workflowId, eventName, reason: 'schema_mismatch', intentional: false })
    );

    // The event row keeps the legacy error_message, unchanged.
    const eventRow = await db('workflow_runtime_events').where({ tenant: tenantId, event_id: eventId }).first();
    expect(eventRow?.error_message).toContain('differs from workflow schema');
  });
});
