import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  connect: vi.fn(),
  facade: vi.fn(),
  consume: vi.fn(),
  movement: vi.fn(),
  signal: vi.fn(),
  publish: vi.fn(),
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) => action({ user_id: 'technician' }, { tenant: 'tenant-a' }, ...args),
  hasPermission: mocks.permission,
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.permission }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.connect,
  tenantDb: mocks.facade,
  withTransaction: (_db: unknown, callback: (trx: object) => unknown) => callback({}),
}));
vi.mock('@alga-psa/inventory/lib', () => ({
  MaterialValidationError: class extends Error {},
  recordStockConsumption: mocks.consume,
  recordStockMovement: mocks.movement,
  collectStockLowSignalAfterConsume: mocks.signal,
  publishInventoryEvent: mocks.publish,
}));
vi.mock('@alga-psa/inventory/lib/consume', () => ({
  InsufficientStockError: class extends Error {},
  stockConflictResultFrom: vi.fn(),
}));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  CodedError: class extends Error {
    constructor(message: string, readonly code: string, readonly messageKey?: string) { super(message); }
  },
  actionError: (actionError: string, messageKey?: string) => ({ actionError, messageKey }),
  permissionError: (permissionError: string) => ({ permissionError }),
}));

import {
  addTicketFixedFeeService, deleteTicketFixedFeeService,
  listTicketFixedFeeServices, updateTicketFixedFeeService,
} from '@alga-psa/tickets/actions/ticketFixedFeeActions';
import { updateTicketMaterial } from '@alga-psa/tickets/actions/materialCatalogActions';

const ticketId = '123e4567-e89b-42d3-a456-426614174000';
const serviceId = '223e4567-e89b-42d3-a456-426614174000';
const entryId = '323e4567-e89b-42d3-a456-426614174000';

function query(row: Record<string, unknown> | undefined, rows: Record<string, unknown>[] = []) {
  const builder = {
    where: vi.fn(() => builder),
    whereIn: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    forUpdate: vi.fn(() => builder),
    forShare: vi.fn(() => builder),
    first: vi.fn(async () => row),
    select: vi.fn(async () => rows),
    insert: vi.fn(() => builder),
    returning: vi.fn(async () => [{ entry_id: entryId }]),
    update: vi.fn(async () => 1),
    delete: vi.fn(async () => 1),
  };
  return builder;
}

let tables: Record<string, ReturnType<typeof query>>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue(true);
  mocks.connect.mockResolvedValue({ knex: {} });
  mocks.consume.mockResolvedValue({ consumed: true });
  mocks.signal.mockResolvedValue(null);
  tables = {
    tickets: query({ client_id: 'client-a' }),
    service_catalog: query({ service_id: serviceId }),
    service_prices: query({ rate: '2500' }),
    ticket_fixed_fee_services: query({ rate: '2500', is_billed: false }),
    'ticket_fixed_fee_services as f': query(undefined, [{ entry_id: entryId }]),
    ticket_materials: query({
      service_id: serviceId, client_id: 'client-a', quantity: 4, rate: 2500, is_billed: false,
    }),
    product_inventory_settings: query({ track_stock: true, is_serialized: false }),
    stock_movements: query(undefined, [{
      movement_type: 'consume', quantity: 4, from_location_id: 'original-location',
      unit_id: null, cogs_cost: 1200, cost_currency: 'USD',
    }]),
  };
  mocks.facade.mockImplementation(() => ({
    table: (name: string) => {
      if (!tables[name]) throw new Error(`Unexpected table: ${name}`);
      return tables[name];
    },
    tenantJoin: vi.fn(),
  }));
});

describe('ticket fixed-fee actions', () => {
  const input = { ticket_id: ticketId, service_id: serviceId, quantity: 2, currency_code: 'USD', description: ' Setup ' };

  it('requires ticket update permission before accessing data', async () => {
    mocks.permission.mockResolvedValue(false);
    expect(await addTicketFixedFeeService(input)).toHaveProperty('permissionError');
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, 2147483648, NaN])('rejects invalid quantity %s', async (quantity) => {
    expect(await addTicketFixedFeeService({ ...input, quantity })).toHaveProperty('actionError');
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('uses the catalog currency price and derives client from the ticket', async () => {
    await addTicketFixedFeeService(input);
    expect(mocks.facade).toHaveBeenCalledWith({}, 'tenant-a');
    expect(tables.service_catalog.where).toHaveBeenCalledWith({
      service_id: serviceId, item_kind: 'service', billing_method: 'fixed', is_active: true,
    });
    expect(tables.service_prices.where).toHaveBeenCalledWith({ service_id: serviceId, currency_code: 'USD' });
    expect(tables.ticket_fixed_fee_services.insert).toHaveBeenCalledWith({
      tenant: 'tenant-a', ...input, client_id: 'client-a', rate: 2500, description: 'Setup',
    });
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it.each(['tickets', 'service_catalog', 'service_prices'])('refuses missing %s', async (table) => {
    tables[table].first.mockResolvedValue(undefined);
    expect(await addTicketFixedFeeService(input)).toHaveProperty('actionError');
    expect(tables.ticket_fixed_fee_services.insert).not.toHaveBeenCalled();
  });

  it('lists only the requested ticket through the tenant facade', async () => {
    expect(await listTicketFixedFeeServices(ticketId)).toEqual([{ entry_id: entryId }]);
    expect(tables['ticket_fixed_fee_services as f'].where).toHaveBeenCalledWith('f.ticket_id', ticketId);
  });

  it('conditionally deletes only unbilled entries', async () => {
    tables.ticket_fixed_fee_services.delete.mockResolvedValue(0);
    expect(await deleteTicketFixedFeeService(entryId)).toHaveProperty('actionError');
    expect(tables.ticket_fixed_fee_services.where).toHaveBeenCalledWith({ entry_id: entryId, is_billed: false });
  });

  it('locks and updates quantity/description without changing the catalog price', async () => {
    await updateTicketFixedFeeService(entryId, { quantity: 3, description: ' Custom setup ' });
    expect(tables.ticket_fixed_fee_services.forUpdate).toHaveBeenCalled();
    expect(tables.ticket_fixed_fee_services.update).toHaveBeenCalledWith({
      quantity: 3, description: 'Custom setup', updated_at: expect.any(String),
    });
  });

  it('does not edit billed entries', async () => {
    tables.ticket_fixed_fee_services.first.mockResolvedValue({ is_billed: true });
    expect(await updateTicketFixedFeeService(entryId, { quantity: 3, description: '' })).toHaveProperty('actionError');
    expect(tables.ticket_fixed_fee_services.update).not.toHaveBeenCalled();
  });

  it('does not mask unexpected database failures', async () => {
    tables.tickets.first.mockRejectedValue(new Error('database unavailable'));
    await expect(addTicketFixedFeeService(input)).rejects.toThrow('database unavailable');
  });
});

describe('ticket material editing', () => {
  it('does not touch stock on a description-only edit', async () => {
    await updateTicketMaterial(entryId, { quantity: 4, description: ' Changed ' });
    expect(tables.product_inventory_settings.first).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.movement).not.toHaveBeenCalled();
    expect(tables.ticket_materials.update).toHaveBeenCalledWith({
      quantity: 4, description: 'Changed', updated_at: expect.any(String),
    });
  });

  it('consumes only the increase at the original location', async () => {
    const signal = { service_id: serviceId };
    mocks.signal.mockResolvedValue(signal);
    await updateTicketMaterial(entryId, { quantity: 6, description: '' });
    expect(mocks.consume).toHaveBeenCalledWith({}, 'tenant-a', expect.objectContaining({
      quantity: 2, location_id: 'original-location', source_doc_id: entryId,
    }));
    expect(mocks.publish).toHaveBeenCalledWith('INVENTORY_STOCK_LOW', signal);
  });

  it('returns a reduction with proportional negative extended COGS', async () => {
    await updateTicketMaterial(entryId, { quantity: 3, description: '' });
    expect(mocks.movement).toHaveBeenCalledWith({}, 'tenant-a', expect.objectContaining({
      movement_type: 'return_restock', quantity: 1, to_location_id: 'original-location',
      cogs_cost: -300, cost_currency: 'USD',
    }));
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it('uses net movement quantity and cost after a prior reduction', async () => {
    tables.stock_movements.select.mockResolvedValue([
      { movement_type: 'consume', quantity: 6, from_location_id: 'original-location', cogs_cost: 1800, cost_currency: 'USD' },
      { movement_type: 'return_restock', quantity: 2, cogs_cost: -600, cost_currency: 'USD' },
    ]);
    await updateTicketMaterial(entryId, { quantity: 2, description: '' });
    expect(mocks.movement).toHaveBeenCalledWith({}, 'tenant-a', expect.objectContaining({ quantity: 2, cogs_cost: -600 }));
  });

  it('rejects serialized quantity changes', async () => {
    tables.product_inventory_settings.first.mockResolvedValue({ track_stock: true, is_serialized: true });
    expect(await updateTicketMaterial(entryId, { quantity: 2, description: '' })).toHaveProperty('actionError');
    expect(tables.ticket_materials.update).not.toHaveBeenCalled();
  });

  it('rejects tracking changes rather than fabricating a stock balance', async () => {
    tables.stock_movements.select.mockResolvedValue([]);
    expect(await updateTicketMaterial(entryId, { quantity: 2, description: '' })).toHaveProperty('actionError');
    expect(tables.ticket_materials.update).not.toHaveBeenCalled();
  });

  it('does not persist edits after a stock refusal', async () => {
    const { InsufficientStockError } = await import('@alga-psa/inventory/lib/consume');
    mocks.consume.mockRejectedValueOnce(new InsufficientStockError('Insufficient stock', 0));
    expect(await updateTicketMaterial(entryId, { quantity: 6, description: '' })).toHaveProperty('actionError');
    expect(tables.ticket_materials.update).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('does not edit billed materials', async () => {
    tables.ticket_materials.first.mockResolvedValue({ is_billed: true });
    expect(await updateTicketMaterial(entryId, { quantity: 2, description: '' })).toHaveProperty('actionError');
    expect(tables.ticket_materials.update).not.toHaveBeenCalled();
  });
});
