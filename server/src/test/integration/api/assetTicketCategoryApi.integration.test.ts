/**
 * Regression coverage for the customer-reported API fixes on this branch:
 *
 *  1. Ticket categories used to 500 because CategoryService queried the
 *     non-existent `ticket_categories` table and wrote columns absent from
 *     `categories` (description/updated_by/updated_at). These tests exercise
 *     the real `categories` table end to end, so a wrong table/column name
 *     fails here instead of in production.
 *  2. Asset<->ticket links had no API surface. These tests cover reading
 *     (getAssetTickets / getTicketAssets) and the new link/unlink writes,
 *     all of which go through the `asset_associations` table.
 *
 * Real-DB integration test (mirrors algadeskTicketCrudRbac/projectService):
 * a mocked getKnex injects the test connection into each service.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { CategoryService } from '@/lib/api/services/CategoryService';
import { AssetService } from '@/lib/api/services/AssetService';
import { TicketService } from '@/lib/api/services/TicketService';

const HOOK_TIMEOUT = 180_000;

type ColumnInfoMap = Record<string, unknown>;

type Fixture = {
  tenantId: string;
  userId: string;
  clientId: string;
  boardId: string;
  statusId: string;
  priorityId: string;
  assetId: string;
  ticketId: string;
};

let db: Knex;
const tenantsToCleanup = new Set<string>();
let tenantColumns: ColumnInfoMap;
let userColumns: ColumnInfoMap;
let clientColumns: ColumnInfoMap;
let boardColumns: ColumnInfoMap;
let statusColumns: ColumnInfoMap;
let priorityColumns: ColumnInfoMap;
let assetColumns: ColumnInfoMap;
let ticketColumns: ColumnInfoMap;

function hasColumn(columns: ColumnInfoMap, columnName: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, columnName);
}

function tenantTable(tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function tenantRows() {
  return tenantDb(db, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

function schemaTable(table: string) {
  return tenantDb(db, '__test_schema__')
    .unscoped(table, 'columnInfo reads schema metadata, not tenant rows');
}

function context(fixture: Fixture) {
  return { tenant: fixture.tenantId, userId: fixture.userId, db };
}

function injectDb(service: any, fixture: Fixture) {
  vi.spyOn(service, 'getKnex').mockResolvedValue({ knex: db, tenant: fixture.tenantId });
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await tenantTable(tenantId, 'asset_associations').del();
  await tenantTable(tenantId, 'tickets').del();
  await tenantTable(tenantId, 'categories').del();
  await tenantTable(tenantId, 'assets').del();
  await tenantTable(tenantId, 'statuses').del();
  await tenantTable(tenantId, 'priorities').del();
  await tenantTable(tenantId, 'boards').del();
  await tenantTable(tenantId, 'clients').del();
  await tenantTable(tenantId, 'users').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

async function createFixture(): Promise<Fixture> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const clientId = uuidv4();
  const boardId = uuidv4();
  const statusId = uuidv4();
  const priorityId = uuidv4();
  const assetId = uuidv4();
  const ticketId = uuidv4();

  tenantsToCleanup.add(tenantId);

  await tenantRows().insert({
    tenant: tenantId,
    ...(hasColumn(tenantColumns, 'company_name')
      ? { company_name: `Tenant ${tenantId.slice(0, 8)}` }
      : { client_name: `Tenant ${tenantId.slice(0, 8)}` }),
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `user-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    ...(hasColumn(userColumns, 'email') ? { email: `user-${tenantId.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn(userColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(userColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Client ${tenantId.slice(0, 8)}`,
    ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
    ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
    ...(hasColumn(clientColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(clientColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'boards').insert({
    tenant: tenantId,
    board_id: boardId,
    board_name: 'Support',
    ...(hasColumn(boardColumns, 'display_order') ? { display_order: 10 } : {}),
    ...(hasColumn(boardColumns, 'is_default') ? { is_default: true } : {}),
    ...(hasColumn(boardColumns, 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn(boardColumns, 'category_type') ? { category_type: 'custom' } : {}),
    ...(hasColumn(boardColumns, 'priority_type') ? { priority_type: 'custom' } : {}),
    ...(hasColumn(boardColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(boardColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'priorities').insert({
    tenant: tenantId,
    priority_id: priorityId,
    priority_name: 'High',
    ...(hasColumn(priorityColumns, 'item_type') ? { item_type: 'ticket' } : {}),
    ...(hasColumn(priorityColumns, 'order_number') ? { order_number: 10 } : {}),
    ...(hasColumn(priorityColumns, 'color') ? { color: '#EF4444' } : {}),
    ...(hasColumn(priorityColumns, 'created_by') ? { created_by: userId } : {}),
    ...(hasColumn(priorityColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(priorityColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'statuses').insert({
    tenant: tenantId,
    status_id: statusId,
    ...(hasColumn(statusColumns, 'board_id') ? { board_id: boardId } : {}),
    name: 'Open',
    ...(hasColumn(statusColumns, 'status_type') ? { status_type: 'ticket' } : {}),
    ...(hasColumn(statusColumns, 'item_type') ? { item_type: 'ticket' } : {}),
    is_closed: false,
    is_default: true,
    order_number: 10,
    created_by: userId,
    ...(hasColumn(statusColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(statusColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'assets').insert({
    tenant: tenantId,
    asset_id: assetId,
    ...(hasColumn(assetColumns, 'asset_type') ? { asset_type: 'workstation' } : {}),
    ...(hasColumn(assetColumns, 'client_id') ? { client_id: clientId } : { company_id: clientId }),
    asset_tag: `AST-${tenantId.slice(0, 8)}`,
    name: 'Test Asset',
    status: 'active',
    ...(hasColumn(assetColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(assetColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'tickets').insert({
    tenant: tenantId,
    ticket_id: ticketId,
    ticket_number: `TIC-${tenantId.slice(0, 8)}`,
    title: 'Asset-linked ticket',
    ...(hasColumn(ticketColumns, 'client_id') ? { client_id: clientId } : { company_id: clientId }),
    ...(hasColumn(ticketColumns, 'board_id') ? { board_id: boardId } : { channel_id: boardId }),
    status_id: statusId,
    priority_id: priorityId,
    entered_by: userId,
    assigned_to: userId,
    is_closed: false,
    ...(hasColumn(ticketColumns, 'entered_at') ? { entered_at: db.fn.now() } : {}),
    ...(hasColumn(ticketColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  return { tenantId, userId, clientId, boardId, statusId, priorityId, assetId, ticketId };
}

describe('asset/ticket/category API service integration', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ runSeeds: false });
    tenantColumns = await schemaTable('tenants').columnInfo();
    userColumns = await schemaTable('users').columnInfo();
    clientColumns = await schemaTable('clients').columnInfo();
    boardColumns = await schemaTable('boards').columnInfo();
    statusColumns = await schemaTable('statuses').columnInfo();
    priorityColumns = await schemaTable('priorities').columnInfo();
    assetColumns = await schemaTable('assets').columnInfo();
    ticketColumns = await schemaTable('tickets').columnInfo();
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
    }
    tenantsToCleanup.clear();
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  // ---- Ticket categories (the original 500) ----

  it('creates and lists ticket categories against the categories table', async () => {
    const fixture = await createFixture();
    const service = new CategoryService();
    injectDb(service, fixture);

    const created = await service.createTicketCategory(
      { category_name: 'General Support', board_id: fixture.boardId },
      context(fixture),
    );

    expect(created.category_id).toBeTruthy();
    expect(created.category_name).toBe('General Support');
    // display_order is NOT NULL with no default; service must populate it.
    expect(created.display_order).toBe(0);

    // Row landed in `categories`, not the non-existent `ticket_categories`.
    const persisted = await tenantTable(fixture.tenantId, 'categories')
      .where({ category_id: created.category_id })
      .first();
    expect(persisted).toBeDefined();

    const listed = await service.listTicketCategories({ board_id: fixture.boardId }, context(fixture));
    expect(listed.total).toBe(1);
    expect(listed.data[0].category_id).toBe(created.category_id);

    const fetched = await service.getTicketCategoryById(created.category_id, context(fixture));
    expect(fetched?.category_id).toBe(created.category_id);
  }, HOOK_TIMEOUT);

  it('appends display_order for sibling categories on the same board', async () => {
    const fixture = await createFixture();
    const service = new CategoryService();
    injectDb(service, fixture);

    const first = await service.createTicketCategory(
      { category_name: 'First', board_id: fixture.boardId },
      context(fixture),
    );
    const second = await service.createTicketCategory(
      { category_name: 'Second', board_id: fixture.boardId },
      context(fixture),
    );

    expect(first.display_order).toBe(0);
    expect(second.display_order).toBe(1);
  }, HOOK_TIMEOUT);

  // ---- Reading asset<->ticket links ----

  it('reads an asset<->ticket link from both directions', async () => {
    const fixture = await createFixture();
    await tenantTable(fixture.tenantId, 'asset_associations').insert({
      tenant: fixture.tenantId,
      asset_id: fixture.assetId,
      entity_id: fixture.ticketId,
      entity_type: 'ticket',
      relationship_type: 'affected',
      created_by: fixture.userId,
      created_at: new Date().toISOString(),
    });

    const assetService = new AssetService();
    injectDb(assetService, fixture);
    const tickets = await assetService.getAssetTickets(fixture.assetId, context(fixture));
    expect(tickets).toHaveLength(1);
    expect(tickets[0].ticket_id).toBe(fixture.ticketId);
    expect(tickets[0].status_name).toBe('Open');
    expect(tickets[0].relationship_type).toBe('affected');

    const ticketService = new TicketService();
    injectDb(ticketService, fixture);
    const assets = await ticketService.getTicketAssets(fixture.ticketId, context(fixture));
    expect(assets).toHaveLength(1);
    expect(assets[0].asset_id).toBe(fixture.assetId);
    expect(assets[0].client_name).toBe(`Client ${fixture.tenantId.slice(0, 8)}`);
  }, HOOK_TIMEOUT);

  // ---- Writing asset<->ticket links (new endpoints) ----

  it('links and unlinks a ticket from the asset side', async () => {
    const fixture = await createFixture();
    const assetService = new AssetService();
    injectDb(assetService, fixture);

    const created = await assetService.linkTicket(
      fixture.assetId,
      { ticket_id: fixture.ticketId, notes: 'from asset' },
      context(fixture),
    );
    expect(created.entity_type).toBe('ticket');
    expect(created.relationship_type).toBe('affected');

    const row = await tenantTable(fixture.tenantId, 'asset_associations')
      .where({ asset_id: fixture.assetId, entity_id: fixture.ticketId, entity_type: 'ticket' })
      .first();
    expect(row).toBeDefined();
    expect(row.notes).toBe('from asset');

    // Duplicate link is rejected.
    await expect(
      assetService.linkTicket(fixture.assetId, { ticket_id: fixture.ticketId }, context(fixture)),
    ).rejects.toThrow(/already linked/i);

    await assetService.unlinkTicket(fixture.assetId, fixture.ticketId, context(fixture));
    const afterDelete = await tenantTable(fixture.tenantId, 'asset_associations')
      .where({ asset_id: fixture.assetId, entity_id: fixture.ticketId })
      .first();
    expect(afterDelete).toBeUndefined();

    // Unlinking a missing association is a 404.
    await expect(
      assetService.unlinkTicket(fixture.assetId, fixture.ticketId, context(fixture)),
    ).rejects.toThrow(/not found/i);
  }, HOOK_TIMEOUT);

  it('links and unlinks an asset from the ticket side', async () => {
    const fixture = await createFixture();
    const ticketService = new TicketService();
    injectDb(ticketService, fixture);

    const created = await ticketService.linkAsset(
      fixture.ticketId,
      { asset_id: fixture.assetId, relationship_type: 'related' },
      context(fixture),
    );
    expect(created.entity_id).toBe(fixture.ticketId);
    expect(created.relationship_type).toBe('related');

    await expect(
      ticketService.linkAsset(fixture.ticketId, { asset_id: fixture.assetId }, context(fixture)),
    ).rejects.toThrow(/already linked/i);

    await ticketService.unlinkAsset(fixture.ticketId, fixture.assetId, context(fixture));
    const afterDelete = await tenantTable(fixture.tenantId, 'asset_associations')
      .where({ asset_id: fixture.assetId, entity_id: fixture.ticketId })
      .first();
    expect(afterDelete).toBeUndefined();
  }, HOOK_TIMEOUT);

  it('rejects linking a ticket/asset that does not exist', async () => {
    const fixture = await createFixture();
    const assetService = new AssetService();
    injectDb(assetService, fixture);

    await expect(
      assetService.linkTicket(fixture.assetId, { ticket_id: uuidv4() }, context(fixture)),
    ).rejects.toThrow(/not found/i);
  }, HOOK_TIMEOUT);
});
