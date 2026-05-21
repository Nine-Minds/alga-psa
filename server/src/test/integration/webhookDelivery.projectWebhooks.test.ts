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

const ticketPayloadState = vi.hoisted(() => ({
  buildTicketWebhookPayloadMock: vi.fn(),
  fetchTicketCommentsForWebhookMock: vi.fn(),
}));

const projectPayloadState = vi.hoisted(() => ({
  buildProjectWebhookPayloadMock: vi.fn(),
  buildProjectTaskWebhookPayloadMock: vi.fn(),
  fetchProjectPhasesForWebhookMock: vi.fn(),
  fetchProjectTaskCountsForWebhookMock: vi.fn(),
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
  buildTicketWebhookPayload: (...args: unknown[]) =>
    ticketPayloadState.buildTicketWebhookPayloadMock(...args),
  clearTicketWebhookPayloadCache: vi.fn(),
  fetchTicketCommentsForWebhook: (...args: unknown[]) =>
    ticketPayloadState.fetchTicketCommentsForWebhookMock(...args),
}));

vi.mock('@/lib/eventBus/subscribers/webhook/webhookProjectPayload', () => ({
  buildProjectWebhookPayload: (...args: unknown[]) =>
    projectPayloadState.buildProjectWebhookPayloadMock(...args),
  buildProjectTaskWebhookPayload: (...args: unknown[]) =>
    projectPayloadState.buildProjectTaskWebhookPayloadMock(...args),
  fetchProjectPhasesForWebhook: (...args: unknown[]) =>
    projectPayloadState.fetchProjectPhasesForWebhookMock(...args),
  fetchProjectTaskCountsForWebhook: (...args: unknown[]) =>
    projectPayloadState.fetchProjectTaskCountsForWebhookMock(...args),
}));

vi.mock('@/lib/webhooks/WebhookDeliveryQueue', () => ({
  WebhookDeliveryQueue: {
    getInstance: () => ({
      enqueue: (...args: unknown[]) => queueState.enqueueMock(...args),
    }),
  },
}));

import {
  registerProjectWebhookSubscriber,
  unregisterProjectWebhookSubscriber,
} from '@/lib/eventBus/subscribers/projectWebhookSubscriber';
import {
  registerWebhookSubscriber,
  unregisterWebhookSubscriber,
} from '@/lib/eventBus/subscribers/webhookSubscriber';

const TENANT = 'tenant-a';

function getHandler(eventType: string): (event: unknown) => Promise<void> {
  const handlers = eventBusState.handlers.get(eventType);
  if (!handlers) throw new Error(`${eventType} handlers missing`);
  const [handler] = Array.from(handlers) as Array<(event: unknown) => Promise<void>>;
  return handler;
}

describe('project webhook delivery integration fixtures', () => {
  beforeEach(async () => {
    eventBusState.handlers.clear();
    webhookModelState.listForEventTypeMock.mockReset();
    queueState.enqueueMock.mockReset();
    queueState.enqueueMock.mockResolvedValue(undefined);
    ticketPayloadState.buildTicketWebhookPayloadMock.mockReset();
    ticketPayloadState.fetchTicketCommentsForWebhookMock.mockReset();
    projectPayloadState.buildProjectWebhookPayloadMock.mockReset();
    projectPayloadState.buildProjectTaskWebhookPayloadMock.mockReset();
    projectPayloadState.fetchProjectPhasesForWebhookMock.mockReset();
    projectPayloadState.fetchProjectTaskCountsForWebhookMock.mockReset();

    ticketPayloadState.fetchTicketCommentsForWebhookMock.mockResolvedValue([]);
    projectPayloadState.fetchProjectPhasesForWebhookMock.mockResolvedValue([
      { phase_id: 'phase-1', phase_name: 'Planning' },
    ]);
    projectPayloadState.fetchProjectTaskCountsForWebhookMock.mockResolvedValue({
      total: 1,
      completed: 0,
      overdue: 0,
      by_status: { Open: 1 },
    });

    await unregisterWebhookSubscriber();
    await unregisterProjectWebhookSubscriber();
    await registerWebhookSubscriber();
    await registerProjectWebhookSubscriber();
  });

  afterEach(async () => {
    await unregisterWebhookSubscriber();
    await unregisterProjectWebhookSubscriber();
  });

  it('delivers project.created with field projection and phases opt-in', async () => {
    projectPayloadState.buildProjectWebhookPayloadMock.mockResolvedValue({
      project_id: 'project-1',
      project_name: 'Migration',
      client_name: 'Acme',
    });
    webhookModelState.listForEventTypeMock.mockResolvedValue([
      {
        webhookId: 'project-webhook',
        eventFilter: { entity_ids: ['project-1'] },
        payloadFields: { project: ['project_name', 'phases'] },
      },
    ]);

    await getHandler('PROJECT_CREATED')({
      id: 'event-project-created',
      timestamp: '2026-05-15T13:00:00.000Z',
      eventType: 'PROJECT_CREATED',
      payload: {
        tenantId: TENANT,
        projectId: 'project-1',
      },
    });

    expect(webhookModelState.listForEventTypeMock).toHaveBeenCalledWith(TENANT, 'project.created');
    expect(projectPayloadState.fetchProjectPhasesForWebhookMock).toHaveBeenCalledTimes(1);
    expect(queueState.enqueueMock).toHaveBeenCalledTimes(1);
    expect(queueState.enqueueMock.mock.calls[0][0]).toMatchObject({
      webhookId: 'project-webhook',
      eventType: 'project.created',
      tenantId: TENANT,
      payload: {
        project_id: 'project-1',
        project_name: 'Migration',
        phases: [{ phase_id: 'phase-1', phase_name: 'Planning' }],
      },
    });
    expect(queueState.enqueueMock.mock.calls[0][0].payload.client_name).toBeUndefined();
  });

  it('delivers project.task.updated tag-only payloads with task_id retained', async () => {
    projectPayloadState.buildProjectTaskWebhookPayloadMock.mockImplementation(async (event: any) => ({
      project_id: event.payload.projectId,
      task_id: event.payload.taskId,
      task_name: 'Draft plan',
      changes: event.payload.changes,
    }));
    webhookModelState.listForEventTypeMock.mockResolvedValue([
      {
        webhookId: 'project-task-webhook',
        eventFilter: { entity_ids: ['task-1'] },
        payloadFields: { project: ['changes'] },
      },
    ]);

    await getHandler('PROJECT_TASK_UPDATED')({
      id: 'event-project-task-updated',
      timestamp: '2026-05-15T13:00:00.000Z',
      eventType: 'PROJECT_TASK_UPDATED',
      payload: {
        tenantId: TENANT,
        projectId: 'project-1',
        taskId: 'task-1',
        changes: {
          tags: {
            previous: [],
            new: ['urgent'],
          },
        },
      },
    });

    expect(queueState.enqueueMock).toHaveBeenCalledTimes(1);
    expect(queueState.enqueueMock.mock.calls[0][0]).toMatchObject({
      webhookId: 'project-task-webhook',
      eventType: 'project.task.updated',
      payload: {
        project_id: 'project-1',
        task_id: 'task-1',
        changes: {
          tags: {
            previous: [],
            new: ['urgent'],
          },
        },
      },
    });
  });

  it('delivers ticket.updated tag-only payloads with changes.tags', async () => {
    ticketPayloadState.buildTicketWebhookPayloadMock.mockImplementation(async (event: any) => ({
      ticket_id: event.payload.ticketId,
      changes: event.payload.changes,
    }));
    webhookModelState.listForEventTypeMock.mockResolvedValue([
      {
        webhookId: 'ticket-webhook',
        eventFilter: { entity_ids: ['ticket-1'] },
        payloadFields: { ticket: ['changes'] },
      },
    ]);

    await getHandler('TICKET_UPDATED')({
      id: 'event-ticket-updated',
      timestamp: '2026-05-15T13:00:00.000Z',
      eventType: 'TICKET_UPDATED',
      payload: {
        tenantId: TENANT,
        ticketId: 'ticket-1',
        changes: {
          tags: {
            previous: ['old'],
            new: ['new'],
          },
        },
      },
    });

    expect(queueState.enqueueMock).toHaveBeenCalledTimes(1);
    expect(queueState.enqueueMock.mock.calls[0][0]).toMatchObject({
      webhookId: 'ticket-webhook',
      eventType: 'ticket.updated',
      payload: {
        ticket_id: 'ticket-1',
        changes: {
          tags: {
            previous: ['old'],
            new: ['new'],
          },
        },
      },
    });
  });
});
