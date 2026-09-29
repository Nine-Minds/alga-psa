import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const store = { providers: [] as any[] };

  const createQuery = () => {
    const filters: Record<string, unknown>[] = [];
    const filtered = () =>
      store.providers.filter((row) => filters.every((cond) => Object.entries(cond).every(([k, v]) => row[k] === v)));
    const query: any = {
      where(cond: Record<string, unknown>) {
        filters.push(cond);
        return query;
      },
      async first() {
        const [row] = filtered();
        return row ? { ...row } : undefined;
      },
    };
    return query;
  };

  const knexMock: any = () => createQuery();
  knexMock.fn = { now: () => 'NOW()' };

  const createContactFromThreecx = vi.fn();

  return { store, knexMock, createQuery, createContactFromThreecx };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: hoisted.knexMock }),
  tenantDb: (_knex: any, tenant: string) => ({
    table: () => hoisted.createQuery().where({ tenant }),
  }),
  withTransaction: async () => undefined,
}));

vi.mock('../contacts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createContactFromThreecx: hoisted.createContactFromThreecx,
}));

vi.mock('@alga-psa/shared/models/contactModel', () => ({ ContactModel: {} }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/workflow-streams', () => ({ buildContactCreatedPayload: vi.fn() }));

import { handleThreecxCreateContact } from './contactsHandler';
import { THREECX_ROUTE_SEGMENTS } from '../routeConstants';
import type { ThreecxRouteDeps } from './deps';

const TENANT = 'tenant-uuid-1';
const KEY = 'the-secret-key';
const SLUG = 'abcdef012345';

function makeDeps(overrides: Partial<ThreecxRouteDeps> = {}): ThreecxRouteDeps {
  return {
    resolveTenantSlug: vi.fn(async () => TENANT),
    checkRateLimit: vi.fn(async () => true),
    getProviderAvailability: vi.fn(async () => ({ enabled: true })),
    enqueueCanonicalCall: vi.fn(async () => undefined),
    enqueueChat: vi.fn(async () => undefined),
    ...overrides,
  };
}

function seedProvider(overrides: Record<string, unknown> = {}) {
  hoisted.store.providers.push({
    tenant: TENANT,
    provider: '3cx',
    provider_id: 'provider-1',
    status: 'active',
    webhook_secret: KEY,
    config: {},
    ...overrides,
  });
}

function contactsRequest(body: unknown, key: string | null = KEY): Request {
  const url = `https://app.example.com/api/telephony/3cx/${SLUG}/${THREECX_ROUTE_SEGMENTS.contacts}`;
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const validBody = { firstName: 'Jane', lastName: 'Doe', number: '+15551234567', email: 'jane@example.com', company: 'Acme' };

const contact = (overrides: Record<string, unknown> = {}) => ({
  contactUrl: 'https://app.example.com/msp/contacts/contact-1',
  firstName: 'Jane',
  lastName: 'Doe',
  companyName: 'Acme',
  email: 'jane@example.com',
  phone: '+15551234567',
  entityId: 'contact-1',
  entityType: 'contact',
  ...overrides,
});

beforeEach(() => {
  hoisted.store.providers.length = 0;
  hoisted.createContactFromThreecx.mockReset();
  delete process.env.NEXT_PUBLIC_BASE_URL;
});

describe('handleThreecxCreateContact', () => {
  it('answers 404 for an unknown slug before touching the key', async () => {
    const deps = makeDeps({ resolveTenantSlug: vi.fn(async () => null) });
    const response = await handleThreecxCreateContact(contactsRequest(validBody, null), 'nope', deps);
    expect(response.status).toBe(404);
    expect(hoisted.createContactFromThreecx).not.toHaveBeenCalled();
  });

  it('answers 403 for a bad key', async () => {
    seedProvider();
    const response = await handleThreecxCreateContact(contactsRequest(validBody, 'wrong'), SLUG, makeDeps());
    expect(response.status).toBe(403);
    expect(hoisted.createContactFromThreecx).not.toHaveBeenCalled();
  });

  it('answers 403 for an inactive provider and a below-tier tenant', async () => {
    seedProvider({ status: 'disabled' });
    expect((await handleThreecxCreateContact(contactsRequest(validBody), SLUG, makeDeps())).status).toBe(403);

    hoisted.store.providers.length = 0;
    seedProvider();
    const deps = makeDeps({ getProviderAvailability: vi.fn(async () => ({ enabled: false, message: 'tier' })) });
    expect((await handleThreecxCreateContact(contactsRequest(validBody), SLUG, deps)).status).toBe(403);
    expect(hoisted.createContactFromThreecx).not.toHaveBeenCalled();
  });

  it('answers 400 with a message when name, number and email are all empty', async () => {
    seedProvider();
    const response = await handleThreecxCreateContact(
      contactsRequest({ firstName: '', lastName: ' ', number: '', email: '', company: 'Acme' }),
      SLUG,
      makeDeps(),
    );
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe('invalid_request');
    expect(typeof json.message).toBe('string');
    expect(hoisted.createContactFromThreecx).not.toHaveBeenCalled();
  });

  it('answers 400 for a body that is not JSON', async () => {
    seedProvider();
    const response = await handleThreecxCreateContact(contactsRequest('not json'), SLUG, makeDeps());
    expect(response.status).toBe(400);
    expect(hoisted.createContactFromThreecx).not.toHaveBeenCalled();
  });

  it('answers 200 with the created contact and passes the tenant, base url and trimmed body', async () => {
    seedProvider();
    hoisted.createContactFromThreecx.mockResolvedValue({ kind: 'created', contact: contact() });

    const response = await handleThreecxCreateContact(
      contactsRequest({ ...validBody, firstName: ' Jane ', company: ' Acme ' }),
      SLUG,
      makeDeps(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ contacts: [contact()] });
    expect(hoisted.createContactFromThreecx).toHaveBeenCalledWith(
      { tenantId: TENANT, baseUrl: 'https://app.example.com' },
      { firstName: 'Jane', lastName: 'Doe', number: '+15551234567', email: 'jane@example.com', company: 'Acme' },
    );
  });

  it('answers 200 with the existing contact on a duplicate email', async () => {
    seedProvider();
    hoisted.createContactFromThreecx.mockResolvedValue({
      kind: 'existing',
      contact: contact({ entityId: 'contact-existing', contactUrl: 'https://app.example.com/msp/contacts/contact-existing' }),
    });

    const response = await handleThreecxCreateContact(contactsRequest(validBody), SLUG, makeDeps());
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.contacts).toHaveLength(1);
    expect(json.contacts[0].entityId).toBe('contact-existing');
    expect(json.contacts[0].entityType).toBe('contact');
  });

  it('answers 200 with the pending contact pointing at the settings page when no email was given', async () => {
    seedProvider();
    const pendingId = '11111111-2222-4333-8444-555555555555';
    hoisted.createContactFromThreecx.mockResolvedValue({
      kind: 'pending',
      pendingId,
      contact: contact({
        contactUrl: `https://app.example.com/msp/settings/integrations?category=communication&threecxPending=${pendingId}`,
        email: '',
        entityId: pendingId,
        entityType: 'pending',
      }),
    });

    const response = await handleThreecxCreateContact(contactsRequest({ ...validBody, email: '' }), SLUG, makeDeps());
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.contacts).toHaveLength(1);
    expect(json.contacts[0].entityType).toBe('pending');
    expect(json.contacts[0].entityId).toBe(pendingId);
    expect(json.contacts[0].contactUrl).toContain(`threecxPending=${pendingId}`);
  });
});
