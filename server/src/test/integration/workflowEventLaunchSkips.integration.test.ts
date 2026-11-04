import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  ensureWorkflowScheduleStateTable,
  resetWorkflowRuntimeTables
} from '../helpers/workflowRuntimeV2TestUtils';
import { createTenantKnex, getCurrentTenantId } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/auth';
import {
  createWorkflowDefinitionAction,
  deleteWorkflowDefinitionAction,
  getWorkflowLaunchSkipSummaryAction,
  listEventLaunchSkipsAction,
  listWorkflowLaunchSkipCountsAction,
  listWorkflowLaunchSkipsPagedAction
} from '@alga-psa/workflows/actions';
import WorkflowEventLaunchSkipModelV2 from '@alga-psa/workflows/persistence/workflowEventLaunchSkipModelV2';
import {
  ensureWorkflowRuntimeV2TestRegistrations,
  buildWorkflowDefinition,
  stateSetStep
} from '../helpers/workflowRuntimeV2TestHelpers';

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
  const withAuth = (action: (user: any, ctx: { tenant: string }, ...args: any[]) => Promise<any>) =>
    async (...args: any[]) => action(
      { user_id: userId, tenant: tenantId, roles: [] },
      { tenant: tenantId },
      ...args
    );
  const passthrough = (action: (user: any, ...args: any[]) => Promise<any>) =>
    async (...args: any[]) => action({ user_id: userId, tenant: tenantId, roles: [] }, ...args);
  return {
    withAuth,
    withOptionalAuth: withAuth,
    withAuthCheck: passthrough,
    AuthenticationError: class AuthenticationError extends Error {},
    hasPermission: vi.fn().mockResolvedValue(true),
    checkMultiplePermissions: vi.fn().mockResolvedValue(true),
    getCurrentUser: vi.fn(),
    preCheckDeletion: vi.fn().mockResolvedValue({ canDelete: true, dependencies: [], alternatives: [] })
  };
});

const requireFromHere = createRequire(import.meta.url);
const migration = requireFromHere(
  path.resolve(__dirname, '../../../migrations/20261010120000_create_workflow_event_launch_skips.cjs')
) as { up: (knex: Knex) => Promise<void>; down: (knex: Knex) => Promise<void> };

const TABLE = 'workflow_event_launch_skips';
const DAY = 24 * 60 * 60 * 1000;

let db: Knex;
let tenantId: string;
let userId: string;

const mockedCreateTenantKnex = vi.mocked(createTenantKnex);
const mockedGetCurrentTenantId = vi.mocked(getCurrentTenantId);
const mockedGetCurrentUser = vi.mocked(getCurrentUser);

const useTenant = (tenant: string) => {
  tenantId = tenant;
  mockedCreateTenantKnex.mockResolvedValue({ knex: db, tenant });
  mockedGetCurrentTenantId.mockReturnValue(tenant);
  mockedGetCurrentUser.mockResolvedValue({ user_id: userId, tenant, roles: [] } as any);
};

const skipRow = (overrides: Record<string, unknown> = {}) => ({
  tenant: tenantId,
  event_id: uuidv4(),
  workflow_id: uuidv4(),
  workflow_version: 1,
  event_name: 'TICKET_CREATED',
  reason: 'schema_mismatch',
  intentional: false,
  message: 'Skipped: schema mismatch',
  details: { workflowPayloadSchemaRef: 'a', sourcePayloadSchemaRef: 'b' },
  ...overrides
});

const insertAt = async (rows: Array<ReturnType<typeof skipRow> & { created_at?: string }>) => {
  await WorkflowEventLaunchSkipModelV2.insertMany(db, tenantId, rows as any);
};

beforeAll(async () => {
  ensureWorkflowRuntimeV2TestRegistrations();
  db = await createTestDbConnection();
  await ensureWorkflowScheduleStateTable(db);
});

beforeEach(async () => {
  await ensureWorkflowScheduleStateTable(db);
  await resetWorkflowRuntimeTables(db);
  userId = uuidv4();
  useTenant(uuidv4());
});

afterAll(async () => {
  await db?.destroy();
});

describe('workflow_event_launch_skips migration', () => {
  it('creates the table with the expected key constraints and rejects unknown reasons; down drops it; up is re-runnable', async () => {
    expect(await db.schema.hasTable(TABLE)).toBe(true);

    await expect(insertAt([skipRow({ reason: 'not_a_reason' })])).rejects.toThrow(/reason_check|check constraint/i);

    const eventId = uuidv4();
    const workflowId = uuidv4();
    await insertAt([skipRow({ event_id: eventId, workflow_id: workflowId })]);
    // Unique (tenant, event_id, workflow_id): a raw duplicate violates it.
    await expect(
      db(TABLE).insert({ ...skipRow({ event_id: eventId, workflow_id: workflowId }), details: null })
    ).rejects.toThrow(/duplicate key|unique/i);

    await migration.down(db);
    expect(await db.schema.hasTable(TABLE)).toBe(false);
    await migration.down(db); // idempotent

    await migration.up(db);
    expect(await db.schema.hasTable(TABLE)).toBe(true);
    await migration.up(db); // IF NOT EXISTS: safe to re-run
    expect(await db.schema.hasTable(TABLE)).toBe(true);
  });
});

describe('WorkflowEventLaunchSkipModelV2.insertMany', () => {
  it('is idempotent per (tenant, event, workflow): redelivery does not double count', async () => {
    const eventId = uuidv4();
    const workflowId = uuidv4();
    const row = skipRow({ event_id: eventId, workflow_id: workflowId });
    await insertAt([row]);
    await insertAt([{ ...row, message: 'changed on redelivery' }]);

    const rows = await db(TABLE).where({ tenant: tenantId, event_id: eventId, workflow_id: workflowId });
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBe('Skipped: schema mismatch');
    expect(rows[0].details).toEqual({ workflowPayloadSchemaRef: 'a', sourcePayloadSchemaRef: 'b' });
  });

  it('records one row per workflow for the same event (partial skips) and accepts an empty list', async () => {
    const eventId = uuidv4();
    await insertAt([]);
    await insertAt([
      skipRow({ event_id: eventId, workflow_id: uuidv4(), reason: 'schema_mismatch' }),
      skipRow({ event_id: eventId, workflow_id: uuidv4(), reason: 'paused', intentional: true })
    ]);
    expect(await db(TABLE).where({ tenant: tenantId, event_id: eventId })).toHaveLength(2);
  });
});

describe('launch skip server actions', () => {
  it('summary: splits alarming from intentional, honours the window, and isolates tenants', async () => {
    const workflowId = uuidv4();
    const now = Date.now();
    await insertAt([
      skipRow({ workflow_id: workflowId, reason: 'schema_mismatch' }),
      skipRow({ workflow_id: workflowId, reason: 'schema_mismatch' }),
      skipRow({ workflow_id: workflowId, reason: 'launch_failed' }),
      skipRow({ workflow_id: workflowId, reason: 'paused', intentional: true }),
      skipRow({ workflow_id: workflowId, reason: 'lineage_loop_guard', intentional: true }),
      { ...skipRow({ workflow_id: workflowId, reason: 'schema_mismatch' }), created_at: new Date(now - 10 * DAY).toISOString() }
    ]);

    const otherTenant = uuidv4();
    useTenant(otherTenant);
    await insertAt([skipRow({ tenant: otherTenant, workflow_id: workflowId, reason: 'launch_failed' })]);

    // Other tenant sees only its own row for the same workflow id.
    const other = await getWorkflowLaunchSkipSummaryAction({ workflowId });
    expect(other.alarming.total).toBe(1);
    expect(other.intentional.total).toBe(0);

    const tenantA = (await db(TABLE).where({ workflow_id: workflowId }).whereNot({ tenant: otherTenant }).first()).tenant;
    useTenant(tenantA);

    const week = await getWorkflowLaunchSkipSummaryAction({ workflowId, from: new Date(now - 7 * DAY).toISOString() });
    expect(week.alarming.total).toBe(3);
    expect(week.alarming.byReason.map((r) => [r.reason, r.count])).toEqual([
      ['schema_mismatch', 2],
      ['launch_failed', 1]
    ]);
    expect(week.intentional.total).toBe(2);
    expect(week.intentional.byReason.map((r) => r.reason).sort()).toEqual(['lineage_loop_guard', 'paused']);
    expect(week.alarming.lastSkippedAt).toBeTruthy();

    const month = await getWorkflowLaunchSkipSummaryAction({ workflowId, from: new Date(now - 30 * DAY).toISOString() });
    expect(month.alarming.total).toBe(4);

    const day = await getWorkflowLaunchSkipSummaryAction({ workflowId, from: new Date(now - DAY / 2).toISOString() });
    expect(day.alarming.total).toBe(3);
  });

  it('summary: defaults to the last 7 days when no window is given', async () => {
    const workflowId = uuidv4();
    await insertAt([
      skipRow({ workflow_id: workflowId }),
      { ...skipRow({ workflow_id: workflowId }), created_at: new Date(Date.now() - 8 * DAY).toISOString() }
    ]);
    const summary = await getWorkflowLaunchSkipSummaryAction({ workflowId });
    expect(summary.alarming.total).toBe(1);
  });

  it('paged list: filters by intentional and reason, pages server-side newest first, resolves display names', async () => {
    const workflowId = uuidv4();
    const now = Date.now();
    await db('tenants').insert({
      tenant: tenantId,
      client_name: `Skips ${tenantId}`,
      email: `skips+${tenantId}@example.com`,
      created_at: new Date(),
      updated_at: new Date()
    });
    await db('event_catalog').insert({
      event_id: uuidv4(),
      event_type: 'TICKET_CREATED',
      name: 'Ticket created (display)',
      description: 'test',
      category: 'Test',
      payload_schema: {},
      tenant: tenantId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    const rows = Array.from({ length: 5 }, (_, i) => ({
      ...skipRow({ workflow_id: workflowId, message: `m${i}` }),
      created_at: new Date(now - (i + 1) * 60_000).toISOString()
    }));
    await insertAt([
      ...rows,
      skipRow({ workflow_id: workflowId, reason: 'launch_failed', message: 'lf' }),
      skipRow({ workflow_id: workflowId, reason: 'paused', intentional: true, message: 'paused' })
    ]);

    const page1 = await listWorkflowLaunchSkipsPagedAction({ workflowId, intentional: false, page: 1, pageSize: 4 });
    expect(page1.totalItems).toBe(6);
    expect(page1.items).toHaveLength(4);
    expect(page1.items[0].message).toBe('lf'); // newest
    expect(page1.items[0].eventDisplayName).toBe('Ticket created (display)');

    const page2 = await listWorkflowLaunchSkipsPagedAction({ workflowId, intentional: false, page: 2, pageSize: 4 });
    expect(page2.items).toHaveLength(2);
    const seen = new Set([...page1.items, ...page2.items].map((i) => i.skipId));
    expect(seen.size).toBe(6);

    const mismatch = await listWorkflowLaunchSkipsPagedAction({ workflowId, reason: 'schema_mismatch', page: 1, pageSize: 25 });
    expect(mismatch.totalItems).toBe(5);

    const intentional = await listWorkflowLaunchSkipsPagedAction({ workflowId, intentional: true, page: 1, pageSize: 25 });
    expect(intentional.items.map((i) => i.reason)).toEqual(['paused']);
    expect(intentional.items.every((i) => i.intentional)).toBe(true);
  });

  it('paged list: another tenant cannot read this tenant\'s skips', async () => {
    const workflowId = uuidv4();
    await insertAt([skipRow({ workflow_id: workflowId })]);
    useTenant(uuidv4());
    const result = await listWorkflowLaunchSkipsPagedAction({ workflowId, page: 1, pageSize: 25 });
    expect(result).toEqual({ items: [], totalItems: 0 });
  });

  it('counts: returns alarming-only counts per workflow for the window, empty input is empty', async () => {
    const [a, b, c] = [uuidv4(), uuidv4(), uuidv4()];
    await insertAt([
      skipRow({ workflow_id: a }),
      skipRow({ workflow_id: a, reason: 'launch_failed' }),
      skipRow({ workflow_id: b, reason: 'paused', intentional: true }),
      { ...skipRow({ workflow_id: c }), created_at: new Date(Date.now() - 9 * DAY).toISOString() }
    ]);

    expect(await listWorkflowLaunchSkipCountsAction({ workflowIds: [] })).toEqual({});
    const counts = await listWorkflowLaunchSkipCountsAction({ workflowIds: [a, b, c] });
    expect(counts).toEqual({ [a]: 2 });

    useTenant(uuidv4());
    expect(await listWorkflowLaunchSkipCountsAction({ workflowIds: [a] })).toEqual({});
  });

  it('event skips: returns every skip for the event with workflow names, tenant isolated', async () => {
    const created = await createWorkflowDefinitionAction({
      definition: { id: uuidv4(), ...buildWorkflowDefinition({ steps: [stateSetStep('state-1', 'READY')], name: 'Escalate overdue' }) }
    });
    const workflowId = created.workflowId;
    const eventId = uuidv4();
    await insertAt([
      skipRow({ event_id: eventId, workflow_id: workflowId, message: 'first' }),
      skipRow({ event_id: eventId, workflow_id: uuidv4(), reason: 'paused', intentional: true, message: 'second' }),
      skipRow({ event_id: uuidv4(), workflow_id: workflowId, message: 'other event' })
    ]);

    const items = await listEventLaunchSkipsAction({ eventId });
    expect(items.map((i) => i.message).sort()).toEqual(['first', 'second']);
    expect(items.find((i) => i.message === 'second')?.intentional).toBe(true);
    expect(items.find((i) => i.message === 'first')?.workflowName).toBe('Escalate overdue');
    expect(items.find((i) => i.message === 'second')?.workflowName).toBeNull();

    useTenant(uuidv4());
    expect(await listEventLaunchSkipsAction({ eventId })).toEqual([]);
  });

  it('rejects malformed input (non-uuid workflow id)', async () => {
    await expect(getWorkflowLaunchSkipSummaryAction({ workflowId: 'nope' })).rejects.toThrow();
  });
});

describe('deleting a workflow definition', () => {
  it('removes that workflow\'s skip rows and leaves other workflows\' rows alone', async () => {
    const created = await createWorkflowDefinitionAction({
      definition: { id: uuidv4(), ...buildWorkflowDefinition({ steps: [stateSetStep('state-1', 'READY')] }) }
    });
    const keptWorkflowId = uuidv4();
    await insertAt([
      skipRow({ workflow_id: created.workflowId }),
      skipRow({ workflow_id: created.workflowId, reason: 'paused', intentional: true }),
      skipRow({ workflow_id: keptWorkflowId })
    ]);

    const result = await deleteWorkflowDefinitionAction({ workflowId: created.workflowId });
    expect((result as any).success).toBe(true);

    expect(await db(TABLE).where({ tenant: tenantId, workflow_id: created.workflowId })).toHaveLength(0);
    expect(await db(TABLE).where({ tenant: tenantId, workflow_id: keptWorkflowId })).toHaveLength(1);
  });
});
