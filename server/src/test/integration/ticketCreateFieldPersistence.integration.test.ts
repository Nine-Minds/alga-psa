import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { TicketModel } from '@shared/models/ticketModel';

const HOOK_TIMEOUT = 180_000;

type ColumnInfoMap = Record<string, unknown>;

type TicketFieldFixture = {
  tenantId: string;
  userId: string;
  clientId: string;
  boardId: string;
  statusId: string;
  priorityId: string;
  severityId: string;
  urgencyId: string;
  impactId: string;
  url: string;
};

let db: Knex;
const tenantsToCleanup = new Set<string>();
let tenantColumns: ColumnInfoMap;
let userColumns: ColumnInfoMap;
let boardColumns: ColumnInfoMap;
let clientColumns: ColumnInfoMap;
let statusColumns: ColumnInfoMap;
let priorityColumns: ColumnInfoMap;
let classificationColumns: ColumnInfoMap;

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

async function cleanupTenant(tenantId: string): Promise<void> {
  await tenantTable(tenantId, 'tickets').del();
  await tenantTable(tenantId, 'next_number').del();
  await tenantTable(tenantId, 'severities').del();
  await tenantTable(tenantId, 'urgencies').del();
  await tenantTable(tenantId, 'impacts').del();
  await tenantTable(tenantId, 'statuses').del();
  await tenantTable(tenantId, 'priorities').del();
  await tenantTable(tenantId, 'boards').del();
  await tenantTable(tenantId, 'clients').del();
  await tenantTable(tenantId, 'users').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

async function insertTenantAndUser(tenantId: string, userId: string): Promise<string> {
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
    ...(hasColumn(userColumns, 'role') ? { role: 'admin' } : {}),
    ...(hasColumn(userColumns, 'email') ? { email: `user-${tenantId.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn(userColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(userColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  return userId;
}

async function insertClassification(
  tenantId: string,
  userId: string,
  table: 'severities' | 'urgencies' | 'impacts',
  idColumn: 'severity_id' | 'urgency_id' | 'impact_id',
  nameColumn: 'severity_name' | 'urgency_name' | 'impact_name',
  id: string,
): Promise<string> {
  await tenantTable(tenantId, table).insert({
    tenant: tenantId,
    [idColumn]: id,
    [nameColumn]: `${table}-${id.slice(0, 8)}`,
    ...(hasColumn(classificationColumns, 'created_by') ? { created_by: userId } : {}),
    ...(hasColumn(classificationColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
  });
  return id;
}

async function createFixture(): Promise<TicketFieldFixture> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const clientId = uuidv4();
  const boardId = uuidv4();
  const statusId = uuidv4();
  const priorityId = uuidv4();
  const severityId = uuidv4();
  const urgencyId = uuidv4();
  const impactId = uuidv4();

  await insertTenantAndUser(tenantId, userId);

  await tenantTable(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Client ${tenantId.slice(0, 8)}`,
    ...(hasColumn(clientColumns, 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
    ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
    ...(hasColumn(clientColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(clientColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'boards').insert({
    tenant: tenantId,
    board_id: boardId,
    board_name: 'Support',
    ...(hasColumn(boardColumns, 'description') ? { description: 'Support board' } : {}),
    ...(hasColumn(boardColumns, 'display_order') ? { display_order: 10 } : {}),
    ...(hasColumn(boardColumns, 'is_default') ? { is_default: true } : {}),
    ...(hasColumn(boardColumns, 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn(boardColumns, 'is_active') ? { is_active: true } : {}),
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
    ...(hasColumn(priorityColumns, 'updated_by') ? { updated_by: userId } : {}),
    ...(hasColumn(priorityColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(priorityColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'statuses').insert({
    tenant: tenantId,
    status_id: statusId,
    ...(hasColumn(statusColumns, 'board_id') ? { board_id: boardId } : {}),
    name: 'Support Open',
    ...(hasColumn(statusColumns, 'status_type') ? { status_type: 'ticket' } : {}),
    ...(hasColumn(statusColumns, 'item_type') ? { item_type: 'ticket' } : {}),
    is_closed: false,
    is_default: true,
    order_number: 10,
    created_by: userId,
    ...(hasColumn(statusColumns, 'is_custom') ? { is_custom: true } : {}),
    ...(hasColumn(statusColumns, 'standard_status_id') ? { standard_status_id: null } : {}),
    ...(hasColumn(statusColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(statusColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await insertClassification(tenantId, userId, 'severities', 'severity_id', 'severity_name', severityId);
  await insertClassification(tenantId, userId, 'urgencies', 'urgency_id', 'urgency_name', urgencyId);
  await insertClassification(tenantId, userId, 'impacts', 'impact_id', 'impact_name', impactId);

  return {
    tenantId,
    userId,
    clientId,
    boardId,
    statusId,
    priorityId,
    severityId,
    urgencyId,
    impactId,
    url: `https://support.example.com/tickets/${tenantId.slice(0, 8)}`,
  };
}

describe('Ticket create field persistence integration', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
    tenantColumns = await schemaTable('tenants').columnInfo();
    userColumns = await schemaTable('users').columnInfo();
    boardColumns = await schemaTable('boards').columnInfo();
    clientColumns = await schemaTable('clients').columnInfo();
    statusColumns = await schemaTable('statuses').columnInfo();
    priorityColumns = await schemaTable('priorities').columnInfo();
    classificationColumns = await schemaTable('severities').columnInfo();
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

  it('persists and returns url, severity_id, urgency_id and impact_id through shared createTicket', async () => {
    const fixture = await createFixture();

    const created = await db.transaction(async (trx) => {
      return TicketModel.createTicket(
        {
          title: 'Classification persistence',
          description: 'Created with all four optional fields',
          client_id: fixture.clientId,
          board_id: fixture.boardId,
          status_id: fixture.statusId,
          priority_id: fixture.priorityId,
          entered_by: fixture.userId,
          url: fixture.url,
          severity_id: fixture.severityId,
          urgency_id: fixture.urgencyId,
          impact_id: fixture.impactId,
        },
        fixture.tenantId,
        trx,
      );
    });

    expect(created.url).toBe(fixture.url);
    expect(created.severity_id).toBe(fixture.severityId);
    expect(created.urgency_id).toBe(fixture.urgencyId);
    expect(created.impact_id).toBe(fixture.impactId);

    const stored = await tenantTable(fixture.tenantId, 'tickets')
      .where({ ticket_id: created.ticket_id })
      .first('url', 'severity_id', 'urgency_id', 'impact_id', 'title');

    expect(stored).toMatchObject({
      url: fixture.url,
      severity_id: fixture.severityId,
      urgency_id: fixture.urgencyId,
      impact_id: fixture.impactId,
      title: 'Classification persistence',
    });
  }, HOOK_TIMEOUT);

  it('stores nulls while preserving identity, default status and description when the fields are omitted', async () => {
    const fixture = await createFixture();

    const created = await db.transaction(async (trx) => {
      return TicketModel.createTicket(
        {
          title: 'Omitted classification',
          description: 'No optional fields supplied',
          client_id: fixture.clientId,
          board_id: fixture.boardId,
          priority_id: fixture.priorityId,
          entered_by: fixture.userId,
        },
        fixture.tenantId,
        trx,
      );
    });

    expect(created.url).toBeNull();
    expect(created.severity_id).toBeNull();
    expect(created.urgency_id).toBeNull();
    expect(created.impact_id).toBeNull();

    const stored = await tenantTable(fixture.tenantId, 'tickets')
      .where({ ticket_id: created.ticket_id })
      .first();

    expect(stored).toMatchObject({
      url: null,
      severity_id: null,
      urgency_id: null,
      impact_id: null,
      status_id: fixture.statusId,
    });
    expect(stored.ticket_number).toBeTruthy();
    expect(stored.attributes).toMatchObject({ description: 'No optional fields supplied' });
  }, HOOK_TIMEOUT);

  it('rejects a classification reference that belongs to another tenant and leaves no ticket behind', async () => {
    const fixture = await createFixture();
    const foreignTenantId = uuidv4();
    const foreignUserId = uuidv4();
    await insertTenantAndUser(foreignTenantId, foreignUserId);
    const foreignSeverityId = uuidv4();
    await insertClassification(
      foreignTenantId,
      foreignUserId,
      'severities',
      'severity_id',
      'severity_name',
      foreignSeverityId,
    );

    await expect(
      db.transaction(async (trx) => {
        await TicketModel.createTicket(
          {
            title: 'Foreign classification',
            client_id: fixture.clientId,
            board_id: fixture.boardId,
            status_id: fixture.statusId,
            priority_id: fixture.priorityId,
            entered_by: fixture.userId,
            severity_id: foreignSeverityId,
          },
          fixture.tenantId,
          trx,
        );
      }),
    ).rejects.toThrow();

    const tickets = await tenantTable(fixture.tenantId, 'tickets');
    expect(tickets).toHaveLength(0);
  }, HOOK_TIMEOUT);

  it('rejects an empty classification string through the shared create path and leaves no ticket', async () => {
    const fixture = await createFixture();

    await expect(
      db.transaction(async (trx) => {
        await TicketModel.createTicket(
          {
            title: 'Empty classification',
            client_id: fixture.clientId,
            board_id: fixture.boardId,
            status_id: fixture.statusId,
            priority_id: fixture.priorityId,
            entered_by: fixture.userId,
            severity_id: '',
          },
          fixture.tenantId,
          trx,
        );
      }),
    ).rejects.toThrow(/severity_id/);

    const tickets = await tenantTable(fixture.tenantId, 'tickets');
    expect(tickets).toHaveLength(0);
  }, HOOK_TIMEOUT);

  it('keeps a supplied empty url consistent between the return value and the stored row', async () => {
    const fixture = await createFixture();

    const created = await db.transaction(async (trx) => {
      return TicketModel.createTicket(
        {
          title: 'Empty url',
          client_id: fixture.clientId,
          board_id: fixture.boardId,
          status_id: fixture.statusId,
          priority_id: fixture.priorityId,
          entered_by: fixture.userId,
          url: '',
        },
        fixture.tenantId,
        trx,
      );
    });

    expect(created.url).toBe('');

    const stored = await tenantTable(fixture.tenantId, 'tickets')
      .where({ ticket_id: created.ticket_id })
      .first('url');
    expect(stored.url).toBe('');
  }, HOOK_TIMEOUT);
});
