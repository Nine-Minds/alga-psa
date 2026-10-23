import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { BaseService, UnsupportedRangeFilterError, tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

import { ClientService } from '@/lib/api/services/ClientService';
import { ContactService } from '@/lib/api/services/ContactService';
import { TicketService } from '@/lib/api/services/TicketService';
import { ProjectService } from '@/lib/api/services/ProjectService';
import { InvoiceService } from '@/lib/api/services/InvoiceService';
import { FinancialService } from '@/lib/api/services/FinancialService';
import { ContractLineService } from '@/lib/api/services/ContractLineService';
import { AssetService } from '@/lib/api/services/AssetService';
import { PermissionRoleService } from '@/lib/api/services/PermissionRoleService';
import { TeamService } from '@/lib/api/services/TeamService';
import { TimeEntryService } from '@/lib/api/services/TimeEntryService';
import { TimeSheetService } from '@/lib/api/services/TimeSheetService';

// The common list schema (schemas/common.ts baseFilterSchema) advertises
// created_from/created_to/updated_from/updated_to on every resource built on it.
// This suite proves each BaseService-backed list either filters against a real
// column or rejects the key loudly (never silently returns unfiltered rows).

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
  await tenantTable(tenantId, 'time_entries').del();
  await tenantTable(tenantId, 'tickets').del();
  await tenantTable(tenantId, 'invoices').del();
  await tenantTable(tenantId, 'projects').del();
  await tenantTable(tenantId, 'assets').del();
  await tenantTable(tenantId, 'contract_lines').del();
  await tenantTable(tenantId, 'contacts').del();
  await tenantTable(tenantId, 'teams').del();
  await tenantTable(tenantId, 'roles').del();
  await tenantTable(tenantId, 'statuses').del();
  await tenantTable(tenantId, 'clients').del();
  await tenantTable(tenantId, 'users').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

async function createTenant(): Promise<string> {
  const tenantId = uuidv4();
  tenantsToCleanup.add(tenantId);
  await tenantRows().insert({
    tenant: tenantId,
    client_name: `Range Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
  });
  return tenantId;
}

async function createClient(tenantId: string): Promise<string> {
  const clientId = uuidv4();
  await tenantTable(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Client ${clientId.slice(0, 8)}`,
  });
  return clientId;
}

async function createUser(tenantId: string): Promise<string> {
  const userId = uuidv4();
  await tenantTable(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `user-${userId.slice(0, 8)}`,
    hashed_password: 'x',
    email: `user-${userId.slice(0, 8)}@example.com`,
  });
  return userId;
}

function contextFor(tenantId: string) {
  return { tenant: tenantId, userId: uuidv4() } as any;
}

function service<T>(Ctor: new () => T, tenantId: string): T {
  const instance = new Ctor();
  vi.spyOn(instance as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
  return instance;
}

const ids = (rows: any[], column: string) => rows.map((row) => row[column]);

// A timestamp safely before/after a row's own timestamp, one minute apart.
const before = (value: unknown) => new Date(new Date(value as any).getTime() - 60_000).toISOString();
const after = (value: unknown) => new Date(new Date(value as any).getTime() + 60_000).toISOString();

interface SupportedCase {
  name: string;
  table: string;
  idColumn: string;
  createdColumn: string;
  updatedColumn: string;
  insert: (tenantId: string, fixtures: { clientId: string; userId: string }) => Promise<string>;
  listIds: (tenantId: string, filters: Record<string, unknown>) => Promise<string[]>;
}

const supportedCases: SupportedCase[] = [
  {
    name: 'clients',
    table: 'clients',
    idColumn: 'client_id',
    createdColumn: 'created_at',
    updatedColumn: 'updated_at',
    insert: (tenantId) => createClient(tenantId),
    listIds: async (tenantId, filters) => {
      const result = await service(ClientService, tenantId).list({ page: 1, limit: 100, filters }, contextFor(tenantId));
      return ids(result.data, 'client_id');
    },
  },
  {
    name: 'contacts',
    table: 'contacts',
    idColumn: 'contact_name_id',
    createdColumn: 'created_at',
    updatedColumn: 'updated_at',
    insert: async (tenantId, fixtures) => {
      const contactId = uuidv4();
      await tenantTable(tenantId, 'contacts').insert({
        tenant: tenantId,
        contact_name_id: contactId,
        full_name: `Contact ${contactId.slice(0, 8)}`,
        client_id: fixtures.clientId,
      });
      return contactId;
    },
    listIds: async (tenantId, filters) => {
      const result = await service(ContactService, tenantId).list({ page: 1, limit: 100, filters }, contextFor(tenantId));
      return ids(result.data, 'contact_name_id');
    },
  },
  {
    name: 'tickets (created_at is entered_at)',
    table: 'tickets',
    idColumn: 'ticket_id',
    createdColumn: 'entered_at',
    updatedColumn: 'updated_at',
    insert: async (tenantId, fixtures) => {
      const ticketId = uuidv4();
      await tenantTable(tenantId, 'tickets').insert({
        tenant: tenantId,
        ticket_id: ticketId,
        ticket_number: `T-${ticketId.slice(0, 8)}`,
        client_id: fixtures.clientId,
        entered_at: db.fn.now(),
      });
      return ticketId;
    },
    listIds: async (tenantId, filters) => {
      const result = await service(TicketService, tenantId).list({ page: 1, limit: 100, filters }, contextFor(tenantId));
      return ids(result.data, 'ticket_id');
    },
  },
  {
    name: 'projects',
    table: 'projects',
    idColumn: 'project_id',
    createdColumn: 'created_at',
    updatedColumn: 'updated_at',
    insert: async (tenantId, fixtures) => {
      const projectId = uuidv4();
      const statusId = uuidv4();
      await tenantTable(tenantId, 'statuses').insert({
        tenant: tenantId,
        status_id: statusId,
        name: 'Open',
        status_type: 'project',
        order_number: 1,
        item_type: 'project',
      });
      await tenantTable(tenantId, 'projects').insert({
        tenant: tenantId,
        project_id: projectId,
        project_name: `Project ${projectId.slice(0, 8)}`,
        status: statusId,
        wbs_code: projectId.slice(0, 8),
        client_id: fixtures.clientId,
        project_number: `P-${projectId.slice(0, 8)}`,
      });
      return projectId;
    },
    listIds: async (tenantId, filters) => {
      const result = await service(ProjectService, tenantId).list(
        { page: 1, limit: 100, filters },
        contextFor(tenantId),
        filters as any,
      );
      return ids(result.data, 'project_id');
    },
  },
  {
    name: 'invoices',
    table: 'invoices',
    idColumn: 'invoice_id',
    createdColumn: 'created_at',
    updatedColumn: 'updated_at',
    insert: async (tenantId, fixtures) => {
      const invoiceId = uuidv4();
      await tenantTable(tenantId, 'invoices').insert({
        tenant: tenantId,
        invoice_id: invoiceId,
        invoice_number: `INV-${invoiceId.slice(0, 8)}`,
        invoice_date: '2026-01-01',
        due_date: '2026-01-31',
        total_amount: 1000,
        status: 'draft',
        client_id: fixtures.clientId,
      });
      return invoiceId;
    },
    listIds: async (tenantId, filters) => {
      const result = await service(InvoiceService, tenantId).list(
        { page: 1, limit: 100 },
        contextFor(tenantId),
        filters as any,
      );
      return ids(result.data, 'invoice_id');
    },
  },
  {
    name: 'financial invoices (FinancialService.listInvoices)',
    table: 'invoices',
    idColumn: 'invoice_id',
    createdColumn: 'created_at',
    updatedColumn: 'updated_at',
    insert: async (tenantId, fixtures) => {
      const invoiceId = uuidv4();
      await tenantTable(tenantId, 'invoices').insert({
        tenant: tenantId,
        invoice_id: invoiceId,
        invoice_number: `FIN-${invoiceId.slice(0, 8)}`,
        invoice_date: '2026-01-01',
        due_date: '2026-01-31',
        total_amount: 1000,
        status: 'draft',
        client_id: fixtures.clientId,
      });
      return invoiceId;
    },
    listIds: async (tenantId, filters) => {
      const result = await service(FinancialService, tenantId).listInvoices(
        { page: 1, limit: 100, ...filters } as any,
        contextFor(tenantId),
      );
      return (result.data as any[]).map((row) => row.data.invoice_id);
    },
  },
  {
    name: 'contract lines',
    table: 'contract_lines',
    idColumn: 'contract_line_id',
    createdColumn: 'created_at',
    updatedColumn: 'updated_at',
    insert: async (tenantId) => {
      const lineId = uuidv4();
      await tenantTable(tenantId, 'contract_lines').insert({
        tenant: tenantId,
        contract_line_id: lineId,
        contract_line_name: `Line ${lineId.slice(0, 8)}`,
      });
      return lineId;
    },
    listIds: async (tenantId, filters) => {
      const result = await service(ContractLineService, tenantId).list({ page: 1, limit: 100, filters }, contextFor(tenantId));
      return ids(result.data, 'contract_line_id');
    },
  },
  {
    name: 'assets',
    table: 'assets',
    idColumn: 'asset_id',
    createdColumn: 'created_at',
    updatedColumn: 'updated_at',
    insert: async (tenantId, fixtures) => {
      const assetId = uuidv4();
      await tenantTable(tenantId, 'assets').insert({
        tenant: tenantId,
        asset_id: assetId,
        asset_tag: `A-${assetId.slice(0, 8)}`,
        name: `Asset ${assetId.slice(0, 8)}`,
        status: 'active',
        client_id: fixtures.clientId,
      });
      return assetId;
    },
    listIds: async (tenantId, filters) => {
      const result = await service(AssetService, tenantId).list({ page: 1, limit: 100 }, contextFor(tenantId), filters as any);
      return ids(result.data, 'asset_id');
    },
  },
  {
    name: 'roles',
    table: 'roles',
    idColumn: 'role_id',
    createdColumn: 'created_at',
    updatedColumn: 'updated_at',
    insert: async (tenantId) => {
      const roleId = uuidv4();
      await tenantTable(tenantId, 'roles').insert({ tenant: tenantId, role_id: roleId, role_name: `Role ${roleId.slice(0, 8)}` });
      return roleId;
    },
    listIds: async (tenantId, filters) => {
      const result = await service(PermissionRoleService, tenantId).list({ page: 1, limit: 100, filters }, contextFor(tenantId));
      return ids(result.data, 'role_id');
    },
  },
  {
    name: 'teams',
    table: 'teams',
    idColumn: 'team_id',
    createdColumn: 'created_at',
    updatedColumn: 'updated_at',
    insert: async (tenantId) => {
      const teamId = uuidv4();
      await tenantTable(tenantId, 'teams').insert({ tenant: tenantId, team_id: teamId, team_name: `Team ${teamId.slice(0, 8)}` });
      return teamId;
    },
    listIds: async (tenantId, filters) => {
      const result = await service(TeamService, tenantId).list({ page: 1, limit: 100, filters }, contextFor(tenantId));
      return ids(result.data, 'team_id');
    },
  },
  {
    name: 'time entries',
    table: 'time_entries',
    idColumn: 'entry_id',
    createdColumn: 'created_at',
    updatedColumn: 'updated_at',
    insert: async (tenantId, fixtures) => {
      const entryId = uuidv4();
      await tenantTable(tenantId, 'time_entries').insert({
        tenant: tenantId,
        entry_id: entryId,
        user_id: fixtures.userId,
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        work_date: '2026-01-01',
        work_timezone: 'UTC',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
      return entryId;
    },
    listIds: async (tenantId, filters) => {
      const result = await service(TimeEntryService, tenantId).list({ page: 1, limit: 100, filters }, contextFor(tenantId));
      return ids(result.data, 'entry_id');
    },
  },
];

describe('list range filters across BaseService-backed resources (real schema)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
    }
    tenantsToCleanup.clear();
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it.each(supportedCases)(
    'filters $name by created_from/created_to/updated_from/updated_to',
    async (testCase) => {
      const tenantId = await createTenant();
      const clientId = await createClient(tenantId);
      const userId = await createUser(tenantId);
      const rowId = await testCase.insert(tenantId, { clientId, userId });

      const row = await tenantTable(tenantId, testCase.table)
        .where({ [testCase.idColumn]: rowId })
        .first();
      expect(row, `${testCase.name} row should exist`).toBeTruthy();

      const created = row[testCase.createdColumn];
      const updated = row[testCase.updatedColumn];

      // created_from bounds.
      expect(await testCase.listIds(tenantId, { created_from: before(created) })).toContain(rowId);
      expect(await testCase.listIds(tenantId, { created_from: after(created) })).not.toContain(rowId);
      // created_to bounds.
      expect(await testCase.listIds(tenantId, { created_to: after(created) })).toContain(rowId);
      expect(await testCase.listIds(tenantId, { created_to: before(created) })).not.toContain(rowId);

      // updated_from / updated_to bounds.
      expect(await testCase.listIds(tenantId, { updated_from: before(updated) })).toContain(rowId);
      expect(await testCase.listIds(tenantId, { updated_from: after(updated) })).not.toContain(rowId);
      expect(await testCase.listIds(tenantId, { updated_to: after(updated) })).toContain(rowId);
      expect(await testCase.listIds(tenantId, { updated_to: before(updated) })).not.toContain(rowId);
    },
    60_000,
  );

  it('rejects range keys the resource cannot support instead of dropping them', async () => {
    const tenantId = await createTenant();
    const context = contextFor(tenantId);

    // time_sheets has no created_at/updated_at. Its list reads filters from the
    // third argument (not options.filters).
    const timeSheets = service(TimeSheetService, tenantId);
    await expect(timeSheets.list({ page: 1, limit: 10 }, context, { created_from: '2026-01-01' } as any))
      .rejects.toBeInstanceOf(UnsupportedRangeFilterError);

    // A key explicitly declared unsupported (null) must be rejected loudly.
    class BareService extends BaseService<any> {
      constructor() {
        super({ tableName: 'clients', primaryKey: 'client_id' });
      }
      protected rangeFilterColumns(): Record<string, string | null> {
        return { ...super.rangeFilterColumns(), purchase_date_from: null };
      }
    }
    const bare = service(BareService, tenantId);
    await expect(bare.list({ page: 1, limit: 10, filters: { purchase_date_from: '2026-01-01' } }, context))
      .rejects.toBeInstanceOf(UnsupportedRangeFilterError);
  });

  // Regression: `assigned_to` ends in `_to` but is a plain column filter, not a
  // range filter. It must filter, not be rejected as an unknown range key.
  it('applies assigned_to on projects instead of rejecting it as a range key', async () => {
    const tenantId = await createTenant();
    const clientId = await createClient(tenantId);
    const userId = await createUser(tenantId);
    const statusId = uuidv4();
    await tenantTable(tenantId, 'statuses').insert({
      tenant: tenantId,
      status_id: statusId,
      name: 'Open',
      status_type: 'project',
      order_number: 1,
      item_type: 'project',
    });

    const insertProject = (projectId: string, assignedTo: string | null) =>
      tenantTable(tenantId, 'projects').insert({
        tenant: tenantId,
        project_id: projectId,
        project_name: `Project ${projectId.slice(0, 8)}`,
        status: statusId,
        wbs_code: projectId.slice(0, 8),
        client_id: clientId,
        project_number: `P-${projectId.slice(0, 8)}`,
        assigned_to: assignedTo,
      });

    const assignedProjectId = uuidv4();
    const unassignedProjectId = uuidv4();
    await insertProject(assignedProjectId, userId);
    await insertProject(unassignedProjectId, null);

    const result = await service(ProjectService, tenantId).list(
      { page: 1, limit: 100 },
      contextFor(tenantId),
      { assigned_to: userId } as any,
    );
    const returned = ids(result.data, 'project_id');
    expect(returned).toContain(assignedProjectId);
    expect(returned).not.toContain(unassignedProjectId);
  });

  // The only asset `_to` filters are mapped date ranges; confirm one still works.
  it('applies asset purchase_date_to instead of rejecting it', async () => {
    const tenantId = await createTenant();
    const clientId = await createClient(tenantId);
    const assetId = uuidv4();
    await tenantTable(tenantId, 'assets').insert({
      tenant: tenantId,
      asset_id: assetId,
      asset_tag: `A-${assetId.slice(0, 8)}`,
      name: `Asset ${assetId.slice(0, 8)}`,
      status: 'active',
      client_id: clientId,
      purchase_date: '2026-01-15',
    });

    const included = await service(AssetService, tenantId).list(
      { page: 1, limit: 100 },
      contextFor(tenantId),
      { purchase_date_to: '2026-02-01' } as any,
    );
    expect(ids(included.data, 'asset_id')).toContain(assetId);

    const excluded = await service(AssetService, tenantId).list(
      { page: 1, limit: 100 },
      contextFor(tenantId),
      { purchase_date_to: '2026-01-01' } as any,
    );
    expect(ids(excluded.data, 'asset_id')).not.toContain(assetId);
  });
});
