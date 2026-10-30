import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionContext } from '../../../../../shared/workflow/runtime/registries/actionRegistry';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  writes: [] as Array<{ table: string; operation: string; data: Row }>,
  locks: [] as string[],
  deniedPermission: '',
  assetAllowed: true,
  tenant: '11111111-1111-4111-8111-111111111111',
  actor: '22222222-2222-4222-8222-222222222222',
  sequence: 0,
}));

const ids = {
  schedule: '33333333-3333-4333-8333-333333333333',
  occurrence: '44444444-4444-4444-8444-444444444444',
  asset: '55555555-5555-4555-8555-555555555555',
  client: '66666666-6666-4666-8666-666666666666',
  board: '77777777-7777-4777-8777-777777777777',
  status: '88888888-8888-4888-8888-888888888888',
  priority: '99999999-9999-4999-8999-999999999999',
  ticket: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  category: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  subcategory: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  orphanSubcategory: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
  otherBoard: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  otherBoardCategory: 'eeeeeeee-dddd-4ddd-8ddd-dddddddddddd',
};

vi.mock('@alga-psa/db', () => ({
  tenantDb: (_trx: unknown, tenant: string) => ({
    table: (table: string) => {
      const conditions: Row = { tenant };
      let operation = 'select';
      let data: Row = {};
      let maximum = Infinity;
      let ignoreConflict = false;
      const run = () => {
        const rows = state.tables[table] ??= [];
        const matches = rows.filter((row) => Object.entries(conditions).every(([key, value]) => row[key] === value)).slice(0, maximum);
        if (operation === 'select') return matches.map((row) => ({ ...row }));
        if (operation === 'update') {
          state.writes.push({ table, operation, data });
          matches.forEach((row) => Object.assign(row, data));
          return matches.map((row) => ({ ...row }));
        }
        const duplicate = ignoreConflict && (
          table === 'asset_maintenance_occurrences'
            ? rows.some((row) => row.tenant === tenant && row.schedule_id === data.schedule_id && row.status === 'open')
            : rows.some((row) => row.tenant === tenant && row.asset_id === data.asset_id && row.entity_id === data.entity_id)
        );
        if (duplicate) return [];
        const generated = `bbbbbbbb-bbbb-4bbb-8bbb-${String(++state.sequence).padStart(12, '0')}`;
        const row = {
          ...(table === 'asset_maintenance_occurrences' ? { occurrence_id: generated, ticket_id: null, history_id: null } : {}),
          ...(table === 'asset_maintenance_history' ? { history_id: generated } : {}),
          ...data,
        };
        state.writes.push({ table, operation, data });
        rows.push(row);
        return [{ ...row }];
      };
      const query = {
        where: (values: Row) => { Object.assign(conditions, values); return query; },
        forUpdate: () => { state.locks.push(table); return query; },
        limit: (value: number) => { maximum = value; return query; },
        select: () => query,
        first: async () => run()[0],
        insert: (value: Row) => { operation = 'insert'; data = value; return query; },
        update: (value: Row) => { operation = 'update'; data = value; return query; },
        onConflict: () => query,
        ignore: () => { ignoreConflict = true; return query; },
        returning: async () => run(),
        then: (resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
      };
      return query;
    },
  }),
}));

vi.mock('../../../../../shared/workflow/runtime/actions/businessOperations/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../shared/workflow/runtime/actions/businessOperations/shared')>();
  return {
    ...actual,
    withTenantTransaction: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = structuredClone(state.tables);
      try {
        return await fn({
          tenantId: state.tenant, actorUserId: state.actor, workflowId: ids.schedule, lineage: [],
          trx: { fn: { now: () => new Date('2026-10-22T12:00:00Z') } },
        });
      } catch (error) {
        state.tables = snapshot;
        throw error;
      }
    },
    requirePermission: async (_ctx: unknown, _tx: unknown, permission: { resource: string; action: string }) => {
      if (`${permission.resource}:${permission.action}` === state.deniedPermission) throw { code: 'PERMISSION_DENIED' };
    },
    writeRunAudit: vi.fn(),
  };
});

vi.mock('@alga-psa/authorization/kernel', () => ({
  BuiltinAuthorizationKernelProvider: class {},
  BundleAuthorizationKernelProvider: class {},
  createAuthorizationKernel: () => ({
    authorizeResource: async () => ({ allowed: state.assetAllowed }),
  }),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({ resolveBundleNarrowingRulesForEvaluation: vi.fn() }));
vi.mock('../../../../../shared/services/tickets/createTicketWithSideEffects', () => ({
  createTicketWithSideEffects: vi.fn(async () => {
    state.tables.tickets.push({ tenant: state.tenant, ticket_id: ids.ticket, ticket_number: '1001' });
    return { ticketId: ids.ticket, ticketNumber: '1001' };
  }),
}));

import { getActionRegistryV2 } from '../../../../../shared/workflow/runtime/registries/actionRegistry';
import { registerAssetMaintenanceActions } from '../../../../../shared/workflow/runtime/actions/businessOperations/assetMaintenance';
import { createTicketWithSideEffects } from '../../../../../shared/services/tickets/createTicketWithSideEffects';
import { writeRunAudit } from '../../../../../shared/workflow/runtime/actions/businessOperations/shared';
import { advanceMaintenanceDate } from '../../../../../shared/services/assets/maintenanceRecurrence';

const ctx: ActionContext = {
  tenantId: state.tenant, runId: ids.schedule, stepPath: 'root.steps[0]',
  idempotencyKey: 'test', attempt: 1, nowIso: () => '2026-10-22T12:00:00Z', env: {},
};
const ticketInput = { occurrence_id: ids.occurrence, board_id: ids.board, status_id: ids.status, priority_id: ids.priority };
const occurrence = () => state.tables.asset_maintenance_occurrences[0];
const schedule = () => state.tables.asset_maintenance_schedules[0];

async function execute(name: string, input: unknown) {
  const action = getActionRegistryV2().get(`assets.${name}`, 1);
  if (!action) throw new Error(`Action not registered: ${name}`);
  const output = await action.handler(action.inputSchema.parse(input), ctx);
  return action.outputSchema.parse(output);
}

describe('asset maintenance workflow actions and shared lifecycle', () => {
  beforeAll(() => registerAssetMaintenanceActions());
  beforeEach(() => {
    vi.clearAllMocks();
    state.writes = [];
    state.locks = [];
    state.sequence = 0;
    state.assetAllowed = true;
    state.deniedPermission = '';
    const scoped = (rows: Row[]) => rows.map((row) => ({ tenant: state.tenant, ...row }));
    state.tables = {
      asset_maintenance_schedules: scoped([{
        schedule_id: ids.schedule, asset_id: ids.asset, schedule_name: 'Server maintenance',
        maintenance_type: 'preventive', frequency: 'monthly', frequency_interval: 6,
        next_maintenance: '2026-01-31T00:00:00Z', last_maintenance: null, is_active: true, archived_at: null,
      }]),
      asset_maintenance_occurrences: scoped([{
        occurrence_id: ids.occurrence, schedule_id: ids.schedule, asset_id: ids.asset,
        due_date: '2026-01-31T00:00:00Z', status: 'open', ticket_id: null, history_id: null,
      }]),
      assets: scoped([{ asset_id: ids.asset, client_id: ids.client }]),
      users: scoped([{ user_id: state.actor, user_type: 'internal' }]),
      statuses: scoped([{ status_id: ids.status, board_id: ids.board, status_type: 'ticket', is_closed: false }]),
      priorities: scoped([{ priority_id: ids.priority, item_type: 'ticket' }]),
      categories: scoped([
        { category_id: ids.category, category_name: 'Maintenance', board_id: ids.board, parent_category: null },
        { category_id: ids.subcategory, category_name: 'Filter change', board_id: ids.board, parent_category: ids.category },
        { category_id: ids.orphanSubcategory, category_name: 'Orphan', board_id: ids.board, parent_category: 'ffffffff-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
        { category_id: ids.otherBoardCategory, category_name: 'Other board', board_id: ids.otherBoard, parent_category: null },
      ]),
      tickets: [], asset_associations: [], user_roles: [], team_members: [],
    };
  });

  it('registers all five discoverable actions', () => {
    for (const name of ['get_maintenance', 'create_maintenance_ticket', 'complete_maintenance', 'skip_maintenance', 'set_maintenance_paused']) {
      expect(getActionRegistryV2().get(`assets.${name}`, 1)?.ui?.category).toBe('Business Operations');
    }
  });

  it('accepts structured completion records and rejects non-record values', () => {
    const action = getActionRegistryV2().get('assets.complete_maintenance', 1)!;
    const maintenanceData = { passed: true, readings: { voltage: 12 }, notes: ['Checked'], result: null };
    expect(action.inputSchema.parse({
      occurrence_id: ids.occurrence, maintenance_data: maintenanceData,
    })).toMatchObject({ maintenance_data: maintenanceData });
    for (const invalid of ['text', [], 42, null]) {
      expect(action.inputSchema.safeParse({
        occurrence_id: ids.occurrence, maintenance_data: invalid,
      }).success).toBe(false);
    }
  });

  it('requires exactly one lookup identifier and a nonblank skip reason', async () => {
    for (const input of [{}, { ticket_id: ids.ticket, schedule_id: ids.schedule }, { occurrence_id: 'bad' }]) {
      await expect(execute('get_maintenance', input)).rejects.toThrow();
    }
    await expect(execute('skip_maintenance', { occurrence_id: ids.occurrence, reason: '  ' })).rejects.toThrow();
    await expect(execute('complete_maintenance', { occurrence_id: ids.occurrence, performed_at: 'not-a-date' })).rejects.toThrow();
    await expect(execute('complete_maintenance', { occurrence_id: ids.occurrence, performed_at: '2026-02-30' })).rejects.toThrow();
  });

  it('keeps action schemas compatible with the workflow worker zod pin', () => {
    const source = readFileSync(
      new URL('../../../../../shared/workflow/runtime/actions/businessOperations/assetMaintenance.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/z\.string\(\)\.date\(/);
  });

  it('gets a plan and its open occurrence without writing', async () => {
    const output = await execute('get_maintenance', { schedule_id: ids.schedule });
    expect(output).toMatchObject({ found: true, schedule: { schedule_id: ids.schedule }, occurrence: { occurrence_id: ids.occurrence } });
    expect(state.writes).toEqual([]);
  });

  it('returns an explicitly empty result for unrelated tickets, or errors on request', async () => {
    expect(await execute('get_maintenance', { ticket_id: ids.ticket })).toEqual({ found: false, schedule: null, occurrence: null });
    await expect(execute('get_maintenance', { ticket_id: ids.ticket, on_not_found: 'error' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('finds completed occurrences through a manually linked ticket', async () => {
    Object.assign(occurrence(), { ticket_id: ids.ticket, status: 'completed' });
    expect(await execute('get_maintenance', { ticket_id: ids.ticket })).toMatchObject({ found: true, occurrence: { status: 'completed' } });
  });

  it('rejects ambiguous ticket links rather than selecting an occurrence arbitrarily', async () => {
    occurrence().ticket_id = ids.ticket;
    state.tables.asset_maintenance_occurrences.push({ ...occurrence(), occurrence_id: ids.ticket });
    await expect(execute('get_maintenance', { ticket_id: ids.ticket })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('never resolves another tenant occurrence', async () => {
    occurrence().tenant = ids.ticket;
    expect(await execute('get_maintenance', { occurrence_id: ids.occurrence })).toMatchObject({ found: false });
    await expect(execute('create_maintenance_ticket', ticketInput)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(createTicketWithSideEffects).not.toHaveBeenCalled();
  });

  it('creates a ticket with the asset client and shared linkage, then reuses it on retry', async () => {
    const output = await execute('create_maintenance_ticket', ticketInput);
    expect(output).toMatchObject({ occurrence_id: ids.occurrence, ticket_id: ids.ticket, already_linked: false });
    expect(createTicketWithSideEffects).toHaveBeenCalledWith(expect.anything(), state.tenant, expect.objectContaining({
      assetIds: [ids.asset],
      ticket: expect.objectContaining({ client_id: ids.client, title: 'Server maintenance' }),
      actor: expect.objectContaining({ type: 'workflow', userId: state.actor }),
    }));
    expect(occurrence().ticket_id).toBe(ids.ticket);
    expect(state.tables.asset_associations).toContainEqual(expect.objectContaining({ tenant: state.tenant, asset_id: ids.asset, entity_id: ids.ticket, entity_type: 'ticket' }));
    expect(state.locks.slice(0, 2)).toEqual(['asset_maintenance_schedules', 'asset_maintenance_occurrences']);
    expect(await execute('create_maintenance_ticket', ticketInput)).toMatchObject({ ticket_id: ids.ticket, already_linked: true });
    expect(createTicketWithSideEffects).toHaveBeenCalledTimes(1);
    expect(writeRunAudit).toHaveBeenCalledTimes(1);
  });

  it('passes an optional category on to the created ticket', async () => {
    const output = await execute('create_maintenance_ticket', { ...ticketInput, category_id: ids.category });
    expect(output).toMatchObject({ occurrence_id: ids.occurrence, ticket_id: ids.ticket, already_linked: false });
    expect(createTicketWithSideEffects).toHaveBeenCalledWith(expect.anything(), state.tenant, expect.objectContaining({
      ticket: expect.objectContaining({ category_id: ids.category }),
    }));
  });

  it('stores a subcategory pick as parent category plus subcategory, like the ticket UI', async () => {
    await execute('create_maintenance_ticket', { ...ticketInput, category_id: ids.subcategory });
    expect(createTicketWithSideEffects).toHaveBeenCalledWith(expect.anything(), state.tenant, expect.objectContaining({
      ticket: expect.objectContaining({ category_id: ids.category, subcategory_id: ids.subcategory }),
    }));
  });

  it.each([
    ['unknown category', 'ffffffff-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    ['category on another board', ids.otherBoardCategory],
    ['subcategory whose parent is missing', ids.orphanSubcategory],
  ])('rejects ticket creation with an %s', async (_label, categoryId) => {
    await expect(execute('create_maintenance_ticket', { ...ticketInput, category_id: categoryId })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(createTicketWithSideEffects).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
  });

  it.each(['ticket:create', 'ticket:read', 'asset:read', 'asset:update'])('rejects ticket creation without %s', async (permission) => {
    state.deniedPermission = permission;
    await expect(execute('create_maintenance_ticket', ticketInput)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(createTicketWithSideEffects).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
  });

  it.each(['complete_maintenance', 'skip_maintenance', 'set_maintenance_paused'])('requires update permission for %s', async (action) => {
    state.deniedPermission = 'asset:update';
    await expect(execute(action, { occurrence_id: ids.occurrence, reason: 'Holiday', schedule_id: ids.schedule, paused: true })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(state.writes).toEqual([]);
  });

  it.each(['get_maintenance', 'create_maintenance_ticket', 'complete_maintenance', 'skip_maintenance', 'set_maintenance_paused'])('enforces asset narrowing restrictions for %s', async (action) => {
    state.assetAllowed = false;
    const input = action === 'get_maintenance'
      ? { occurrence_id: ids.occurrence }
      : { ...ticketInput, reason: 'Holiday', schedule_id: ids.schedule, paused: true };
    await expect(execute(action, input)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(state.writes).toEqual([]);
    expect(createTicketWithSideEffects).not.toHaveBeenCalled();
  });

  it.each(['closed status', 'different board', 'missing priority', 'unowned asset'])('rejects invalid ticket configuration: %s', async (invalid) => {
    if (invalid === 'closed status') state.tables.statuses[0].is_closed = true;
    if (invalid === 'different board') state.tables.statuses[0].board_id = ids.client;
    if (invalid === 'missing priority') state.tables.priorities = [];
    if (invalid === 'unowned asset') state.tables.assets[0].client_id = null;
    await expect(execute('create_maintenance_ticket', ticketInput)).rejects.toBeDefined();
    expect(createTicketWithSideEffects).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
  });

  it('completes from ticket closure data and advances exactly once from the performed date', async () => {
    schedule().frequency_interval = 1;
    await execute('create_maintenance_ticket', ticketInput);
    const found = await execute('get_maintenance', { ticket_id: ids.ticket });
    const result = await execute('complete_maintenance', {
      occurrence_id: found.occurrence.occurrence_id,
      performed_at: '2026-08-31T18:30:00Z', notes: 'Ticket resolved', maintenance_data: { ticket_id: ids.ticket },
    });
    expect(result.next_occurrence.due_date).toBe('2026-09-30T00:00:00.000Z');
    expect(occurrence()).toMatchObject({ status: 'completed', ticket_id: ids.ticket, history_id: result.history_id });
    expect(state.tables.asset_maintenance_history).toHaveLength(1);
    expect(state.tables.asset_maintenance_history[0]).toMatchObject({
      performed_at: '2026-08-31T00:00:00.000Z', performed_by: state.actor, description: 'Ticket resolved',
      maintenance_data: JSON.stringify({ ticket_id: ids.ticket }),
    });
    expect(state.tables.asset_maintenance_notifications).toHaveLength(1);
    expect(schedule().last_maintenance).toBe('2026-08-31T00:00:00.000Z');
    expect(await execute('complete_maintenance', { occurrence_id: ids.occurrence })).toMatchObject({ already_completed: true, next_occurrence: null });
    expect(state.tables.asset_maintenance_history).toHaveLength(1);
    expect(state.tables.asset_maintenance_occurrences).toHaveLength(2);
  });

  it('rolls back the ticket and link when a later audit operation fails', async () => {
    vi.mocked(writeRunAudit).mockRejectedValueOnce(new Error('Audit unavailable'));
    await expect(execute('create_maintenance_ticket', ticketInput)).rejects.toMatchObject({ message: 'Audit unavailable' });
    expect(occurrence().ticket_id).toBeNull();
    expect(state.tables.tickets).toEqual([]);
    expect(state.tables.asset_associations).toEqual([]);
  });

  it('skips with a trimmed reason without writing completed history and is retry-safe', async () => {
    const output = await execute('skip_maintenance', { occurrence_id: ids.occurrence, reason: '  Holiday  ' });
    expect(output).toMatchObject({ already_skipped: false, next_occurrence: { status: 'open' } });
    expect(occurrence()).toMatchObject({ status: 'skipped', skip_reason: 'Holiday', closed_by: state.actor });
    expect(state.tables.asset_maintenance_history).toBeUndefined();
    expect(schedule().last_maintenance).toBeNull();
    expect(await execute('skip_maintenance', { occurrence_id: ids.occurrence, reason: 'Holiday' })).toMatchObject({ already_skipped: true });
    expect(state.tables.asset_maintenance_occurrences).toHaveLength(2);
  });

  it('pauses and resumes without reopening a cancelled occurrence or duplicating open ones', async () => {
    await execute('set_maintenance_paused', { schedule_id: ids.schedule, paused: true });
    expect(schedule().is_active).toBe(false);
    expect(occurrence().status).toBe('cancelled');
    expect(await execute('get_maintenance', { schedule_id: ids.schedule })).toMatchObject({ found: true, occurrence: null });
    await execute('set_maintenance_paused', { schedule_id: ids.schedule, paused: false });
    await execute('set_maintenance_paused', { schedule_id: ids.schedule, paused: false });
    expect(schedule().is_active).toBe(true);
    expect(state.tables.asset_maintenance_occurrences).toHaveLength(2);
    expect(state.tables.asset_maintenance_occurrences[1]).toMatchObject({ status: 'open', due_date: schedule().next_maintenance });
    await expect(execute('complete_maintenance', { occurrence_id: ids.occurrence })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it.each(['custom frequency', 'inactive', 'archived', 'skipped'])('does not complete an occurrence for %s', async (invalid) => {
    if (invalid === 'custom frequency') schedule().frequency = 'custom';
    if (invalid === 'inactive') schedule().is_active = false;
    if (invalid === 'archived') schedule().archived_at = '2026-01-01T00:00:00Z';
    if (invalid === 'skipped') occurrence().status = 'skipped';
    await expect(execute('complete_maintenance', { occurrence_id: ids.occurrence })).rejects.toBeDefined();
    expect(state.writes).toEqual([]);
  });

  it('preserves recurrence interval, month-end and timestamp semantics after extraction', () => {
    expect(advanceMaintenanceDate('2026-01-31T12:00:00Z', 'monthly', 1).toISOString()).toBe('2026-02-28T12:00:00.000Z');
    expect(advanceMaintenanceDate('2026-01-31', 'quarterly', 2).toISOString()).toBe('2026-07-31T00:00:00.000Z');
    expect(advanceMaintenanceDate('2024-02-29', 'yearly', 1).toISOString()).toBe('2025-02-28T00:00:00.000Z');
    expect(() => advanceMaintenanceDate('2026-01-01', 'monthly', 0)).toThrow('interval');
  });
});
