import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const HOOK_TIMEOUT = 180_000;
const cloneMigration = require(path.resolve(
  process.cwd(),
  'migrations',
  '20260314113000_clone_global_ticket_statuses_to_boards.cjs'
));
const remapReferencesMigration = require(path.resolve(
  process.cwd(),
  'migrations',
  '20260314120000_remap_board_context_ticket_status_references.cjs'
));

type ColumnInfoMap = Record<string, unknown>;

type ReferenceFixture = {
  tenantId: string;
  boardIds: [string, string];
  legacyStatusIds: {
    open: string;
    closed: string;
  };
  inboundDefaultsId: string;
  billingBoardId: string;
  contractId: string;
  contractBoardId: string;
};

let db: Knex;
let tenantColumns: ColumnInfoMap;
let userColumns: ColumnInfoMap;
let boardColumns: ColumnInfoMap;
let statusColumns: ColumnInfoMap;
let inboundDefaultsColumns: ColumnInfoMap;
let billingSettingsColumns: ColumnInfoMap;
let clientContractsColumns: ColumnInfoMap;

const tenantsToCleanup = new Set<string>();

function hasColumn(columns: ColumnInfoMap, columnName: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, columnName);
}

async function cleanupTenant(tenantId: string): Promise<void> {
  if (hasColumn(clientContractsColumns, 'tenant')) {
    await db('client_contracts').where({ tenant: tenantId }).del();
  }

  if (hasColumn(billingSettingsColumns, 'tenant')) {
    await db('default_billing_settings').where({ tenant: tenantId }).del();
  }

  if (hasColumn(inboundDefaultsColumns, 'tenant')) {
    await db('inbound_ticket_defaults').where({ tenant: tenantId }).del();
  }

  await db('tickets').where({ tenant: tenantId }).del();
  await db('statuses').where({ tenant: tenantId }).del();
  await db('boards').where({ tenant: tenantId }).del();
  await db('users').where({ tenant: tenantId }).del();
  await db('tenants').where({ tenant: tenantId }).del();
}

async function createReferenceFixture(): Promise<ReferenceFixture> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const boardA = uuidv4();
  const boardB = uuidv4();
  const legacyOpenStatusId = uuidv4();
  const legacyClosedStatusId = uuidv4();
  const inboundDefaultsId = uuidv4();
  const contractId = uuidv4();

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

  await db('boards').insert([
    {
      tenant: tenantId,
      board_id: boardA,
      board_name: 'Support',
      ...(hasColumn(boardColumns, 'description') ? { description: 'Primary support board' } : {}),
      ...(hasColumn(boardColumns, 'display_order') ? { display_order: 10 } : {}),
      ...(hasColumn(boardColumns, 'is_default') ? { is_default: true } : {}),
      ...(hasColumn(boardColumns, 'is_inactive') ? { is_inactive: false } : {}),
      ...(hasColumn(boardColumns, 'is_active') ? { is_active: true } : {}),
      ...(hasColumn(boardColumns, 'category_type') ? { category_type: 'custom' } : {}),
      ...(hasColumn(boardColumns, 'priority_type') ? { priority_type: 'custom' } : {}),
      ...(hasColumn(boardColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(boardColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    },
    {
      tenant: tenantId,
      board_id: boardB,
      board_name: 'Billing',
      ...(hasColumn(boardColumns, 'description') ? { description: 'Billing board' } : {}),
      ...(hasColumn(boardColumns, 'display_order') ? { display_order: 20 } : {}),
      ...(hasColumn(boardColumns, 'is_default') ? { is_default: false } : {}),
      ...(hasColumn(boardColumns, 'is_inactive') ? { is_inactive: false } : {}),
      ...(hasColumn(boardColumns, 'is_active') ? { is_active: true } : {}),
      ...(hasColumn(boardColumns, 'category_type') ? { category_type: 'custom' } : {}),
      ...(hasColumn(boardColumns, 'priority_type') ? { priority_type: 'custom' } : {}),
      ...(hasColumn(boardColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(boardColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    },
  ]);

  await db('statuses').insert([
    {
      tenant: tenantId,
      status_id: legacyOpenStatusId,
      ...(hasColumn(statusColumns, 'board_id') ? { board_id: null } : {}),
      name: 'Open',
      ...(hasColumn(statusColumns, 'status_type') ? { status_type: 'ticket' } : {}),
      ...(hasColumn(statusColumns, 'item_type') ? { item_type: 'ticket' } : {}),
      is_closed: false,
      is_default: true,
      order_number: 10,
      created_by: userId,
      ...(hasColumn(statusColumns, 'standard_status_id') ? { standard_status_id: null } : {}),
      ...(hasColumn(statusColumns, 'is_custom') ? { is_custom: true } : {}),
      ...(hasColumn(statusColumns, 'color') ? { color: '#22C55E' } : {}),
      ...(hasColumn(statusColumns, 'icon') ? { icon: 'Circle' } : {}),
      ...(hasColumn(statusColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(statusColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    },
    {
      tenant: tenantId,
      status_id: legacyClosedStatusId,
      ...(hasColumn(statusColumns, 'board_id') ? { board_id: null } : {}),
      name: 'Closed',
      ...(hasColumn(statusColumns, 'status_type') ? { status_type: 'ticket' } : {}),
      ...(hasColumn(statusColumns, 'item_type') ? { item_type: 'ticket' } : {}),
      is_closed: true,
      is_default: false,
      order_number: 20,
      created_by: userId,
      ...(hasColumn(statusColumns, 'standard_status_id') ? { standard_status_id: null } : {}),
      ...(hasColumn(statusColumns, 'is_custom') ? { is_custom: true } : {}),
      ...(hasColumn(statusColumns, 'color') ? { color: '#64748B' } : {}),
      ...(hasColumn(statusColumns, 'icon') ? { icon: 'CheckCircle2' } : {}),
      ...(hasColumn(statusColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(statusColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    },
  ]);

  await db('inbound_ticket_defaults').insert({
    id: inboundDefaultsId,
    tenant: tenantId,
    short_name: `defaults-${tenantId.slice(0, 8)}`,
    display_name: 'Inbound Defaults',
    ...(hasColumn(inboundDefaultsColumns, 'description') ? { description: 'Inbound defaults' } : {}),
    ...(hasColumn(inboundDefaultsColumns, 'board_id') ? { board_id: boardA } : {}),
    ...(hasColumn(inboundDefaultsColumns, 'channel_id') ? { channel_id: boardA } : {}),
    status_id: legacyOpenStatusId,
    ...(hasColumn(inboundDefaultsColumns, 'priority_id') ? { priority_id: null } : {}),
    ...(hasColumn(inboundDefaultsColumns, 'entered_by') ? { entered_by: userId } : {}),
    ...(hasColumn(inboundDefaultsColumns, 'is_active') ? { is_active: true } : {}),
    ...(hasColumn(inboundDefaultsColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(inboundDefaultsColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await db('default_billing_settings')
    .insert({
      tenant: tenantId,
      ...(hasColumn(billingSettingsColumns, 'renewal_ticket_board_id')
        ? { renewal_ticket_board_id: boardB }
        : {}),
      ...(hasColumn(billingSettingsColumns, 'renewal_ticket_status_id')
        ? { renewal_ticket_status_id: legacyClosedStatusId }
        : {}),
      ...(hasColumn(billingSettingsColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(billingSettingsColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    })
    .onConflict('tenant')
    .merge();

  await db('client_contracts').insert({
    tenant: tenantId,
    ...(hasColumn(clientContractsColumns, 'client_contract_id') ? { client_contract_id: contractId } : {}),
    ...(hasColumn(clientContractsColumns, 'client_id') ? { client_id: uuidv4() } : {}),
    ...(hasColumn(clientContractsColumns, 'contract_id') ? { contract_id: uuidv4() } : {}),
    ...(hasColumn(clientContractsColumns, 'start_date') ? { start_date: db.fn.now() } : {}),
    ...(hasColumn(clientContractsColumns, 'is_active') ? { is_active: true } : {}),
    ...(hasColumn(clientContractsColumns, 'renewal_ticket_board_id')
      ? { renewal_ticket_board_id: boardA }
      : {}),
    ...(hasColumn(clientContractsColumns, 'renewal_ticket_status_id')
      ? { renewal_ticket_status_id: legacyClosedStatusId }
      : {}),
    ...(hasColumn(clientContractsColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(clientContractsColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  return {
    tenantId,
    boardIds: [boardA, boardB],
    legacyStatusIds: {
      open: legacyOpenStatusId,
      closed: legacyClosedStatusId,
    },
    inboundDefaultsId,
    billingBoardId: boardB,
    contractId,
    contractBoardId: boardA,
  };
}

async function runReferenceRemapForFixture(): Promise<ReferenceFixture> {
  const fixture = await createReferenceFixture();
  await cloneMigration.up(db);
  await remapReferencesMigration.up(db);
  return fixture;
}

describe('board-context ticket status reference remap migration (integration)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';

    db = await createTestDbConnection({ runSeeds: false });
    tenantColumns = await db('tenants').columnInfo();
    userColumns = await db('users').columnInfo();
    boardColumns = await db('boards').columnInfo();
    statusColumns = await db('statuses').columnInfo();
    inboundDefaultsColumns = await db('inbound_ticket_defaults').columnInfo();
    billingSettingsColumns = await db('default_billing_settings').columnInfo();
    clientContractsColumns = await db('client_contracts').columnInfo();
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

  it('T007: inbound ticket defaults are remapped to the board-owned status for their stored board', async () => {
    const fixture = await runReferenceRemapForFixture();

    const inboundDefaults = await db('inbound_ticket_defaults')
      .where({ tenant: fixture.tenantId, id: fixture.inboundDefaultsId })
      .first();

    expect(inboundDefaults?.status_id).toBeTruthy();
    expect(inboundDefaults?.status_id).not.toBe(fixture.legacyStatusIds.open);

    const clonedStatus = await db('statuses')
      .where({
        tenant: fixture.tenantId,
        board_id: fixture.boardIds[0],
        name: 'Open',
      })
      .first();

    expect(inboundDefaults?.status_id).toBe(clonedStatus?.status_id);
  }, HOOK_TIMEOUT);

  it('T008: tenant billing renewal defaults are remapped using renewal_ticket_board_id', async () => {
    const fixture = await runReferenceRemapForFixture();

    const billingSettings = await db('default_billing_settings')
      .where({ tenant: fixture.tenantId })
      .first();

    expect(billingSettings?.renewal_ticket_status_id).toBeTruthy();
    expect(billingSettings?.renewal_ticket_status_id).not.toBe(fixture.legacyStatusIds.closed);

    const clonedStatus = await db('statuses')
      .where({
        tenant: fixture.tenantId,
        board_id: fixture.billingBoardId,
        name: 'Closed',
      })
      .first();

    expect(billingSettings?.renewal_ticket_status_id).toBe(clonedStatus?.status_id);
  }, HOOK_TIMEOUT);

  it('T009: contract-level renewal defaults are remapped using renewal_ticket_board_id', async () => {
    const fixture = await runReferenceRemapForFixture();

    const clientContract = await db('client_contracts')
      .where({ tenant: fixture.tenantId, client_contract_id: fixture.contractId })
      .first();

    expect(clientContract?.renewal_ticket_status_id).toBeTruthy();
    expect(clientContract?.renewal_ticket_status_id).not.toBe(fixture.legacyStatusIds.closed);

    const clonedStatus = await db('statuses')
      .where({
        tenant: fixture.tenantId,
        board_id: fixture.contractBoardId,
        name: 'Closed',
      })
      .first();

    expect(clientContract?.renewal_ticket_status_id).toBe(clonedStatus?.status_id);
  }, HOOK_TIMEOUT);
});
