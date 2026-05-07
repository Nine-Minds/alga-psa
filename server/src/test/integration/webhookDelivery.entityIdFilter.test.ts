import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const eventBusState = vi.hoisted(() => ({
  handlers: new Map<string, Set<(event: unknown) => Promise<void>>>(),
}));

const webhookModelState = vi.hoisted(() => ({
  listForEventTypeMock: vi.fn(),
}));

const queueState = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
}));

vi.mock('@/lib/eventBus', () => ({
  getEventBus: () => ({
    subscribe: async (eventType: string, handler: any) => {
      let set = eventBusState.handlers.get(eventType);
      if (!set) {
        set = new Set();
        eventBusState.handlers.set(eventType, set);
      }
      set.add(handler);
    },
    unsubscribe: async (eventType: string, handler: any) => {
      eventBusState.handlers.get(eventType)?.delete(handler);
    },
  }),
}));

vi.mock('@/lib/webhooks/webhookModel', () => ({
  webhookModel: {
    listForEventType: (...args: unknown[]) => webhookModelState.listForEventTypeMock(...args),
  },
}));

vi.mock('@/lib/db/db', () => ({
  getConnection: vi.fn(async () => ({})),
}));

vi.mock('@/lib/eventBus/subscribers/webhook/webhookTicketPayload', () => ({
  buildTicketWebhookPayload: vi.fn(async (event: any) => ({
    ticket_id: event.payload.ticketId,
    tags: [],
  })),
  clearTicketWebhookPayloadCache: vi.fn(),
  fetchTicketCommentsForWebhook: vi.fn(async () => []),
  projectWebhookPayload: vi.fn((_entity: string, payload: any) => payload),
  projectTicketWebhookPayload: vi.fn((payload: any) => payload),
}));

vi.mock('@/lib/webhooks/WebhookDeliveryQueue', () => ({
  WebhookDeliveryQueue: {
    getInstance: () => ({
      enqueue: (...args: unknown[]) => queueState.enqueueMock(...args),
    }),
  },
}));

import {
  registerWebhookSubscriber,
  unregisterWebhookSubscriber,
} from '@/lib/eventBus/subscribers/webhookSubscriber';

const TENANT = 'tenant-a';
const WEBHOOK_ID = 'webhook-1';

describe('webhookDelivery entity_ids filter (T034)', () => {
  beforeEach(async () => {
    eventBusState.handlers.clear();
    webhookModelState.listForEventTypeMock.mockReset();
    queueState.enqueueMock.mockReset();
    queueState.enqueueMock.mockResolvedValue(undefined);

    webhookModelState.listForEventTypeMock.mockResolvedValue([
      {
        tenant: TENANT,
        webhookId: WEBHOOK_ID,
        eventFilter: { entity_ids: ['ticket-X', 'ticket-Y'] },
        isActive: true,
      },
    ]);

    await unregisterWebhookSubscriber();
    await registerWebhookSubscriber();
  });

  afterEach(async () => {
    await unregisterWebhookSubscriber();
  });

  function fireTicketAssigned(ticketId: string) {
    const handlers = eventBusState.handlers.get('TICKET_ASSIGNED');
    if (!handlers) throw new Error('TICKET_ASSIGNED handlers missing');
    const [handler] = Array.from(handlers);
    return handler({
      id: `event-${ticketId}`,
      timestamp: '2026-05-06T15:00:00.000Z',
      eventType: 'TICKET_ASSIGNED',
      payload: { tenantId: TENANT, ticketId },
    });
  }

  it('enqueues for ticket-X (in filter) but not for ticket-Z (out of filter)', async () => {
    await fireTicketAssigned('ticket-X');
    expect(queueState.enqueueMock).toHaveBeenCalledTimes(1);
    expect(queueState.enqueueMock.mock.calls[0][0]).toMatchObject({
      webhookId: WEBHOOK_ID,
      tenantId: TENANT,
      payload: expect.objectContaining({ ticket_id: 'ticket-X' }),
    });

    queueState.enqueueMock.mockClear();

    await fireTicketAssigned('ticket-Z');
    expect(queueState.enqueueMock).not.toHaveBeenCalled();
  });

  it('without entity_ids set, all tickets match (filter omitted entirely)', async () => {
    webhookModelState.listForEventTypeMock.mockResolvedValue([
      {
        tenant: TENANT,
        webhookId: WEBHOOK_ID,
        eventFilter: null,
        isActive: true,
      },
    ]);

    await fireTicketAssigned('ticket-Z');
    expect(queueState.enqueueMock).toHaveBeenCalledTimes(1);
    expect(queueState.enqueueMock.mock.calls[0][0].payload).toMatchObject({ ticket_id: 'ticket-Z' });
  });
});
