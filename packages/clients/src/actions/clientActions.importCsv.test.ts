import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const tenantDbMock = vi.hoisted(() => vi.fn((conn: any) => ({
  table: (table: string) => conn(table),
})));
const withTransactionMock = vi.hoisted(() => vi.fn());
const hasPermissionAsyncMock = vi.hoisted(() => vi.fn());
const createTagMock = vi.hoisted(() => vi.fn());
const findTagsByEntityIdMock = vi.hoisted(() => vi.fn());
const isEnterpriseRef = vi.hoisted(() => ({ value: false }));
const authUserRef = vi.hoisted(() => ({
  value: {
    user_id: 'user-1',
    user_type: 'internal' as 'internal' | 'client',
    clientId: undefined as string | undefined,
    contact_id: undefined as string | undefined,
  },
}));

type ServerAction = (...args: unknown[]) => unknown;

vi.mock('@alga-psa/auth', () => ({
  preCheckDeletion: vi.fn(),
  withAuth: (fn: ServerAction) => (...args: unknown[]) =>
    fn(authUserRef.value, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/core', () => ({
  deleteEntityWithValidation: vi.fn(),
  unparseCSV: vi.fn(),
  get isEnterprise() {
    return isEnterpriseRef.value;
  },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  tenantDb: tenantDbMock,
  withTransaction: withTransactionMock,
}));

vi.mock('../lib/authHelpers', () => ({
  hasPermissionAsync: hasPermissionAsyncMock,
  isClientPortalUser: (user: any) => user?.user_type === 'client',
  hasMspPermission: async (user: any, resource: string, action: string, db?: any) =>
    user?.user_type === 'internal' && await hasPermissionAsyncMock(user, resource, action, db),
  assertMspPermission: async (user: any, resource: string, action: string, message: string, db?: any) => {
    if (!(user?.user_type === 'internal' && await hasPermissionAsyncMock(user, resource, action, db))) {
      throw new Error(message);
    }
  },
  hasMspOrClientPortalOwnClientPermission: async (user: any, _tenant: string, clientId: string, resource: string, action: string, db?: any) =>
    (user?.user_type === 'internal' || (user?.user_type === 'client' && user?.clientId === clientId))
      && await hasPermissionAsyncMock(user, resource, action, db),
  assertMspOrClientPortalOwnClientPermission: async (user: any, _tenant: string, clientId: string, resource: string, action: string, message: string, db?: any) => {
    if (!((user?.user_type === 'internal' || (user?.user_type === 'client' && user?.clientId === clientId))
      && await hasPermissionAsyncMock(user, resource, action, db))) {
      throw new Error(message);
    }
  },
}));

vi.mock('../lib/billingHelpers', () => ({
  createDefaultTaxSettingsAsync: vi.fn(),
}));

vi.mock('../lib/documentsHelpers', () => ({
  getClientLogoUrlAsync: vi.fn(),
  getClientLogoUrlsBatchAsync: vi.fn(),
}));

vi.mock('@alga-psa/storage', () => ({
  uploadEntityImage: vi.fn(),
  deleteEntityImage: vi.fn(),
}));

vi.mock('@alga-psa/tags/actions', () => ({
  createTag: createTagMock,
  findTagsByEntityId: findTagsByEntityIdMock,
}));

vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({
  deleteEntityTags: vi.fn(),
}));

vi.mock('@alga-psa/shared/models/clientModel', () => ({
  ClientModel: {},
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@alga-psa/workflow-streams', () => ({
  buildClientArchivedPayload: vi.fn(),
  buildClientCreatedPayload: vi.fn(),
  buildClientOwnerAssignedPayload: vi.fn(),
  buildClientStatusChangedPayload: vi.fn(),
  buildClientUpdatedPayload: vi.fn(() => ({ updatedFields: [], changes: {} })),
  buildContactPrimarySetPayload: vi.fn(),
}));

vi.mock('@alga-psa/shared/billingClients/defaultContract', () => ({
  ensureDefaultContractForClientIfBillingConfigured: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// Real column lists (from the production schema). The fake DB rejects unknown
// columns exactly like Postgres so schema drift in the import fails these tests.
const TABLE_COLUMNS: Record<string, Set<string>> = {
  clients: new Set([
    'tenant', 'client_id', 'client_name', 'url', 'properties', 'billing_type',
    'payment_terms', 'credit_limit', 'preferred_payment_method', 'auto_invoice',
    'invoice_delivery_method', 'created_at', 'updated_at', 'is_inactive',
    'client_type', 'is_tax_exempt', 'tax_exemption_certificate', 'tax_id_number',
    'notes', 'credit_balance', 'billing_cycle', 'timezone', 'notes_document_id',
    'invoice_template_id', 'billing_contact_id', 'billing_email', 'region_code',
    'account_manager_id', 'default_currency_code', 'sla_policy_id',
    'entra_tenant_id', 'entra_primary_domain', 'inbound_ticket_defaults_id',
  ]),
  client_locations: new Set([
    'location_id', 'tenant', 'client_id', 'location_name', 'address_line1',
    'address_line2', 'address_line3', 'city', 'state_province', 'postal_code',
    'country_code', 'country_name', 'region_code', 'is_billing_address',
    'is_shipping_address', 'is_default', 'phone', 'fax', 'email', 'notes',
    'is_active', 'created_at', 'updated_at',
  ]),
  default_billing_settings: new Set(['tenant', 'default_currency_code']),
};

interface FakeState {
  clients: Record<string, any>[];
  client_locations: Record<string, any>[];
  default_billing_settings: Record<string, any>[];
  updates: Array<{ table: string; data: Record<string, any> }>;
  failClientInsertNamed: string | null;
}

let state: FakeState;
let idCounter: number;

function assertRealColumns(table: string, data: Record<string, any>) {
  for (const key of Object.keys(data)) {
    if (!TABLE_COLUMNS[table].has(key)) {
      throw new Error(`column "${key}" of relation "${table}" does not exist`);
    }
  }
}

function resolveRow(table: string, data: Record<string, any>): Record<string, any> {
  const row = { ...data };
  for (const [key, value] of Object.entries(row)) {
    if (value && typeof value === 'object' && '__raw' in value) {
      row[key] = `${table}-generated-${++idCounter}`;
    }
  }
  return row;
}

function fakeConn(table: string) {
  if (!TABLE_COLUMNS[table]) {
    throw new Error(`Unexpected table ${table}`);
  }
  const rows = () => state[table as 'clients' | 'client_locations' | 'default_billing_settings'];
  const matching = (criteria: Record<string, any>) =>
    rows().filter(row => Object.entries(criteria).every(([key, value]) => row[key] === value));

  return {
    where(criteria: Record<string, any>) {
      return {
        first: async () => {
          const match = matching(criteria)[0];
          return match ? { ...match } : undefined;
        },
        update(data: Record<string, any>) {
          assertRealColumns(table, data);
          state.updates.push({ table, data: { ...data } });
          const updated: Record<string, any>[] = [];
          for (const row of matching(criteria)) {
            Object.assign(row, resolveRow(table, data));
            updated.push({ ...row });
          }
          return Object.assign(Promise.resolve(updated.length), {
            returning: async () => updated,
          });
        },
      };
    },
    insert(data: Record<string, any>) {
      assertRealColumns(table, data);
      if (table === 'clients' && data.client_name === state.failClientInsertNamed) {
        throw new Error('simulated insert failure');
      }
      const row = resolveRow(table, data);
      if (table === 'clients' && !row.client_id) {
        row.client_id = `client-generated-${++idCounter}`;
      }
      rows().push(row);
      return Object.assign(Promise.resolve([{ ...row }]), {
        returning: async () => [{ ...row }],
      });
    },
    select(..._columns: string[]) {
      return {
        first: async () => {
          const row = rows()[0];
          return row ? { ...row } : undefined;
        },
      };
    },
  };
}

const trxFn = Object.assign((table: string) => fakeConn(table), {
  raw: (sql: string) => ({ __raw: sql }),
});

function csvRow(overrides: Record<string, any> = {}): Record<string, any> {
  // Shape produced by ClientsImportDialog for a template CSV: every mappable
  // field present, location data included.
  return {
    client_name: 'Harborview Dental Group',
    website: 'https://harborviewdental.com',
    client_type: 'company',
    is_inactive: false,
    is_tax_exempt: false,
    auto_invoice: false,
    credit_limit: undefined,
    notes: 'Imported from CSV',
    tags: '',
    location_name: 'Main Office',
    email: 'frontdesk@harborviewdental.com',
    phone_number: '(206) 555-0177',
    address_line1: '1201 Alaskan Way',
    address_line2: '',
    city: 'Seattle',
    state_province: 'Washington',
    postal_code: '98101',
    country: 'United States',
    ...overrides,
  };
}

async function importClients(rows: Record<string, any>[], updateExisting = false) {
  const { importClientsFromCSV } = await import('./clientActions');
  return importClientsFromCSV(rows, updateExisting) as Promise<Array<{
    success: boolean;
    message: string;
    client?: Record<string, any>;
    originalData: Record<string, any>;
    skipped?: boolean;
  }>>;
}

describe('importClientsFromCSV', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    idCounter = 0;
    state = {
      clients: [],
      client_locations: [],
      default_billing_settings: [],
      updates: [],
      failClientInsertNamed: null,
    };
    authUserRef.value = {
      user_id: 'user-1',
      user_type: 'internal',
      clientId: undefined,
      contact_id: undefined,
    };
    hasPermissionAsyncMock.mockResolvedValue(true);
    findTagsByEntityIdMock.mockResolvedValue([]);
    createTagMock.mockResolvedValue({});
    createTenantKnexMock.mockResolvedValue({ knex: trxFn });
    withTransactionMock.mockImplementation(async (_db: unknown, callback: (trx: any) => Promise<unknown>) => {
      const snapshotClients = structuredClone(state.clients);
      const snapshotLocations = structuredClone(state.client_locations);
      try {
        return await callback(trxFn);
      } catch (error) {
        state.clients = snapshotClients;
        state.client_locations = snapshotLocations;
        throw error;
      }
    });
  });

  it('creates clients with url mapped from website and location data in client_locations', async () => {
    const results = await importClients([csvRow()]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ success: true, message: 'Client created' });
    expect(state.clients).toHaveLength(1);
    expect(state.clients[0]).toMatchObject({
      client_name: 'Harborview Dental Group',
      url: 'https://harborviewdental.com',
      tenant: 'tenant-1',
    });
    expect(state.clients[0]).not.toHaveProperty('website');
    expect(state.client_locations).toHaveLength(1);
    expect(state.client_locations[0]).toMatchObject({
      client_id: state.clients[0].client_id,
      location_name: 'Main Office',
      address_line1: '1201 Alaskan Way',
      city: 'Seattle',
      phone: '(206) 555-0177',
      email: 'frontdesk@harborviewdental.com',
      is_default: true,
    });
  });

  it('does not create a location when the row has no location data', async () => {
    const results = await importClients([csvRow({
      client_name: 'Summit Peak Consulting',
      website: '',
      location_name: '',
      email: '',
      phone_number: '',
      address_line1: '',
      address_line2: '',
      city: '',
      state_province: '',
      postal_code: '',
      country: '',
    })]);

    expect(results[0]).toMatchObject({ success: true, message: 'Client created' });
    expect(state.client_locations).toHaveLength(0);
  });

  it('updates an existing client from a template-shaped row without touching non-columns (prod regression)', async () => {
    state.clients.push({
      tenant: 'tenant-1',
      client_id: 'client-existing',
      client_name: 'Harborview Dental Group',
      url: 'https://old-url.example',
      is_inactive: false,
      notes: 'old notes',
    });

    const results = await importClients([csvRow({ notes: 'refreshed notes' })], true);

    expect(results[0]).toMatchObject({ success: true, message: 'Client updated' });
    expect(state.clients).toHaveLength(1);
    expect(state.clients[0]).toMatchObject({
      client_id: 'client-existing',
      url: 'https://harborviewdental.com',
      notes: 'refreshed notes',
    });

    const clientUpdate = state.updates.find(u => u.table === 'clients');
    expect(clientUpdate).toBeDefined();
    expect(clientUpdate!.data).not.toHaveProperty('tenant');
    expect(clientUpdate!.data).not.toHaveProperty('website');
    expect(clientUpdate!.data).not.toHaveProperty('location_name');
    expect(clientUpdate!.data).not.toHaveProperty('address_line1');
    expect(clientUpdate!.data).not.toHaveProperty('tags');

    expect(state.client_locations).toHaveLength(1);
    expect(state.client_locations[0]).toMatchObject({
      client_id: 'client-existing',
      address_line1: '1201 Alaskan Way',
      is_default: true,
    });
  });

  it('updates the existing default location instead of inserting a second one', async () => {
    state.clients.push({
      tenant: 'tenant-1',
      client_id: 'client-existing',
      client_name: 'Harborview Dental Group',
      url: '',
    });
    state.client_locations.push({
      tenant: 'tenant-1',
      location_id: 'loc-1',
      client_id: 'client-existing',
      location_name: 'Old Office',
      address_line1: '1 Old St',
      is_default: true,
    });

    await importClients([csvRow()], true);

    expect(state.client_locations).toHaveLength(1);
    expect(state.client_locations[0]).toMatchObject({
      location_id: 'loc-1',
      location_name: 'Main Office',
      address_line1: '1201 Alaskan Way',
    });
  });

  it('skips existing clients when updateExisting is off and leaves them unchanged', async () => {
    state.clients.push({
      tenant: 'tenant-1',
      client_id: 'client-existing',
      client_name: 'Harborview Dental Group',
      url: 'https://old-url.example',
    });

    const results = await importClients([csvRow()], false);

    expect(results[0]).toMatchObject({
      success: false,
      skipped: true,
      message: 'Client with name Harborview Dental Group already exists',
    });
    expect(state.clients[0].url).toBe('https://old-url.example');
    expect(state.client_locations).toHaveLength(0);
  });

  it('isolates row failures: one bad row rolls back alone and later rows still import', async () => {
    state.failClientInsertNamed = 'Poison Pill LLC';

    const results = await importClients([
      csvRow({ client_name: 'First Fine Co' }),
      csvRow({ client_name: 'Poison Pill LLC' }),
      csvRow({ client_name: 'Third Fine Co' }),
    ]);

    expect(results.map(r => r.success)).toEqual([true, false, true]);
    expect(results[1].message).toBe('simulated insert failure');
    expect(state.clients.map(c => c.client_name)).toEqual(['First Fine Co', 'Third Fine Co']);
    expect(state.client_locations).toHaveLength(2);
  });

  it('reports rows without a client name as failed without aborting the batch', async () => {
    const results = await importClients([
      csvRow({ client_name: '' }),
      csvRow({ client_name: 'Valid Co' }),
    ]);

    expect(results[0]).toMatchObject({ success: false, message: 'Client name is required' });
    expect(results[1]).toMatchObject({ success: true, message: 'Client created' });
    expect(state.clients).toHaveLength(1);
  });

  it('creates tags on create and only missing tags on update', async () => {
    const createResults = await importClients([
      csvRow({ client_name: 'Tagged Co', tags: 'Legal,VIP' }),
    ]);
    expect(createResults[0].success).toBe(true);
    expect(createTagMock).toHaveBeenCalledTimes(2);

    createTagMock.mockClear();
    findTagsByEntityIdMock.mockResolvedValue([{ tag_text: 'legal' }]);

    const updateResults = await importClients([
      csvRow({ client_name: 'Tagged Co', tags: 'Legal,VIP' }),
    ], true);
    expect(updateResults[0].success).toBe(true);
    expect(createTagMock).toHaveBeenCalledTimes(1);
    expect(createTagMock).toHaveBeenCalledWith(expect.objectContaining({ tag_text: 'VIP' }));
  });

  it('applies the tenant default currency to created clients', async () => {
    state.default_billing_settings.push({ tenant: 'tenant-1', default_currency_code: 'EUR' });

    await importClients([csvRow()]);

    expect(state.clients[0].default_currency_code).toBe('EUR');
  });

  it('rejects without create permission', async () => {
    hasPermissionAsyncMock.mockResolvedValue(false);

    await expect(importClients([csvRow()])).rejects.toThrow('Permission denied: Cannot create clients');
    expect(state.clients).toHaveLength(0);
  });

  it('rejects updateExisting without update permission', async () => {
    hasPermissionAsyncMock.mockImplementation(async (_user: any, _resource: string, action: string) => action !== 'update');

    await expect(importClients([csvRow()], true)).rejects.toThrow('Permission denied: Cannot update clients');
  });
});
