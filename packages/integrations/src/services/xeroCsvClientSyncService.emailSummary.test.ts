import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn();
const unparseCSVMock = vi.fn();
const parseCSVMock = vi.fn();
const loggerInfoMock = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  withTransaction: async (knex: any, callback: any) => callback(knex),
}));

vi.mock('@alga-psa/core', () => ({
  unparseCSV: unparseCSVMock,
  parseCSV: parseCSVMock,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: loggerInfoMock,
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createClientsQuery(rows: unknown[]) {
  const query: any = {
    select: vi.fn(() => query),
    where: vi.fn(() => query),
    whereIn: vi.fn(() => query),
    orderBy: vi.fn(async () => rows),
  };

  return query;
}

function createAwaitableQuery(rows: unknown[]) {
  const query: any = {
    select: vi.fn(() => query),
    where: vi.fn(() => query),
    whereIn: vi.fn(() => query),
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason?: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };

  return query;
}

describe('XeroCsvClientSyncService email summary behavior', () => {
  beforeEach(() => {
    createTenantKnexMock.mockReset();
    unparseCSVMock.mockReset();
    parseCSVMock.mockReset();
    loggerInfoMock.mockReset();
    unparseCSVMock.mockReturnValue('csv-content');
  });

  it('T044: export preserves the client billing email as the default summary address when a location email also exists', async () => {
    const clientsQuery = createClientsQuery([
      {
        client_id: 'client-1',
        client_name: 'Acme Corp',
        billing_email: 'primary@example.com',
        tax_id_number: null,
      },
    ]);
    const locationsQuery = createAwaitableQuery([
      {
        location_id: 'location-1',
        client_id: 'client-1',
        email: 'secondary@example.com',
        phone: '555-0100',
        address_line1: '123 Main St',
        address_line2: null,
        city: 'Boston',
        state_province: 'MA',
        postal_code: '02108',
        country_name: 'USA',
        is_default: true,
      },
    ]);
    const trxMock = vi.fn((table: string) => {
      if (table === 'clients') {
        return clientsQuery;
      }

      if (table === 'client_locations') {
        return locationsQuery;
      }

      throw new Error(`Unexpected table in test: ${table}`);
    });

    createTenantKnexMock.mockResolvedValue({
      knex: trxMock,
      tenant: 'tenant-123',
    });

    const { XeroCsvClientSyncService } = await import('./xeroCsvClientSyncService');
    const service = new XeroCsvClientSyncService();
    const result = await service.exportClientsToXeroCsv();

    expect(unparseCSVMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          '*ContactName': 'Acme Corp',
          EmailAddress: 'primary@example.com',
          PhoneNumber: '555-0100',
        }),
      ],
      expect.arrayContaining([
        '*ContactName',
        'EmailAddress',
        'PhoneNumber',
      ]),
    );
    expect(result).toMatchObject({
      clientCount: 1,
      csvContent: 'csv-content',
    });
  });
});
