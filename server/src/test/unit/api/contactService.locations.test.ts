import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T067 / T068 at the service seam: `locations` omitted leaves the links alone, `[]` removes them,
 * a set replaces them — and every contact-returning response carries the links back, unlinked
 * contacts as `[]`.
 */

const CONTACT = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const WAREHOUSE = '33333333-3333-4333-8333-333333333333';

const createContactMock = vi.fn();
const getContactByIdMock = vi.fn();
const updateContactMock = vi.fn();
const replaceContactLocationsMock = vi.fn(async () => undefined);
const getContactLocationsForContactsMock = vi.fn(async () => new Map());

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    withTransaction: async (_knex: unknown, callback: (trx: any) => Promise<any>) =>
      callback({ transactionId: 'trx-1' }),
  };
});

vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getContactAvatarUrl: vi.fn().mockResolvedValue(null),
}));

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/shared/workflow/streams/domainEventBuilders/contactEventBuilders', () => ({
  buildContactCreatedPayload: vi.fn(() => ({ event: 'created' })),
  buildContactUpdatedPayload: vi.fn(() => ({ updatedFields: [], changes: {} })),
  buildContactArchivedPayload: vi.fn(() => ({ event: 'archived' })),
}));

vi.mock('@alga-psa/shared/models/contactLocation', () => ({
  getContactLocationsForContacts: (...args: any[]) => getContactLocationsForContactsMock(...(args as [])),
}));

vi.mock('@alga-psa/clients/models/contactLocation', () => ({
  replaceContactLocations: (...args: any[]) => replaceContactLocationsMock(...(args as [])),
}));

vi.mock('@alga-psa/shared/models/contactModel', () => ({
  ContactModel: {
    createContact: (...args: any[]) => createContactMock(...args),
    getContactById: (...args: any[]) => getContactByIdMock(...args),
    updateContact: (...args: any[]) => updateContactMock(...args),
    hydrateContactsWithPhoneNumbers: vi.fn(),
  },
  clearContactLinksBeforeDelete: vi.fn(),
}));

const row = (overrides: Record<string, unknown> = {}) => ({
  contact_name_id: CONTACT,
  client_id: CLIENT,
  full_name: 'Dorothy Gale',
  email: 'dorothy@emeraldcity.oz',
  additional_email_addresses: [],
  phone_numbers: [],
  is_inactive: false,
  created_at: '2026-10-28T00:00:00.000Z',
  updated_at: '2026-10-28T00:00:00.000Z',
  ...overrides,
});

async function service() {
  const { ContactService } = await import('../../../lib/api/services/ContactService');
  const instance = new ContactService();
  vi.spyOn(instance as any, 'getKnex').mockResolvedValue({ knex: {}, tenant: 'tenant-1' });
  return instance;
}

const context = { tenant: 'tenant-1', userId: 'user-1' } as any;

describe('ContactService contact locations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getContactLocationsForContactsMock.mockResolvedValue(new Map());
    createContactMock.mockResolvedValue({ contact_name_id: CONTACT });
    getContactByIdMock.mockResolvedValue(row());
    updateContactMock.mockResolvedValue(row());
  });

  it('writes the links of a create in the same transaction as the contact', async () => {
    getContactLocationsForContactsMock.mockResolvedValue(
      new Map([[CONTACT, [{ location_id: WAREHOUSE, location_name: 'Warehouse', is_primary: true, is_active: true }]]]),
    );

    const created = await (await service()).create({
      full_name: 'Dorothy Gale',
      email: 'dorothy@emeraldcity.oz',
      client_id: CLIENT,
      work_arrangement: 'hybrid',
      locations: [{ location_id: WAREHOUSE, is_primary: true }],
    } as any, context);

    expect(createContactMock.mock.calls[0][0]).toMatchObject({ work_arrangement: 'hybrid' });
    expect(replaceContactLocationsMock).toHaveBeenCalledWith(
      { transactionId: 'trx-1' },
      'tenant-1',
      CONTACT,
      [{ location_id: WAREHOUSE, is_primary: true }],
      { createdBy: 'user-1' },
    );
    expect(created.locations).toEqual([
      { location_id: WAREHOUSE, location_name: 'Warehouse', is_primary: true, is_active: true },
    ]);
  });

  it('leaves the links untouched when an update omits them', async () => {
    const updated = await (await service()).update(CONTACT, { role: 'Scarecrow' } as any, context);
    expect(replaceContactLocationsMock).not.toHaveBeenCalled();
    // The response still carries them, as [] for an unlinked contact.
    expect(updated.locations).toEqual([]);
  });

  it('removes every link when an update passes []', async () => {
    await (await service()).update(CONTACT, { locations: [] } as any, context);
    expect(replaceContactLocationsMock).toHaveBeenCalledWith(
      { transactionId: 'trx-1' },
      'tenant-1',
      CONTACT,
      [],
      { createdBy: 'user-1' },
    );
  });

  it('replaces them with the new set, after the client-change removal the model already did', async () => {
    await (await service()).update(
      CONTACT,
      { client_id: CLIENT, locations: [{ location_id: WAREHOUSE }] } as any,
      context,
    );
    const updateOrder = updateContactMock.mock.invocationCallOrder[0];
    const replaceOrder = replaceContactLocationsMock.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(replaceOrder);
    expect(replaceContactLocationsMock.mock.calls[0][3]).toEqual([{ location_id: WAREHOUSE }]);
  });

  it('reads the links of the written contact in one batched query', async () => {
    await (await service()).update(CONTACT, { role: 'Tin Man' } as any, context);
    expect(getContactLocationsForContactsMock).toHaveBeenCalledTimes(1);
    expect(getContactLocationsForContactsMock.mock.calls[0][2]).toEqual([CONTACT]);
  });
});
