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

const payloadState = vi.hoisted(() => ({
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

vi.mock('@/lib/eventBus/subscribers/webhook/webhookProjectPayload', () => ({
  buildProjectWebhookPayload: (...args: unknown[]) =>
    payloadState.buildProjectWebhookPayloadMock(...args),
  buildProjectTaskWebhookPayload: (...args: unknown[]) =>
    payloadState.buildProjectTaskWebhookPayloadMock(...args),
  fetchProjectPhasesForWebhook: (...args: unknown[]) =>
    payloadState.fetchProjectPhasesForWebhookMock(...args),
  fetchProjectTaskCountsForWebhook: (...args: unknown[]) =>
    payloadState.fetchProjectTaskCountsForWebhookMock(...args),
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
} from '../projectWebhookSubscriber';

const TENANT = 'tenant-a';

describe('projectWebhookSubscriber', () => {
  beforeEach(async () => {
    eventBusState.handlers.clear();
    webhookModelState.listForEventTypeMock.mockReset();
    queueState.enqueueMock.mockReset();
    queueState.enqueueMock.mockResolvedValue(undefined);
    payloadState.buildProjectWebhookPayloadMock.mockReset();
    payloadState.buildProjectTaskWebhookPayloadMock.mockReset();
    payloadState.fetchProjectPhasesForWebhookMock.mockReset();
    payloadState.fetchProjectTaskCountsForWebhookMock.mockReset();

    payloadState.buildProjectWebhookPayloadMock.mockResolvedValue({
      project_id: 'project-1',
      project_name: 'Migration',
      client_name: 'Acme',
    });
    payloadState.buildProjectTaskWebhookPayloadMock.mockResolvedValue({
      project_id: 'project-1',
      task_id: 'task-1',
      task_name: 'Draft plan',
      client_name: 'Acme',
    });
    payloadState.fetchProjectPhasesForWebhookMock.mockResolvedValue([
      { phase_id: 'phase-1', phase_name: 'Planning' },
    ]);
    payloadState.fetchProjectTaskCountsForWebhookMock.mockResolvedValue({
      total: 1,
      completed: 0,
      overdue: 0,
      by_status: { Open: 1 },
    });

    await unregisterProjectWebhookSubscriber();
    await registerProjectWebhookSubscriber();
  });

  afterEach(async () => {
    await unregisterProjectWebhookSubscriber();
  });

  it('enqueues project-level payloads for matching project filters and fetches opt-in sections once', async () => {
    webhookModelState.listForEventTypeMock.mockResolvedValue([
      {
        webhookId: 'webhook-1',
        eventFilter: { entity_ids: ['project-1'] },
        payloadFields: { project: ['project_name', 'phases'] },
      },
      {
        webhookId: 'webhook-2',
        eventFilter: { entity_ids: ['project-1'] },
        payloadFields: { project: ['client_name', 'phases'] },
      },
      {
        webhookId: 'webhook-3',
        eventFilter: { entity_ids: ['project-2'] },
        payloadFields: { project: ['project_name'] },
      },
    ]);

    const handlers = eventBusState.handlers.get('PROJECT_CREATED');
    expect(handlers).toBeDefined();
    const [handler] = Array.from(handlers!) as Array<(event: unknown) => Promise<void>>;

    await handler({
      id: 'event-project-1',
      timestamp: '2026-05-15T13:00:00.000Z',
      eventType: 'PROJECT_CREATED',
      payload: {
        tenantId: TENANT,
        projectId: 'project-1',
      },
    });

    expect(webhookModelState.listForEventTypeMock).toHaveBeenCalledWith(TENANT, 'project.created');
    expect(payloadState.fetchProjectPhasesForWebhookMock).toHaveBeenCalledTimes(1);
    expect(payloadState.fetchProjectTaskCountsForWebhookMock).not.toHaveBeenCalled();
    expect(queueState.enqueueMock).toHaveBeenCalledTimes(2);
    expect(queueState.enqueueMock.mock.calls[0][0]).toMatchObject({
      webhookId: 'webhook-1',
      eventType: 'project.created',
      payload: {
        project_id: 'project-1',
        project_name: 'Migration',
        phases: [{ phase_id: 'phase-1', phase_name: 'Planning' }],
      },
    });
    expect(queueState.enqueueMock.mock.calls[1][0]).toMatchObject({
      webhookId: 'webhook-2',
      payload: {
        project_id: 'project-1',
        client_name: 'Acme',
        phases: [{ phase_id: 'phase-1', phase_name: 'Planning' }],
      },
    });
  });

  it('filters task-level events on task id and always retains task_id through projection', async () => {
    webhookModelState.listForEventTypeMock.mockResolvedValue([
      {
        webhookId: 'webhook-task',
        eventFilter: { entity_ids: ['task-1'] },
        payloadFields: { project: ['task_name'] },
      },
    ]);

    const handlers = eventBusState.handlers.get('PROJECT_TASK_UPDATED');
    expect(handlers).toBeDefined();
    const [handler] = Array.from(handlers!) as Array<(event: unknown) => Promise<void>>;

    await handler({
      id: 'event-task-1',
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
      webhookId: 'webhook-task',
      eventType: 'project.task.updated',
      payload: {
        project_id: 'project-1',
        task_id: 'task-1',
        task_name: 'Draft plan',
      },
    });
  });
});
