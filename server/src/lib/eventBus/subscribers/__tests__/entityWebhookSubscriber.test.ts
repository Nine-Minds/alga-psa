import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  listForEventType: vi.fn(),
  enqueue: vi.fn(),
  handlers: new Map<string, Set<(e: unknown) => Promise<void>>>(),
}));

vi.mock('@/lib/eventBus', () => ({
  getEventBus: () => ({
    subscribe: async (type: string, handler: any) => {
      if (!state.handlers.has(type)) state.handlers.set(type, new Set());
      state.handlers.get(type)!.add(handler);
    },
    unsubscribe: async (type: string, handler: any) => state.handlers.get(type)?.delete(handler),
  }),
}));
vi.mock('@/lib/webhooks/webhookModel', () => ({
  webhookModel: { listForEventType: (...a: unknown[]) => state.listForEventType(...a) },
}));
vi.mock('@/lib/webhooks/WebhookDeliveryQueue', () => ({
  WebhookDeliveryQueue: { getInstance: () => ({ enqueue: (...a: unknown[]) => state.enqueue(...a) }) },
}));

import {
  clientLocationWebhookSubscriber,
  clientWebhookSubscriber,
  contactWebhookSubscriber,
} from '../entityWebhookSubscribers';
import { matchesEntityIdFilter } from '../entityWebhookSubscriber';
import { buildEntityWebhookPayload, toSnakeFieldPath } from '../webhook/webhookEntityPayload';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_CLIENT = 'abababab-abab-4bab-8bab-abababababab';
const CONTACT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOCATION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TS = '2026-10-20T10:00:00.000Z';

const busEvent = (eventType: string, payload: Record<string, unknown>) => ({
  id: EVENT_ID,
  timestamp: TS,
  eventType,
  payload: { tenantId: TENANT, ...payload },
});

const sub = (over: Record<string, unknown> = {}) => ({
  webhookId: 'w1',
  eventFilter: null,
  payloadFields: null,
  ...over,
});

beforeEach(() => {
  state.listForEventType.mockReset();
  state.enqueue.mockReset();
  state.listForEventType.mockResolvedValue([sub()]);
});

type Row = [
  string, // description
  typeof clientWebhookSubscriber,
  string, // internal event
  Record<string, unknown>, // domain payload
  string, // public event
  Record<string, unknown>, // expected data
];

const ROWS: Row[] = [
  ['client created', clientWebhookSubscriber, 'CLIENT_CREATED', { clientId: CLIENT, clientName: 'Acme' }, 'client.created', { client_id: CLIENT }],
  [
    'client updated carries changed_fields (snake_case)',
    clientWebhookSubscriber,
    'CLIENT_UPDATED',
    { clientId: CLIENT, updatedFields: ['clientName', 'properties.accountManager'], changes: {} },
    'client.updated',
    { client_id: CLIENT, changed_fields: ['client_name', 'properties.account_manager'] },
  ],
  [
    'client updated without field names has no changed_fields',
    clientWebhookSubscriber,
    'CLIENT_UPDATED',
    { clientId: CLIENT },
    'client.updated',
    { client_id: CLIENT },
  ],
  ['CLIENT_STATUS_CHANGED -> client.updated (no changed_fields)', clientWebhookSubscriber, 'CLIENT_STATUS_CHANGED', { clientId: CLIENT, previousStatus: 'a', newStatus: 'b' }, 'client.updated', { client_id: CLIENT }],
  ['CONTACT_PRIMARY_SET -> client.updated for the client', clientWebhookSubscriber, 'CONTACT_PRIMARY_SET', { clientId: CLIENT, contactId: CONTACT }, 'client.updated', { client_id: CLIENT }],
  ['CLIENT_ARCHIVED -> client.deactivated', clientWebhookSubscriber, 'CLIENT_ARCHIVED', { clientId: CLIENT }, 'client.deactivated', { client_id: CLIENT }],
  ['CLIENT_DELETED -> client.deleted', clientWebhookSubscriber, 'CLIENT_DELETED', { clientId: CLIENT }, 'client.deleted', { client_id: CLIENT }],
  ['CLIENT_MERGED -> client.deleted for the SOURCE id', clientWebhookSubscriber, 'CLIENT_MERGED', { sourceClientId: CLIENT, targetClientId: OTHER_CLIENT }, 'client.deleted', { client_id: CLIENT }],
  ['contact created (with client)', contactWebhookSubscriber, 'CONTACT_CREATED', { contactId: CONTACT, clientId: CLIENT, fullName: 'A B' }, 'contact.created', { contact_id: CONTACT, client_id: CLIENT }],
  ['contact created (client-less)', contactWebhookSubscriber, 'CONTACT_CREATED', { contactId: CONTACT, fullName: 'A B' }, 'contact.created', { contact_id: CONTACT }],
  [
    'contact updated',
    contactWebhookSubscriber,
    'CONTACT_UPDATED',
    { contactId: CONTACT, clientId: CLIENT, updatedFields: ['fullName'] },
    'contact.updated',
    { contact_id: CONTACT, client_id: CLIENT, changed_fields: ['full_name'] },
  ],
  ['CONTACT_ARCHIVED -> contact.deactivated (no changed_fields)', contactWebhookSubscriber, 'CONTACT_ARCHIVED', { contactId: CONTACT, clientId: CLIENT, updatedFields: ['x'] }, 'contact.deactivated', { contact_id: CONTACT, client_id: CLIENT }],
  ['CONTACT_DELETED -> contact.deleted', contactWebhookSubscriber, 'CONTACT_DELETED', { contactId: CONTACT, clientId: CLIENT }, 'contact.deleted', { contact_id: CONTACT, client_id: CLIENT }],
  ['location created', clientLocationWebhookSubscriber, 'CLIENT_LOCATION_CREATED', { locationId: LOCATION, clientId: CLIENT }, 'client_location.created', { location_id: LOCATION, client_id: CLIENT }],
  [
    'location updated',
    clientLocationWebhookSubscriber,
    'CLIENT_LOCATION_UPDATED',
    { locationId: LOCATION, clientId: CLIENT, updatedFields: ['addressLine1'] },
    'client_location.updated',
    { location_id: LOCATION, client_id: CLIENT, changed_fields: ['address_line1'] },
  ],
  ['location deactivated', clientLocationWebhookSubscriber, 'CLIENT_LOCATION_DEACTIVATED', { locationId: LOCATION, clientId: CLIENT }, 'client_location.deactivated', { location_id: LOCATION, client_id: CLIENT }],
  ['location deleted', clientLocationWebhookSubscriber, 'CLIENT_LOCATION_DELETED', { locationId: LOCATION, clientId: CLIENT }, 'client_location.deleted', { location_id: LOCATION, client_id: CLIENT }],
];

describe('entity webhook subscribers: per-event mapping and payload shape', () => {
  it.each(ROWS)('%s', async (_d, subscriber, internal, domain, publicEvent, expectedData) => {
    await subscriber.handle(busEvent(internal, domain));

    expect(state.listForEventType).toHaveBeenCalledTimes(1);
    expect(state.listForEventType).toHaveBeenCalledWith(TENANT, publicEvent);
    expect(state.enqueue).toHaveBeenCalledTimes(1);
    expect(state.enqueue).toHaveBeenCalledWith({
      webhookId: 'w1',
      eventId: EVENT_ID,
      eventType: publicEvent,
      occurredAt: TS,
      tenantId: TENANT,
      payload: expectedData,
      attempt: 1,
      deliverAt: expect.any(Number),
    });
  });

  it('payload never carries a record body, only ids and changed_fields', () => {
    const data = buildEntityWebhookPayload('contact', 'CONTACT_UPDATED', 'contact.updated', {
      tenantId: TENANT,
      contactId: CONTACT,
      clientId: CLIENT,
      fullName: 'Secret Name',
      email: 'x@y.z',
      changes: { fullName: { previous: 'a', new: 'b' } },
      updatedFields: ['fullName'],
    });
    expect(Object.keys(data!).sort()).toEqual(['changed_fields', 'client_id', 'contact_id']);
  });

  it('ignores events that do not identify the entity', async () => {
    await contactWebhookSubscriber.handle(busEvent('CONTACT_CREATED', { fullName: 'x' }));
    await clientWebhookSubscriber.handle({ not: 'an event' });
    await clientWebhookSubscriber.handle(busEvent('CLIENT_MERGED', { clientId: CLIENT })); // merge needs sourceClientId
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it('ignores internal events the subscriber does not map', async () => {
    await clientWebhookSubscriber.handle(busEvent('CLIENT_OWNER_ASSIGNED', { clientId: CLIENT }));
    expect(state.listForEventType).not.toHaveBeenCalled();
  });

  it('does not enqueue when nobody subscribes', async () => {
    state.listForEventType.mockResolvedValue([]);
    await clientWebhookSubscriber.handle(busEvent('CLIENT_CREATED', { clientId: CLIENT }));
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it('swallows errors (a failed lookup must not break the bus handler)', async () => {
    state.listForEventType.mockRejectedValue(new Error('db down'));
    await expect(
      clientWebhookSubscriber.handle(busEvent('CLIENT_CREATED', { clientId: CLIENT })),
    ).resolves.toBeUndefined();
  });

  it('registers one handler per internal event and unregisters them', async () => {
    state.handlers.clear();
    await contactWebhookSubscriber.register();
    expect([...state.handlers.keys()].sort()).toEqual(
      ['CONTACT_ARCHIVED', 'CONTACT_CREATED', 'CONTACT_DELETED', 'CONTACT_UPDATED'],
    );
    await contactWebhookSubscriber.unregister();
    for (const set of state.handlers.values()) expect(set.size).toBe(0);
  });
});

describe('entity_ids filter', () => {
  it('contact: matches the contact id OR the parent client id', async () => {
    state.listForEventType.mockResolvedValue([
      sub({ webhookId: 'by-contact', eventFilter: { entity_ids: [CONTACT] } }),
      sub({ webhookId: 'by-client', eventFilter: { entity_ids: [CLIENT] } }),
      sub({ webhookId: 'other', eventFilter: { entity_ids: [OTHER_CLIENT] } }),
      sub({ webhookId: 'all', eventFilter: null }),
      sub({ webhookId: 'empty', eventFilter: { entity_ids: [] } }),
    ]);
    await contactWebhookSubscriber.handle(
      busEvent('CONTACT_UPDATED', { contactId: CONTACT, clientId: CLIENT, updatedFields: ['fullName'] }),
    );
    expect(state.enqueue.mock.calls.map((c) => c[0].webhookId).sort()).toEqual(
      ['all', 'by-client', 'by-contact', 'empty'],
    );
  });

  it('client_location: matches the location id OR the parent client id', async () => {
    state.listForEventType.mockResolvedValue([
      sub({ webhookId: 'by-location', eventFilter: { entity_ids: [LOCATION] } }),
      sub({ webhookId: 'by-client', eventFilter: { entity_ids: [CLIENT] } }),
      sub({ webhookId: 'other', eventFilter: { entity_ids: [OTHER_CLIENT] } }),
    ]);
    await clientLocationWebhookSubscriber.handle(
      busEvent('CLIENT_LOCATION_DELETED', { locationId: LOCATION, clientId: CLIENT }),
    );
    expect(state.enqueue.mock.calls.map((c) => c[0].webhookId).sort()).toEqual(['by-client', 'by-location']);
  });

  it('client: matches the client id only', async () => {
    state.listForEventType.mockResolvedValue([
      sub({ webhookId: 'match', eventFilter: { entity_ids: [CLIENT] } }),
      sub({ webhookId: 'miss', eventFilter: { entity_ids: [CONTACT] } }),
    ]);
    await clientWebhookSubscriber.handle(busEvent('CLIENT_CREATED', { clientId: CLIENT }));
    expect(state.enqueue.mock.calls.map((c) => c[0].webhookId)).toEqual(['match']);
  });

  it('a client-less contact matches only its own id (parent filter cannot match)', () => {
    expect(matchesEntityIdFilter({ entity_ids: [CLIENT] }, [CONTACT, undefined])).toBe(false);
    expect(matchesEntityIdFilter({ entity_ids: [CONTACT] }, [CONTACT, undefined])).toBe(true);
  });

  it('merge uses the source client id for the filter', async () => {
    state.listForEventType.mockResolvedValue([
      sub({ webhookId: 'source', eventFilter: { entity_ids: [CLIENT] } }),
      sub({ webhookId: 'target', eventFilter: { entity_ids: [OTHER_CLIENT] } }),
    ]);
    await clientWebhookSubscriber.handle(
      busEvent('CLIENT_MERGED', { sourceClientId: CLIENT, targetClientId: OTHER_CLIENT }),
    );
    expect(state.enqueue.mock.calls.map((c) => c[0].webhookId)).toEqual(['source']);
  });
});

describe('payload allowlist', () => {
  it('keeps the entity id regardless of the allowlist and strips unselected optional keys', async () => {
    state.listForEventType.mockResolvedValue([
      sub({ webhookId: 'ids-only', payloadFields: { contact: [] } }),
      sub({ webhookId: 'with-client', payloadFields: { contact: ['client_id'] } }),
      sub({ webhookId: 'other-entity', payloadFields: { ticket: ['title'] } }),
    ]);
    await contactWebhookSubscriber.handle(
      busEvent('CONTACT_UPDATED', { contactId: CONTACT, clientId: CLIENT, updatedFields: ['fullName'] }),
    );
    const byId = Object.fromEntries(state.enqueue.mock.calls.map((c) => [c[0].webhookId, c[0].payload]));
    expect(byId['ids-only']).toEqual({ contact_id: CONTACT });
    expect(byId['with-client']).toEqual({ contact_id: CONTACT, client_id: CLIENT });
    expect(byId['other-entity']).toEqual({ contact_id: CONTACT, client_id: CLIENT, changed_fields: ['full_name'] });
  });
});

describe('toSnakeFieldPath', () => {
  it('converts per segment', () => {
    expect(toSnakeFieldPath('addressLine1')).toBe('address_line1');
    expect(toSnakeFieldPath('properties.accountManager')).toBe('properties.account_manager');
    expect(toSnakeFieldPath('email')).toBe('email');
  });
});

describe('quote webhooks', () => {
  it('matches quote IDs as well as client IDs', async () => {
    const { quoteWebhookSubscriber } = await import('../entityWebhookSubscribers');
    state.listForEventType.mockResolvedValue([sub({ eventFilter: { entity_ids: [LOCATION] } })]);
    await quoteWebhookSubscriber.handle(busEvent('QUOTE_SENT', { quoteId: LOCATION, clientId: CLIENT }));
    expect(state.enqueue).toHaveBeenCalledTimes(1);
    expect(state.enqueue).toHaveBeenCalledWith(expect.objectContaining({ payload: { quote_id: LOCATION, client_id: CLIENT } }));
  });

  it('filters by client and projects carried fields while retaining the quote ID', async () => {
    const { quoteWebhookSubscriber } = await import('../entityWebhookSubscribers');
    state.listForEventType.mockResolvedValue([
      sub({ eventFilter: { entity_ids: [CLIENT] }, payloadFields: { quote: ['selected_optional_item_ids'] } }),
      sub({ webhookId: 'other', eventFilter: { entity_ids: [OTHER_CLIENT] } }),
    ]);
    await quoteWebhookSubscriber.handle(busEvent('QUOTE_ACCEPTED', {
      quoteId: LOCATION, clientId: CLIENT, acceptedByName: 'A', selectedOptionalItemIds: [CONTACT],
    }));
    expect(state.listForEventType).toHaveBeenCalledWith(TENANT, 'quote.accepted');
    expect(state.enqueue).toHaveBeenCalledTimes(1);
    expect(state.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT, webhookId: 'w1', eventType: 'quote.accepted',
      payload: { quote_id: LOCATION, selected_optional_item_ids: [CONTACT] },
    }));
  });
});
