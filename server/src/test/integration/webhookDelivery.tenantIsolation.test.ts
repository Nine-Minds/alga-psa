import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const eventBusState = vi.hoisted(() => ({
  handlers: new Map<string, Set<(event: unknown) => Promise<void>>>(),
  subscribeMock: vi.fn(),
  unsubscribeMock: vi.fn(),
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
      eventBusState.subscribeMock(eventType, handler);
    },
    unsubscribe: async (eventType: string, handler: any) => {
      eventBusState.handlers.get(eventType)?.delete(handler);
      eventBusState.unsubscribeMock(eventType, handler);
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

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const WEBHOOK_A = 'webhook-a';
const WEBHOOK_B = 'webhook-b';

describe('webhookDelivery tenant isolation (T026)', () => {
  beforeEach(async () => {
    eventBusState.handlers.clear();
    eventBusState.subscribeMock.mockReset();
    eventBusState.unsubscribeMock.mockReset();
    webhookModelState.listForEventTypeMock.mockReset();
    queueState.enqueueMock.mockReset();
    queueState.enqueueMock.mockResolvedValue(undefined);

    await unregisterWebhookSubscriber();
    await registerWebhookSubscriber();
  });

  afterEach(async () => {
    await unregisterWebhookSubscriber();
  });

  it('TICKET_ASSIGNED in tenant TA enqueues only webhook A; tenant B is not queried and not enqueued', async () => {
    webhookModelState.listForEventTypeMock.mockImplementation(async (tenantId: string) => {
      if (tenantId === TENANT_A) {
        return [
          {
            tenant: TENANT_A,
            webhookId: WEBHOOK_A,
            eventFilter: null,
            isActive: true,
            url: 'http://example.invalid/a',
          },
        ];
      }
      // We deliberately seed a webhook in TB to prove cross-tenant queries don't happen.
      return [
        {
          tenant: TENANT_B,
          webhookId: WEBHOOK_B,
          eventFilter: null,
          isActive: true,
          url: 'http://example.invalid/b',
        },
      ];
    });

    const handlers = eventBusState.handlers.get('TICKET_ASSIGNED');
    expect(handlers).toBeDefined();
    const [handler] = Array.from(handlers!);

    await handler({
      id: 'event-ta-1',
      timestamp: '2026-05-06T15:00:00.000Z',
      eventType: 'TICKET_ASSIGNED',
      payload: {
        tenantId: TENANT_A,
        ticketId: 'ticket-1',
      },
    });

    // listForEventType is called with the publishing tenant only — never with the bystander tenant.
    expect(webhookModelState.listForEventTypeMock).toHaveBeenCalledTimes(1);
    expect(webhookModelState.listForEventTypeMock).toHaveBeenCalledWith(TENANT_A, 'ticket.assigned');

    // enqueue is called once and is tagged for tenant A's webhook only.
    expect(queueState.enqueueMock).toHaveBeenCalledTimes(1);
    const enqueuedJob = queueState.enqueueMock.mock.calls[0][0];
    expect(enqueuedJob).toMatchObject({
      webhookId: WEBHOOK_A,
      tenantId: TENANT_A,
      eventType: 'ticket.assigned',
    });
    expect(enqueuedJob.tenantId).not.toBe(TENANT_B);
    expect(enqueuedJob.webhookId).not.toBe(WEBHOOK_B);
  });
});
