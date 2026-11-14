// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  currentUser: null as any,
  tenant: 'tenant-1',
  permissions: new Set<string>(),
  visibleTickets: new Set<string>(),
  ticketMaterial: null as { tenant: string; ticket_material_id: string; ticket_id: string } | null,
  permission: vi.fn(),
  createTenantKnex: vi.fn(),
  withTransaction: vi.fn(),
  tenantDb: vi.fn(),
  queryTenant: undefined as string | undefined,
  authorizeTicket: vi.fn(),
  addMaterial: vi.fn(),
  deleteMaterial: vi.fn(),
  listMaterials: vi.fn(),
  queryCatalog: vi.fn(),
  queryPrices: vi.fn(),
  queryAvailable: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(h.currentUser, { tenant: h.tenant }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: (...args: any[]) => h.permission(...args) }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => h.createTenantKnex(...args),
  withTransaction: (...args: any[]) => h.withTransaction(...args),
  tenantDb: (...args: any[]) => h.tenantDb(...args),
}));
vi.mock('@alga-psa/inventory/lib', () => ({
  addMaterial: (...args: any[]) => h.addMaterial(...args),
  deleteMaterial: (...args: any[]) => h.deleteMaterial(...args),
  listMaterials: (...args: any[]) => h.listMaterials(...args),
  MaterialValidationError: class MaterialValidationError extends Error {},
  queryAvailableStockUnits: (...args: any[]) => h.queryAvailable(...args),
  queryCatalogPickerItems: (...args: any[]) => h.queryCatalog(...args),
  queryServicePrices: (...args: any[]) => h.queryPrices(...args),
}));
vi.mock('@alga-psa/inventory/lib/consume', () => ({
  InsufficientStockError: class InsufficientStockError extends Error {},
  stockConflictResultFrom: () => null,
}));
vi.mock('../lib/ticketRecordAuthorization', () => ({
  authorizeTicketRecordAccess: (...args: any[]) => h.authorizeTicket(...args),
}));

import {
  addTicketMaterial,
  deleteTicketMaterial,
  getServicePrices,
  listTicketMaterials,
  searchServiceCatalogForPicker,
} from './materialCatalogActions';

const ticketMaterialId = 'material-1';

function user(user_type: string = 'internal') {
  return { user_id: 'user-1', user_type, tenant: h.tenant };
}

function setPermission(resource: string, action: string, allowed: boolean) {
  const key = `${resource}:${action}`;
  if (allowed) h.permissions.add(key);
  else h.permissions.delete(key);
}

function materialQuery(table: string) {
  let tenantFilter: string | undefined;
  let materialFilter: string | undefined;
  const builder: any = {
    where: (values: Record<string, string>) => {
      tenantFilter = values.tenant ?? h.queryTenant;
      materialFilter = values.ticket_material_id;
      return builder;
    },
    first: async () => {
      const material = h.ticketMaterial;
      if (table !== 'ticket_materials' || !material
        || material.tenant !== tenantFilter
        || material.ticket_material_id !== materialFilter) {
        return undefined;
      }
      return { ticket_id: material.ticket_id };
    },
  };
  return builder;
}

beforeEach(() => {
  h.currentUser = user();
  h.tenant = 'tenant-1';
  h.permissions = new Set(['ticket:read', 'ticket:update', 'service:read', 'inventory:read']);
  h.visibleTickets = new Set(['ticket-1']);
  h.ticketMaterial = { tenant: 'tenant-1', ticket_material_id: ticketMaterialId, ticket_id: 'ticket-1' };
  h.permission.mockReset().mockImplementation(async (_user: unknown, resource: string, action: string) =>
    h.permissions.has(`${resource}:${action}`));
  h.createTenantKnex.mockReset().mockResolvedValue({ knex: {} });
  h.withTransaction.mockReset().mockImplementation(async (_db: unknown, callback: (trx: any) => unknown) => {
    const trx: any = (table: string) => materialQuery(table);
    trx.commit = vi.fn();
    trx.rollback = vi.fn();
    return callback(trx);
  });
  h.tenantDb.mockReset().mockImplementation((conn: any, tenant: string) => ({
    table: (table: string) => {
      expect(tenant).toBe(h.tenant);
      h.queryTenant = tenant;
      return conn(table);
    },
  }));
  h.authorizeTicket.mockReset().mockImplementation(async ({ ticketId }: { ticketId: string }) => {
    if (!h.visibleTickets.has(ticketId)) throw new Error('Permission denied: Cannot access ticket');
    return { ticket_id: ticketId };
  });
  h.addMaterial.mockReset().mockResolvedValue({ ticket_material_id: 'material-new' });
  h.deleteMaterial.mockReset().mockResolvedValue(true);
  h.listMaterials.mockReset().mockResolvedValue([{ ticket_material_id: ticketMaterialId }]);
  h.queryCatalog.mockReset().mockResolvedValue({ items: [{ service_id: 'service-1', cost: 17, cost_currency: 'USD', free_total: 2 }], totalCount: 1 });
  h.queryPrices.mockReset().mockResolvedValue([{ service_id: 'service-1', price: 20 }]);
  h.queryAvailable.mockReset();
});

describe('material catalog action authorization', () => {
  it('denies clients catalog and price reads before reaching internal catalog queries', async () => {
    h.currentUser = user('client');
    expect(await searchServiceCatalogForPicker({})).toEqual({ items: [], totalCount: 0 });
    expect(await getServicePrices('service-1')).toEqual([]);
    expect(h.queryCatalog).not.toHaveBeenCalled();
    expect(h.queryPrices).not.toHaveBeenCalled();
  });

  it('requires both MSP catalog and inventory read permissions for both catalog entry points', async () => {
    setPermission('inventory', 'read', false);
    expect(await searchServiceCatalogForPicker({})).toEqual({ items: [], totalCount: 0 });
    expect(await getServicePrices('service-1')).toEqual([]);
    expect(h.queryCatalog).not.toHaveBeenCalled();
    expect(h.queryPrices).not.toHaveBeenCalled();
    setPermission('inventory', 'read', true);
    setPermission('service', 'read', false);
    expect(await searchServiceCatalogForPicker({})).toEqual({ items: [], totalCount: 0 });
    expect(await getServicePrices('service-1')).toEqual([]);
    expect(h.queryCatalog).not.toHaveBeenCalled();
    expect(h.queryPrices).not.toHaveBeenCalled();
  });

  it('returns internal catalog results to an MSP principal with both read permissions', async () => {
    await expect(searchServiceCatalogForPicker({})).resolves.toMatchObject({ totalCount: 1 });
    await expect(getServicePrices('service-1')).resolves.toEqual([{ service_id: 'service-1', price: 20 }]);
    expect(h.queryCatalog).toHaveBeenCalledTimes(1);
    expect(h.queryPrices).toHaveBeenCalledTimes(1);
  });

  it('denies clients protected material operations without invoking inventory mutations or reads', async () => {
    h.currentUser = user('client');
    const add = await addTicketMaterial({ ticket_id: 'ticket-1', client_id: 'client-1', service_id: 'service-1', quantity: 1, rate: 100, currency_code: 'USD' });
    const list = await listTicketMaterials('ticket-1');
    const remove = await deleteTicketMaterial(ticketMaterialId);
    expect(add).toHaveProperty('permissionError');
    expect(list).toHaveProperty('permissionError');
    expect(remove).toHaveProperty('permissionError');
    expect(h.addMaterial).not.toHaveBeenCalled();
    expect(h.deleteMaterial).not.toHaveBeenCalled();
    expect(h.listMaterials).not.toHaveBeenCalled();
  });

  it('requires the existing ticket read or update permission before touching protected material data', async () => {
    setPermission('ticket', 'update', false);
    expect(await addTicketMaterial({ ticket_id: 'ticket-1', client_id: 'client-1', service_id: 'service-1', quantity: 1, rate: 100, currency_code: 'USD' })).toHaveProperty('permissionError');
    expect(await deleteTicketMaterial(ticketMaterialId)).toHaveProperty('permissionError');
    setPermission('ticket', 'read', false);
    expect(await listTicketMaterials('ticket-1')).toHaveProperty('permissionError');
    expect(h.addMaterial).not.toHaveBeenCalled();
    expect(h.deleteMaterial).not.toHaveBeenCalled();
    expect(h.listMaterials).not.toHaveBeenCalled();
  });

  it('denies hidden ticket access and leaves material, stock, and asset operations untouched', async () => {
    h.visibleTickets.clear();
    const input = { ticket_id: 'hidden-ticket', client_id: 'client-1', service_id: 'service-1', quantity: 1, rate: 100, currency_code: 'USD' };
    expect(await addTicketMaterial(input)).toHaveProperty('permissionError');
    expect(await listTicketMaterials('hidden-ticket')).toHaveProperty('permissionError');
    expect(h.addMaterial).not.toHaveBeenCalled();
    expect(h.listMaterials).not.toHaveBeenCalled();
  });

  it('authorizes deletion against the actual tenant-scoped owning ticket', async () => {
    h.ticketMaterial = { tenant: 'tenant-1', ticket_material_id: ticketMaterialId, ticket_id: 'hidden-ticket' };
    h.visibleTickets.clear();
    expect(await deleteTicketMaterial(ticketMaterialId)).toHaveProperty('permissionError');
    expect(h.tenantDb).toHaveBeenCalledWith(expect.anything(), 'tenant-1');
    expect(h.authorizeTicket).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 'hidden-ticket', action: 'update', tenant: 'tenant-1' }));
    expect(h.deleteMaterial).not.toHaveBeenCalled();
  });

  it('does not resolve or delete a material from another tenant', async () => {
    h.ticketMaterial = { tenant: 'tenant-2', ticket_material_id: ticketMaterialId, ticket_id: 'ticket-2' };
    expect(await deleteTicketMaterial(ticketMaterialId)).toBeUndefined();
    expect(h.authorizeTicket).not.toHaveBeenCalled();
    expect(h.deleteMaterial).not.toHaveBeenCalled();
  });

  it('continues authorized MSP reads, adds, and deletes with the requested ticket', async () => {
    const input = { ticket_id: 'ticket-1', client_id: 'client-1', service_id: 'service-1', quantity: 1, rate: 100, currency_code: 'USD' };
    await expect(listTicketMaterials('ticket-1')).resolves.toEqual([{ ticket_material_id: ticketMaterialId }]);
    await expect(addTicketMaterial(input)).resolves.toEqual({ ticket_material_id: 'material-new' });
    await expect(deleteTicketMaterial(ticketMaterialId)).resolves.toBeUndefined();
    expect(h.authorizeTicket).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 'ticket-1', action: 'read', tenant: 'tenant-1' }));
    expect(h.authorizeTicket).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 'ticket-1', action: 'update', tenant: 'tenant-1' }));
    expect(h.addMaterial).toHaveBeenCalledTimes(1);
    expect(h.deleteMaterial).toHaveBeenCalledTimes(1);
    expect(h.listMaterials).toHaveBeenCalledTimes(1);
    expect(h.authorizeTicket.mock.calls[0][0].trx).toBe(h.listMaterials.mock.calls[0][0]);
    expect(h.authorizeTicket.mock.calls[1][0].trx).toBe(h.addMaterial.mock.calls[0][0]);
    expect(h.authorizeTicket.mock.calls[2][0].trx).toBe(h.deleteMaterial.mock.calls[0][0]);
    expect(h.listMaterials).toHaveBeenCalledWith(expect.anything(), h.tenant, 'ticket', 'ticket-1');
    expect(h.addMaterial).toHaveBeenCalledWith(expect.anything(), h.tenant,
      { ...input, parent_type: 'ticket', parent_id: 'ticket-1' }, h.currentUser.user_id);
    expect(h.deleteMaterial).toHaveBeenCalledWith(expect.anything(), h.tenant, 'ticket', ticketMaterialId, h.currentUser.user_id);
    [h.listMaterials, h.addMaterial, h.deleteMaterial].forEach((operation, index) => {
      expect(h.authorizeTicket.mock.invocationCallOrder[index]).toBeLessThan(operation.mock.invocationCallOrder[0]);
    });
  });
});
