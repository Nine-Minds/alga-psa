import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({
  knex: null as Knex | null,
  tenant: '',
}));

const userRef = vi.hoisted(() => ({
  user: null as any,
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
}));

import { deleteBoard } from '../../../../packages/tickets/src/actions/board-actions/boardActions';

const HOOK_TIMEOUT = 180_000;

let db: Knex;
const tenantsToCleanup = new Set<string>();

function tenantTable(tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function tenantRows() {
  return tenantDb(db, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await tenantTable(tenantId, 'tickets').del();
  await tenantTable(tenantId, 'clients').del();
  await tenantTable(tenantId, 'categories').whereNotNull('parent_category').del();
  await tenantTable(tenantId, 'categories').del();
  await tenantTable(tenantId, 'sla_policy_targets').del();
  await tenantTable(tenantId, 'sla_notification_thresholds').del();
  await tenantTable(tenantId, 'boards').update({ default_priority_id: null, sla_policy_id: null });
  await tenantTable(tenantId, 'sla_policies').del();
  await tenantTable(tenantId, 'priorities').del();
  await tenantTable(tenantId, 'statuses').del();
  await tenantTable(tenantId, 'boards').del();
  await tenantTable(tenantId, 'users').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

interface BoardSpec {
  boardId: string;
  name: string;
  isDefault?: boolean;
  categoryType?: 'custom' | 'itil';
  priorityType?: 'custom' | 'itil';
}

async function createTenantFixture(boards: BoardSpec[]) {
  const tenantId = uuidv4();
  const userId = uuidv4();

  tenantsToCleanup.add(tenantId);

  await tenantRows().insert({
    tenant: tenantId,
    client_name: `Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
  });

  await tenantTable(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `user-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `user-${tenantId.slice(0, 8)}@example.com`,
  });

  await tenantTable(tenantId, 'boards').insert(boards.map((board, index) => ({
    tenant: tenantId,
    board_id: board.boardId,
    board_name: board.name,
    display_order: (index + 1) * 10,
    is_default: board.isDefault ?? false,
    is_inactive: false,
    category_type: board.categoryType ?? 'custom',
    priority_type: board.priorityType ?? 'custom',
  })));

  dbRef.knex = db;
  dbRef.tenant = tenantId;
  userRef.user = { user_id: userId, user_type: 'internal', tenant: tenantId };

  return { tenantId, userId };
}

async function createItilPriorities(tenantId: string, userId: string, levels: number[]) {
  const priorityIds = levels.map(() => uuidv4());

  await tenantTable(tenantId, 'priorities').insert(levels.map((level, index) => ({
    tenant: tenantId,
    priority_id: priorityIds[index],
    priority_name: `P${level} - ITIL`,
    color: '#DC2626',
    order_number: level * 10,
    item_type: 'ticket',
    is_from_itil_standard: true,
    itil_priority_level: level,
    created_by: userId,
  })));

  return priorityIds;
}

async function createItilSlaPolicy(tenantId: string, priorityIds: string[]) {
  const policyId = uuidv4();

  await tenantTable(tenantId, 'sla_policies').insert({
    tenant: tenantId,
    sla_policy_id: policyId,
    policy_name: 'ITIL Standard',
    description: 'Auto-created for ITIL priorities',
    is_default: false,
  });

  await tenantTable(tenantId, 'sla_notification_thresholds').insert({
    tenant: tenantId,
    threshold_id: uuidv4(),
    sla_policy_id: policyId,
    threshold_percent: 100,
    notification_type: 'breach',
    channels: ['in_app'],
  });

  await tenantTable(tenantId, 'sla_policy_targets').insert(priorityIds.map((priorityId) => ({
    tenant: tenantId,
    target_id: uuidv4(),
    sla_policy_id: policyId,
    priority_id: priorityId,
    response_time_minutes: 30,
    resolution_time_minutes: 240,
  })));

  return policyId;
}

describe('ITIL board deletion cleanup', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
      tenantsToCleanup.delete(tenantId);
    }
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('deletes the last ITIL board and releases every reference to the retired ITIL priorities', async () => {
    const defaultBoardId = uuidv4();
    const itilBoardId = uuidv4();
    const { tenantId, userId } = await createTenantFixture([
      { boardId: defaultBoardId, name: 'General', isDefault: true },
      { boardId: itilBoardId, name: 'ITIL Service Desk', categoryType: 'itil', priorityType: 'itil' },
    ]);

    const itilPriorityIds = await createItilPriorities(tenantId, userId, [1, 2]);
    const policyId = await createItilSlaPolicy(tenantId, itilPriorityIds);

    await tenantTable(tenantId, 'boards')
      .where({ board_id: itilBoardId })
      .update({ sla_policy_id: policyId });
    await tenantTable(tenantId, 'boards')
      .where({ board_id: defaultBoardId })
      .update({ default_priority_id: itilPriorityIds[0] });

    const parentCategoryId = uuidv4();
    const usedChildCategoryId = uuidv4();
    const unusedChildCategoryId = uuidv4();
    await tenantTable(tenantId, 'categories').insert([
      {
        tenant: tenantId,
        category_id: parentCategoryId,
        category_name: 'Incident',
        board_id: itilBoardId,
        is_from_itil_standard: true,
        created_by: userId,
      },
    ]);
    await tenantTable(tenantId, 'categories').insert([
      {
        tenant: tenantId,
        category_id: usedChildCategoryId,
        category_name: 'Hardware',
        parent_category: parentCategoryId,
        board_id: itilBoardId,
        is_from_itil_standard: true,
        created_by: userId,
      },
      {
        tenant: tenantId,
        category_id: unusedChildCategoryId,
        category_name: 'Software',
        parent_category: parentCategoryId,
        board_id: itilBoardId,
        is_from_itil_standard: true,
        created_by: userId,
      },
    ]);

    // A ticket parked on the surviving board keeps one ITIL category in use —
    // it must survive (detached), everything else must go.
    const clientId = uuidv4();
    await tenantTable(tenantId, 'clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: 'Acme',
    });
    await tenantTable(tenantId, 'tickets').insert({
      tenant: tenantId,
      ticket_id: uuidv4(),
      ticket_number: `T-${tenantId.slice(0, 8)}`,
      title: 'Legacy ITIL ticket',
      client_id: clientId,
      board_id: defaultBoardId,
      category_id: usedChildCategoryId,
      entered_by: userId,
      entered_at: db.fn.now(),
    });

    const result = await deleteBoard(itilBoardId, true, true);

    expect(result.success).toBe(true);
    expect(result.message).toContain('Cleaned up');

    const remainingBoards = await tenantTable(tenantId, 'boards').pluck('board_id');
    expect(remainingBoards).toEqual([defaultBoardId]);

    const remainingPriorities = await tenantTable(tenantId, 'priorities').select('*');
    expect(remainingPriorities).toHaveLength(0);

    const remainingTargets = await tenantTable(tenantId, 'sla_policy_targets').select('*');
    expect(remainingTargets).toHaveLength(0);

    const remainingPolicies = await tenantTable(tenantId, 'sla_policies').select('*');
    expect(remainingPolicies).toHaveLength(0);

    const remainingThresholds = await tenantTable(tenantId, 'sla_notification_thresholds').select('*');
    expect(remainingThresholds).toHaveLength(0);

    const survivingBoard = await tenantTable(tenantId, 'boards')
      .where({ board_id: defaultBoardId })
      .first('default_priority_id');
    expect(survivingBoard.default_priority_id).toBeNull();

    // The in-use category (and the parent it hangs off) survive, detached from
    // the deleted board; the unused sibling is gone.
    const remainingCategories = await tenantTable(tenantId, 'categories')
      .select('category_id', 'board_id')
      .orderBy('category_name', 'asc');
    expect(remainingCategories.map((category) => category.category_id).sort()).toEqual(
      [parentCategoryId, usedChildCategoryId].sort()
    );
    expect(remainingCategories.every((category) => category.board_id === null)).toBe(true);
  }, HOOK_TIMEOUT);

  it('releases tickets still stamped with the retiring ITIL SLA policy', async () => {
    const defaultBoardId = uuidv4();
    const itilBoardId = uuidv4();
    const { tenantId, userId } = await createTenantFixture([
      { boardId: defaultBoardId, name: 'General', isDefault: true },
      { boardId: itilBoardId, name: 'ITIL Service Desk', categoryType: 'custom', priorityType: 'itil' },
    ]);

    const itilPriorityIds = await createItilPriorities(tenantId, userId, [1, 2]);
    const policyId = await createItilSlaPolicy(tenantId, itilPriorityIds);

    // The full off-ramp: tickets were moved off the ITIL board and given custom
    // priorities, but keep the sla_policy_id stamped on them at SLA start.
    const customPriorityId = uuidv4();
    await tenantTable(tenantId, 'priorities').insert({
      tenant: tenantId,
      priority_id: customPriorityId,
      priority_name: 'Normal',
      color: '#2563EB',
      order_number: 10,
      item_type: 'ticket',
      is_from_itil_standard: false,
      created_by: userId,
    });

    const clientId = uuidv4();
    await tenantTable(tenantId, 'clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: 'Acme',
    });
    const ticketId = uuidv4();
    await tenantTable(tenantId, 'tickets').insert({
      tenant: tenantId,
      ticket_id: ticketId,
      ticket_number: `T-${tenantId.slice(0, 8)}`,
      title: 'Ticket carried off the ITIL board',
      client_id: clientId,
      board_id: defaultBoardId,
      priority_id: customPriorityId,
      sla_policy_id: policyId,
      entered_by: userId,
      entered_at: db.fn.now(),
    });

    const result = await deleteBoard(itilBoardId, true, true);

    expect(result.success).toBe(true);

    const remainingPolicies = await tenantTable(tenantId, 'sla_policies').select('*');
    expect(remainingPolicies).toHaveLength(0);

    const remainingPriorities = await tenantTable(tenantId, 'priorities').pluck('priority_id');
    expect(remainingPriorities).toEqual([customPriorityId]);

    const ticket = await tenantTable(tenantId, 'tickets')
      .where({ ticket_id: ticketId })
      .first('sla_policy_id');
    expect(ticket.sla_policy_id).toBeNull();
  }, HOOK_TIMEOUT);

  it('keeps an ITIL priority that tickets still use, along with its SLA target', async () => {
    const defaultBoardId = uuidv4();
    const itilBoardId = uuidv4();
    const { tenantId, userId } = await createTenantFixture([
      { boardId: defaultBoardId, name: 'General', isDefault: true },
      { boardId: itilBoardId, name: 'ITIL Service Desk', categoryType: 'custom', priorityType: 'itil' },
    ]);

    const [usedPriorityId, unusedPriorityId] = await createItilPriorities(tenantId, userId, [1, 2]);
    const policyId = await createItilSlaPolicy(tenantId, [usedPriorityId, unusedPriorityId]);

    const clientId = uuidv4();
    await tenantTable(tenantId, 'clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: 'Acme',
    });
    await tenantTable(tenantId, 'tickets').insert({
      tenant: tenantId,
      ticket_id: uuidv4(),
      ticket_number: `T-${tenantId.slice(0, 8)}`,
      title: 'Legacy ITIL ticket',
      client_id: clientId,
      board_id: defaultBoardId,
      priority_id: usedPriorityId,
      entered_by: userId,
      entered_at: db.fn.now(),
    });

    const result = await deleteBoard(itilBoardId, true, true);

    expect(result.success).toBe(true);
    expect(result.message).toContain('still in use');

    const remainingPriorities = await tenantTable(tenantId, 'priorities').pluck('priority_id');
    expect(remainingPriorities).toEqual([usedPriorityId]);

    const remainingTargets = await tenantTable(tenantId, 'sla_policy_targets').pluck('priority_id');
    expect(remainingTargets).toEqual([usedPriorityId]);

    // The policy still targets a live priority, so it stays.
    const remainingPolicies = await tenantTable(tenantId, 'sla_policies').pluck('sla_policy_id');
    expect(remainingPolicies).toEqual([policyId]);
  }, HOOK_TIMEOUT);

  it('re-points ITIL categories to a remaining ITIL board when another one is left', async () => {
    const defaultBoardId = uuidv4();
    const dyingItilBoardId = uuidv4();
    const survivingItilBoardId = uuidv4();
    const { tenantId, userId } = await createTenantFixture([
      { boardId: defaultBoardId, name: 'General', isDefault: true },
      { boardId: dyingItilBoardId, name: 'ITIL One', categoryType: 'itil', priorityType: 'itil' },
      { boardId: survivingItilBoardId, name: 'ITIL Two', categoryType: 'itil', priorityType: 'itil' },
    ]);

    const priorityIds = await createItilPriorities(tenantId, userId, [1]);
    const categoryId = uuidv4();
    await tenantTable(tenantId, 'categories').insert({
      tenant: tenantId,
      category_id: categoryId,
      category_name: 'Incident',
      board_id: dyingItilBoardId,
      is_from_itil_standard: true,
      created_by: userId,
    });

    const result = await deleteBoard(dyingItilBoardId);

    expect(result.success).toBe(true);

    const remainingBoards = await tenantTable(tenantId, 'boards').pluck('board_id');
    expect(remainingBoards.sort()).toEqual([defaultBoardId, survivingItilBoardId].sort());

    const category = await tenantTable(tenantId, 'categories')
      .where({ category_id: categoryId })
      .first('board_id');
    expect(category.board_id).toBe(survivingItilBoardId);

    // Other ITIL boards remain, so the shared ITIL priorities stay put.
    const remainingPriorities = await tenantTable(tenantId, 'priorities').pluck('priority_id');
    expect(remainingPriorities).toEqual(priorityIds);
  }, HOOK_TIMEOUT);
});
