import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

type IntegrationState = {
  db: Knex | null;
};

const hoisted = vi.hoisted(() => {
  const stateKey = '__onboardingBoardTicketStatusesState__';

  if (!(stateKey in globalThis)) {
    (globalThis as any)[stateKey] = {
      db: null,
    } satisfies IntegrationState;
  }

  return { stateKey };
});

const mockedSaveTenantOnboardingProgress = vi.fn(async () => ({ success: true }));
const mockedUpdateTenantOnboardingStatus = vi.fn(async () => ({ success: true }));
const mockedRevalidatePath = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => {
    const state = (globalThis as any)[hoisted.stateKey] as IntegrationState;
    if (!state.db) {
      throw new Error('Integration database is not initialised');
    }

    return {
      knex: state.db,
    };
  }),
  withTransaction: vi.fn(async (_knex: unknown, callback: (trx: Knex.Transaction) => Promise<unknown>) => {
    const state = (globalThis as any)[hoisted.stateKey] as IntegrationState;
    if (!state.db) {
      throw new Error('Integration database is not initialised');
    }

    return state.db.transaction((trx) => callback(trx));
  }),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
  withAuthCheck: (fn: unknown) => fn,
  withOptionalAuth: (fn: unknown) => fn,
  hasPermission: vi.fn(async () => true),
  getCurrentUser: vi.fn(async () => null),
  preCheckDeletion: vi.fn(async () => ({
    canDelete: true,
    code: 'OK',
    message: '',
    dependencies: [],
    alternatives: [],
  })),
}));

vi.mock('@alga-psa/tenancy/actions', () => ({
  saveTenantOnboardingProgress: (...args: unknown[]) => mockedSaveTenantOnboardingProgress(...args),
  updateTenantOnboardingStatus: (...args: unknown[]) => mockedUpdateTenantOnboardingStatus(...args),
}));

vi.mock('@alga-psa/clients/actions', () => ({
  createClient: vi.fn(async () => ({ client_id: 'mock-client-id' })),
  createClientContact: vi.fn(async () => ({ contact_id: 'mock-contact-id' })),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockedRevalidatePath(...args),
}));

let db: Knex;
const tenantsToCleanup = new Set<string>();
let tenantColumns: Record<string, unknown>;
let userColumns: Record<string, unknown>;
let boardColumns: Record<string, unknown>;
let nextNumberColumns: Record<string, unknown>;
let standardStatusColumns: Record<string, unknown>;

function hasColumn(columns: Record<string, unknown>, columnName: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, columnName);
}

async function cleanupTenant(tenantId: string) {
  await db('next_number').where({ tenant: tenantId }).delete().catch(() => undefined);
  await db('priorities').where({ tenant: tenantId, item_type: 'ticket' }).delete().catch(() => undefined);
  await db('standard_statuses').where({ tenant: tenantId }).delete().catch(() => undefined);
  await db('statuses').where({ tenant: tenantId }).delete().catch(() => undefined);
  await db('categories').where({ tenant: tenantId }).delete().catch(() => undefined);
  await db('boards').where({ tenant: tenantId }).delete().catch(() => undefined);
  await db('users').where({ tenant: tenantId }).delete().catch(() => undefined);
  await db('tenants').where({ tenant: tenantId }).delete().catch(() => undefined);
}

async function seedTenantAndUser() {
  const tenantId = uuidv4();
  const userId = uuidv4();
  tenantsToCleanup.add(tenantId);

  await db('tenants').insert({
    tenant: tenantId,
    ...(hasColumn(tenantColumns, 'company_name')
      ? { company_name: `Tenant ${tenantId.slice(0, 8)}` }
      : { client_name: `Tenant ${tenantId.slice(0, 8)}` }),
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await db('users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `user-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    ...(hasColumn(userColumns, 'role') ? { role: 'admin' } : {}),
    ...(hasColumn(userColumns, 'email') ? { email: `user-${tenantId.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn(userColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(userColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  return { tenantId, userId };
}

async function seedStandardTicketStatuses(tenantId: string) {
  await db('standard_statuses').insert([
    {
      standard_status_id: uuidv4(),
      tenant: tenantId,
      name: 'Open',
      item_type: 'ticket',
      display_order: 1,
      ...(hasColumn(standardStatusColumns, 'is_default') ? { is_default: true } : {}),
      ...(hasColumn(standardStatusColumns, 'is_closed') ? { is_closed: false } : {}),
    },
    {
      standard_status_id: uuidv4(),
      tenant: tenantId,
      name: 'Resolved',
      item_type: 'ticket',
      display_order: 2,
      ...(hasColumn(standardStatusColumns, 'is_default') ? { is_default: false } : {}),
      ...(hasColumn(standardStatusColumns, 'is_closed') ? { is_closed: true } : {}),
    },
  ]);
}

describe('Onboarding board-specific ticket statuses', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    (globalThis as any)[hoisted.stateKey].db = db;
    tenantColumns = await db('tenants').columnInfo();
    userColumns = await db('users').columnInfo();
    boardColumns = await db('boards').columnInfo();
    nextNumberColumns = await db('next_number').columnInfo();
    standardStatusColumns = await db('standard_statuses').columnInfo();
  }, 180_000);

  afterEach(async () => {
    mockedSaveTenantOnboardingProgress.mockClear();
    mockedUpdateTenantOnboardingStatus.mockClear();
    mockedRevalidatePath.mockClear();

    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
      tenantsToCleanup.delete(tenantId);
    }
  });

  afterAll(async () => {
    await db.destroy();
    (globalThis as any)[hoisted.stateKey].db = null;
  });

  it('T051: configureTicketing creates board-owned ticket statuses and validates the default on the selected board', async () => {
    const { tenantId, userId } = await seedTenantAndUser();
    const { configureTicketing, validateOnboardingDefaults } = await import(
      '../../../../packages/onboarding/src/actions/onboarding-actions/onboardingActions'
    );

    const result = await configureTicketing(
      { user_id: userId },
      { tenant: tenantId },
      {
        boardName: 'Support',
        supportEmail: 'support@example.com',
        isDefaultBoard: true,
        categories: [],
        priorities: [],
        ticketPrefix: 'TCK',
        ticketPaddingLength: 6,
        ticketStartNumber: 100,
        statuses: [
          { name: 'Open', is_closed: false, is_default: true, order_number: 10 },
          { name: 'Closed', is_closed: true, is_default: false, order_number: 20 },
        ],
      }
    );

    expect(result.success).toBe(true);

    const createdBoard = await db('boards')
      .where({ tenant: tenantId, board_name: 'Support' })
      .first<{ board_id: string }>('board_id');
    expect(createdBoard?.board_id).toBeTruthy();

    const createdStatuses = await db('statuses')
      .where({ tenant: tenantId, board_id: createdBoard?.board_id, status_type: 'ticket' })
      .orderBy('order_number', 'asc')
      .select('board_id', 'name', 'is_closed', 'is_default');

    expect(createdStatuses).toHaveLength(2);
    expect(createdStatuses.every((status) => status.board_id === createdBoard?.board_id)).toBe(true);
    expect(createdStatuses.filter((status) => status.is_default && !status.is_closed)).toHaveLength(1);
    expect(
      await db('statuses')
        .where({ tenant: tenantId, status_type: 'ticket' })
        .whereNull('board_id')
        .first()
    ).toBeUndefined();

    const numbering = await db('next_number')
      .where({ tenant: tenantId, entity_type: 'TICKET' })
      .first<{ prefix: string; padding_length: number; initial_value: number }>('prefix', 'padding_length', 'initial_value');
    expect(numbering?.prefix).toBe('TCK');
    expect(numbering?.padding_length).toBe(6);
    if (hasColumn(nextNumberColumns, 'initial_value')) {
      expect(Number(numbering?.initial_value)).toBe(100);
    }

    await expect(
      validateOnboardingDefaults(
        { user_id: userId },
        { tenant: tenantId }
      )
    ).resolves.toMatchObject({ success: true });
  });

  it('T052: importReferenceData creates ticket statuses on the target board without colliding with another board', async () => {
    const { tenantId, userId } = await seedTenantAndUser();
    await seedStandardTicketStatuses(tenantId);
    const boardA = uuidv4();
    const boardB = uuidv4();

    await db('boards').insert([
      {
        tenant: tenantId,
        board_id: boardA,
        board_name: 'Support',
        ...(hasColumn(boardColumns, 'display_order') ? { display_order: 10 } : {}),
      },
      {
        tenant: tenantId,
        board_id: boardB,
        board_name: 'Projects',
        ...(hasColumn(boardColumns, 'display_order') ? { display_order: 20 } : {}),
      },
    ]);

    const standardStatuses = await db('standard_statuses')
      .where({ item_type: 'ticket' })
      .orderBy('display_order', 'asc')
      .limit(2)
      .select<{ standard_status_id: string; name: string }[]>('standard_status_id', 'name');

    if (standardStatuses.length < 2) {
      throw new Error('Expected seeded standard ticket statuses');
    }

    await db('statuses').insert({
      tenant: tenantId,
      board_id: boardA,
      status_id: uuidv4(),
      name: standardStatuses[0].name,
      status_type: 'ticket',
      order_number: 10,
      is_closed: false,
      is_default: true,
      created_by: userId,
    });

    const { importReferenceData } = await import(
      '../../../../packages/reference-data/src/actions/referenceDataActions'
    );

    const result = await importReferenceData(
      { user_id: userId },
      { tenant: tenantId },
      'statuses',
      standardStatuses.map((status) => status.standard_status_id),
      { item_type: 'ticket', board_id: boardB }
    );

    expect(result.imported).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);

    const boardBStatuses = await db('statuses')
      .where({ tenant: tenantId, board_id: boardB, status_type: 'ticket' })
      .orderBy('order_number', 'asc')
      .select('board_id', 'name', 'is_default');

    expect(boardBStatuses.map((status) => status.name)).toEqual(
      standardStatuses.map((status) => status.name)
    );
    expect(boardBStatuses.every((status) => status.board_id === boardB)).toBe(true);
    expect(boardBStatuses.filter((status) => status.is_default)).toHaveLength(1);

    const boardAStatusCount = await db('statuses')
      .where({ tenant: tenantId, board_id: boardA, status_type: 'ticket' })
      .count<{ count: string }>('status_id as count')
      .first();
    expect(Number(boardAStatusCount?.count ?? 0)).toBe(1);
  });
});
