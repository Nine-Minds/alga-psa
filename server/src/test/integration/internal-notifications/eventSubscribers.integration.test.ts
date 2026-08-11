import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import Knex from 'knex';
import { randomUUID } from 'crypto';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { describeWithDb } from '../../../../test-utils/requireDb';
import { tenantDb, withTransaction } from '@alga-psa/db';

type QueryQueue = Array<any>;
type JoinHelpers = {
  on: (...args: any[]) => JoinHelpers;
  andOn: (...args: any[]) => JoinHelpers;
};

const eventHandlers = new Map<string, Array<{ channel: string; handler: (event: any) => Promise<void> }>>();

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Shared spies injected into the real module graph via freshSubscriber({ effects: true })
// so the DB-backed effect-timing tests can count workflow-event publishes, realtime
// broadcasts, and post-creation-hook invocations without touching real Redis/bus/Teams.
const { effectPublishWorkflowEventSpy, effectBroadcastNotificationSpy, effectHookSpy } = vi.hoisted(() => ({
  effectPublishWorkflowEventSpy: vi.fn(async () => undefined),
  effectBroadcastNotificationSpy: vi.fn(async () => undefined),
  effectHookSpy: vi.fn(),
}));

vi.mock('@alga-psa/core/logger', () => ({
  __esModule: true,
  default: loggerMock,
  ...loggerMock
}));

vi.mock('server/src/lib/eventBus', () => {
  const subscribe = vi.fn(async (eventType: string, handler: (event: any) => Promise<void>, options?: { channel?: string }) => {
    const channel = options?.channel ?? 'default';
    const handlers = eventHandlers.get(eventType) ?? [];
    handlers.push({ channel, handler });
    eventHandlers.set(eventType, handlers);
  });

  const unsubscribe = vi.fn(async (eventType: string, handler: (event: any) => Promise<void>, options?: { channel?: string }) => {
    const channel = options?.channel ?? 'default';
    const handlers = eventHandlers.get(eventType) ?? [];
    eventHandlers.set(
      eventType,
      handlers.filter(entry => entry.handler !== handler || entry.channel !== channel)
    );
  });

  const publish = vi.fn(async (event: any, options?: { channel?: string }) => {
    const channel = options?.channel ?? 'default';
    const handlers = eventHandlers.get(event.eventType) ?? [];
    for (const entry of handlers) {
      if (entry.channel === channel) {
        await entry.handler({ ...event, id: event.id ?? uuidv4(), timestamp: event.timestamp ?? new Date().toISOString() });
      }
    }
  });

  const reset = () => {
    eventHandlers.clear();
    subscribe.mockClear();
    unsubscribe.mockClear();
    publish.mockClear();
  };

  return {
    getEventBus: () => ({
      subscribe,
      unsubscribe,
      publish,
      __reset: reset,
      __handlers: eventHandlers
    })
  };
});

const createNotificationFromTemplateInternalMock = vi.fn().mockResolvedValue({
  internal_notification_id: 1
});

const reserveInboundOutboxEventForConsumerMock = vi.fn().mockResolvedValue({
  decision: 'deliver',
  token: 'test-token',
  version: 0,
});
const completeInboundOutboxEventForConsumerMock = vi.fn().mockResolvedValue(true);
const failInboundOutboxEventForConsumerMock = vi.fn().mockResolvedValue('retryable');
const recordInboundOutboxDeliveryFailureMock = vi.fn().mockResolvedValue('retryable');

vi.mock('@alga-psa/notifications/actions', () => ({
  createNotificationFromTemplateInternal: createNotificationFromTemplateInternalMock,
  createNotificationFromTemplateAction: vi.fn(),
  getNotificationsAction: vi.fn(),
  getUnreadCountAction: vi.fn(),
  markAsReadAction: vi.fn(),
  markAllAsReadAction: vi.fn(),
  deleteNotificationAction: vi.fn()
}));

// The notification consumer runs durable inbound outbox events through the
// transactional delivery protocol: reserve + effect + `delivered` mark in ONE
// transaction. A second delivery of the same outbox event id is skipped at the
// first in-repo consumption point. Non-outbox events pass through untouched.
vi.mock('@alga-psa/shared/services/email/inboundEmailConsumerDedupe', () => ({
  INBOUND_OUTBOX_EVENT_TYPES: new Set([
    'TICKET_CREATED',
    'TICKET_ASSIGNED',
    'TICKET_UPDATED',
    'TICKET_CLOSED',
    'TICKET_COMMENT_ADDED',
  ]),
  reserveInboundOutboxEventForConsumer: reserveInboundOutboxEventForConsumerMock,
  completeInboundOutboxEventForConsumer: completeInboundOutboxEventForConsumerMock,
  failInboundOutboxEventForConsumer: failInboundOutboxEventForConsumerMock,
  recordInboundOutboxDeliveryFailure: recordInboundOutboxDeliveryFailureMock,
  newInboundDeliveryOwner: () => 'test-delivery-owner',
}));

// The subscriber routes candidate events through the transactional protocol
// only when an inbound_email_outbox row backs the event id. In this stub-driven
// suite every candidate is treated as an outbox event (the real query against
// the one-shot stub table would be consumed by the first delivery).
vi.mock('@alga-psa/shared/services/email/inboundEmailDurableStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/shared/services/email/inboundEmailDurableStore')>();
  return {
    ...actual,
    isInboundOutboxEvent: vi.fn(async () => true),
  };
});

const getConnectionMock = vi.fn();
const createTenantKnexMock = vi.fn();

vi.mock('server/src/lib/db/db', () => ({
  getConnection: getConnectionMock
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: createTenantKnexMock
}));

vi.mock('server/src/lib/utils/notificationLinkResolver', () => ({
  resolveNotificationLinks: vi.fn(async () => ({
    internalUrl: '/internal/ticket/123',
    portalUrl: '/portal/ticket/123'
  }))
}));

vi.mock('server/src/lib/utils/blocknoteUtils', () => ({
  convertBlockNoteToMarkdown: vi.fn((content: string) => content)
}));

function createQueryBuilder(queue: QueryQueue) {
  const builder: any = {};

  builder.select = vi.fn(() => builder);
  builder.selectRaw = vi.fn(() => builder);
  builder.leftJoin = vi.fn((_table: string, callback?: (this: JoinHelpers) => void) => {
    if (typeof callback === 'function') {
      const joinHelpers: JoinHelpers = {
        on: vi.fn(() => joinHelpers),
        andOn: vi.fn(() => joinHelpers)
      };
      callback.call(joinHelpers);
    }
    return builder;
  });
  builder.where = vi.fn((arg?: any) => {
    if (typeof arg === 'function') {
      arg.call(builder);
    }
    return builder;
  });
  builder.andWhere = vi.fn((arg?: any) => {
    if (typeof arg === 'function') {
      arg.call(builder);
    }
    return builder;
  });
  builder.whereIn = vi.fn(() => builder);
  builder.whereNotNull = vi.fn(() => builder);
  builder.whereNull = vi.fn(() => builder);
  builder.orderBy = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.offset = vi.fn(() => builder);
  builder.first = vi.fn(async () => queue.shift());
  builder.insert = vi.fn(async () => queue.shift());
  builder.update = vi.fn(async () => queue.shift() ?? 1);
  builder.delete = vi.fn(async () => queue.shift() ?? 1);
  builder.returning = vi.fn(() => builder);
  builder.then = (resolve: (value: any) => any, reject?: (reason: any) => any) =>
    Promise.resolve(queue.shift()).then(resolve, reject);

  return builder;
}

function createConnectionStub(responses: Record<string, any | any[]>) {
  const builders = new Map<string, ReturnType<typeof createQueryBuilder>>();
  const knexStub: any = vi.fn((table: string) => {
    const response = responses[table];
    if (response === undefined) {
      throw new Error(`No stub configured for table "${table}"`);
    }
    if (!builders.has(table)) {
      const queue = Array.isArray(response) ? [...response] : [response];
      builders.set(table, createQueryBuilder(queue));
    }
    return builders.get(table);
  });
  knexStub.raw = vi.fn(() => '');
  // The transactional delivery protocol wraps the effect in a real
  // withTransaction frame; the test stub reuses the same knex function as the
  // shared transaction handle (all tenantDb/table calls route through it).
  knexStub.transaction = vi.fn(async (cb: (trx: any) => Promise<any>) => cb(knexStub));
  return knexStub;
}

// Mirrors the subscription list in internalNotificationSubscriber's
// registerInternalNotificationSubscriber (additional-agent split 81a4a60b09,
// appointment requests a58b44ab3e, comment-update events 65c688f47a).
const expectedEventTypes = [
  'TICKET_CREATED',
  'TICKET_ASSIGNED',
  'TICKET_ADDITIONAL_AGENT_ASSIGNED',
  'TICKET_UPDATED',
  'TICKET_CLOSED',
  'TICKET_COMMENT_ADDED',
  'TICKET_COMMENT_UPDATED',
  'TASK_COMMENT_ADDED',
  'TASK_COMMENT_UPDATED',
  'PROJECT_CREATED',
  'PROJECT_ASSIGNED',
  'PROJECT_TASK_ASSIGNED',
  'PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED',
  'PROJECT_MILESTONE_READY',
  'PROJECT_BUDGET_THRESHOLD_REACHED',
  'PROJECT_BUDGET_EXCEEDED',
  'INVOICE_GENERATED',
  'MESSAGE_SENT',
  'USER_MENTIONED_IN_DOCUMENT',
  'APPOINTMENT_REQUEST_CREATED',
  'APPOINTMENT_REQUEST_APPROVED',
  'APPOINTMENT_REQUEST_DECLINED',
  'APPOINTMENT_REQUEST_CANCELLED'
];

let registerInternalNotificationSubscriber: typeof import('server/src/lib/eventBus/subscribers/internalNotificationSubscriber').registerInternalNotificationSubscriber;
let unregisterInternalNotificationSubscriber: typeof import('server/src/lib/eventBus/subscribers/internalNotificationSubscriber').unregisterInternalNotificationSubscriber;

let eventBus: ReturnType<typeof import('server/src/lib/eventBus').getEventBus> & {
  __reset: () => void;
  __handlers: typeof eventHandlers;
};

beforeAll(async () => {
  const subscriberModule = await import('server/src/lib/eventBus/subscribers/internalNotificationSubscriber');
  registerInternalNotificationSubscriber = subscriberModule.registerInternalNotificationSubscriber;
  unregisterInternalNotificationSubscriber = subscriberModule.unregisterInternalNotificationSubscriber;

  const eventBusModule = await import('server/src/lib/eventBus');
  eventBus = eventBusModule.getEventBus() as typeof eventBus;
});

beforeEach(() => {
  eventBus.__reset();
  createNotificationFromTemplateInternalMock.mockClear();
  getConnectionMock.mockReset();
  createTenantKnexMock.mockReset();
  reserveInboundOutboxEventForConsumerMock.mockReset();
  reserveInboundOutboxEventForConsumerMock.mockResolvedValue({
    decision: 'deliver',
    token: 'test-token',
    version: 0,
  });
  completeInboundOutboxEventForConsumerMock.mockReset();
  completeInboundOutboxEventForConsumerMock.mockResolvedValue(true);
  failInboundOutboxEventForConsumerMock.mockReset();
  failInboundOutboxEventForConsumerMock.mockResolvedValue('retryable');
  recordInboundOutboxDeliveryFailureMock.mockReset();
  recordInboundOutboxDeliveryFailureMock.mockResolvedValue('retryable');
});

const describeDb = await describeWithDb();

describe('internal notification event subscriber registration', () => {
  it('subscribes to all expected event types on the internal channel', async () => {
    await registerInternalNotificationSubscriber();

    const subscribeMock = eventBus.subscribe as Mock;
    expect(subscribeMock.mock.calls).toHaveLength(expectedEventTypes.length);
    for (const eventType of expectedEventTypes) {
      expect(subscribeMock).toHaveBeenCalledWith(
        eventType,
        expect.any(Function),
        expect.objectContaining({ channel: 'internal-notifications' })
      );
    }

    await unregisterInternalNotificationSubscriber();
    expect((eventBus.unsubscribe as Mock).mock.calls).toHaveLength(expectedEventTypes.length);
  });
});

describe('internal notification event handling', () => {
  const getCallByTemplate = (templateName: string) => {
    const call = createNotificationFromTemplateInternalMock.mock.calls.find(([, request]) => request.template_name === templateName);
    return call?.[1];
  };

  it('creates notification for ticket assignment events targeting the assignee', async () => {
    await registerInternalNotificationSubscriber();

    const ticketId = uuidv4();
    const tenantId = uuidv4();
    const assignedUser = uuidv4();
    const performedBy = uuidv4();

    const knexStub = createConnectionStub({
      'tickets as t': [
        {
          ticket_id: ticketId,
          ticket_number: 'T-101',
          title: 'Printer issue',
          assigned_to: assignedUser,
          priority_name: 'High',
          priority_color: '#ff0000',
          status_name: 'Open'
        }
      ],
      users: [
        {
          user_id: performedBy,
          first_name: 'Alex',
          last_name: 'Admin'
        }
      ]
    });

    getConnectionMock.mockResolvedValue(knexStub);
    createTenantKnexMock.mockResolvedValue({ knex: knexStub, tenant: tenantId });

    // Since 81a4a60b09 the handler trusts payload.userId as the assignee
    // (publishers set userId = assigned_to) and reads the performer from
    // assignedByUserId.
    const assignmentEvent = {
      id: uuidv4(),
      eventType: 'TICKET_ASSIGNED' as const,
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        ticketId,
        userId: assignedUser,
        assignedByUserId: performedBy
      }
    };

    await eventBus.publish(assignmentEvent, { channel: 'internal-notifications' });

    expect(getConnectionMock).toHaveBeenCalledWith(tenantId);
    const ticketAssignmentRequest = getCallByTemplate('ticket-assigned');
    expect(ticketAssignmentRequest).toMatchObject({
      tenant: tenantId,
      user_id: assignedUser,
      template_name: 'ticket-assigned'
    });

    await unregisterInternalNotificationSubscriber();
  });

  it('creates notifications for ticket additional agent assignments (agent, primary assignee, and client)', async () => {
    await registerInternalNotificationSubscriber();

    const ticketId = uuidv4();
    const tenantId = uuidv4();
    const primaryAssigneeId = uuidv4();
    const additionalAgentId = uuidv4();
    const assignedById = uuidv4();
    const contactId = uuidv4();
    const contactUserId = uuidv4();

    // users queue follows the handler's lookup order: assigner name,
    // additional-agent name (primary notification), portal contact,
    // additional-agent name again (client notification).
    const knexStub = createConnectionStub({
      'tickets as t': [
        {
          ticket_id: ticketId,
          ticket_number: 'T-212',
          title: 'Firewall change',
          assigned_to: primaryAssigneeId,
          contact_name_id: contactId,
          priority_name: 'High',
          priority_color: '#f00',
          status_name: 'In Progress'
        }
      ],
      users: [
        {
          user_id: assignedById,
          first_name: 'Alex',
          last_name: 'Assigner'
        },
        {
          user_id: additionalAgentId,
          first_name: 'Addy',
          last_name: 'Agent'
        },
        {
          user_id: contactUserId,
          user_type: 'client',
          contact_id: contactId
        },
        {
          user_id: additionalAgentId,
          first_name: 'Addy',
          last_name: 'Agent'
        }
      ]
    });

    getConnectionMock.mockResolvedValue(knexStub);
    createTenantKnexMock.mockResolvedValue({ knex: knexStub, tenant: tenantId });

    // Since 81a4a60b09 additional-agent assignments publish their own event
    // type with an explicit primary/additional/assigner payload instead of
    // TICKET_ASSIGNED + isAdditionalAgent.
    const event = {
      id: uuidv4(),
      eventType: 'TICKET_ADDITIONAL_AGENT_ASSIGNED' as const,
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        ticketId,
        primaryAgentId: primaryAssigneeId,
        additionalAgentId,
        assignedByUserId: assignedById
      }
    };

    await eventBus.publish(event, { channel: 'internal-notifications' });

    expect(getCallByTemplate('ticket-additional-agent-assigned')?.user_id).toBe(additionalAgentId);
    expect(getCallByTemplate('ticket-additional-agent-added')?.user_id).toBe(primaryAssigneeId);
    expect(getCallByTemplate('ticket-additional-agent-added-client')?.user_id).toBe(contactUserId);

    await unregisterInternalNotificationSubscriber();
  });

  it('does not invoke notification creation for events without handlers', async () => {
    await registerInternalNotificationSubscriber();

    const unrelatedEvent = {
      id: uuidv4(),
      eventType: 'ACCOUNTING_EXPORT_COMPLETED' as const,
      timestamp: new Date().toISOString(),
      payload: {
        tenantId: uuidv4(),
        batchId: uuidv4(),
        adapterType: 'qbo'
      }
    };

    await eventBus.publish(unrelatedEvent, { channel: 'internal-notifications' });
    expect(createNotificationFromTemplateInternalMock).not.toHaveBeenCalled();

    await unregisterInternalNotificationSubscriber();
  });

  it('creates notifications for ticket created events for assignee and portal contact', async () => {
    await registerInternalNotificationSubscriber();

    const tenantId = uuidv4();
    const ticketId = uuidv4();
    const creatorId = uuidv4();
    const assignedUserId = uuidv4();
    const contactId = uuidv4();
    const contactUserId = uuidv4();

    const knexStub = createConnectionStub({
      'tickets as t': [
        {
          ticket_id: ticketId,
          ticket_number: 'T-500',
          title: 'Printer install',
          assigned_to: assignedUserId,
          contact_name_id: contactId,
          client_id: 'client-1',
          client_name: 'Acme Inc'
        }
      ],
      users: [
        {
          user_id: contactUserId,
          user_type: 'client'
        }
      ]
    });

    getConnectionMock.mockResolvedValue(knexStub);
    createTenantKnexMock.mockResolvedValue({ knex: knexStub, tenant: tenantId });

    const event = {
      id: uuidv4(),
      eventType: 'TICKET_CREATED' as const,
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        ticketId,
        userId: creatorId
      }
    };

    await eventBus.publish(event, { channel: 'internal-notifications' });

    expect(getCallByTemplate('ticket-created')?.user_id).toBe(assignedUserId);
    expect(getCallByTemplate('ticket-created-client')?.user_id).toBe(contactUserId);

    await unregisterInternalNotificationSubscriber();
  });

  it('skips a second delivery of the same inbound outbox event id (consumer idempotency gate)', async () => {
    await registerInternalNotificationSubscriber();

    const tenantId = uuidv4();
    const ticketId = uuidv4();
    const assignedUserId = uuidv4();

    const knexStub = createConnectionStub({
      // isInboundOutboxEvent hits inbound_email_outbox first; a present row
      // routes the event through the transactional delivery protocol.
      inbound_email_outbox: [{}],
      'tickets as t': [
        {
          ticket_id: ticketId,
          ticket_number: 'T-700',
          title: 'Idempotent',
          assigned_to: assignedUserId,
          contact_name_id: null
        }
      ]
    });

    getConnectionMock.mockResolvedValue(knexStub);
    createTenantKnexMock.mockResolvedValue({ knex: knexStub, tenant: tenantId });

    const outboxEvent = {
      id: uuidv4(), // stable durable outbox row id, reused on every publish retry
      eventType: 'TICKET_CREATED' as const,
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        ticketId,
        userId: assignedUserId
      }
    };

    // First delivery: the ledger reserves the (tenant, outbox event, consumer)
    // key and the notification effect is produced inside the same transaction.
    reserveInboundOutboxEventForConsumerMock.mockReset();
    reserveInboundOutboxEventForConsumerMock.mockResolvedValueOnce({
      decision: 'deliver',
      token: 'token-1',
      version: 0,
    });
    reserveInboundOutboxEventForConsumerMock.mockResolvedValueOnce({
      decision: 'skip',
      reason: 'already_delivered',
    });
    completeInboundOutboxEventForConsumerMock.mockClear();
    createNotificationFromTemplateInternalMock.mockClear();

    await eventBus.publish(outboxEvent, { channel: 'internal-notifications' });
    // Crash-after-publish redelivery carries the SAME stable event id; the gate
    // returns skip so the effect is produced exactly once.
    await eventBus.publish(outboxEvent, { channel: 'internal-notifications' });

    expect(reserveInboundOutboxEventForConsumerMock).toHaveBeenCalledTimes(2);
    expect(reserveInboundOutboxEventForConsumerMock.mock.calls[0][0]).toMatchObject({
      consumer: 'internal-notification',
      event: { id: outboxEvent.id, eventType: 'TICKET_CREATED' },
    });
    expect(createNotificationFromTemplateInternalMock).toHaveBeenCalledTimes(1);
    expect(getCallByTemplate('ticket-created')?.user_id).toBe(assignedUserId);
    // The transactional protocol marks `delivered` in the same transaction after
    // the effect completes.
    expect(completeInboundOutboxEventForConsumerMock).toHaveBeenCalledTimes(1);

    await unregisterInternalNotificationSubscriber();
  });

  it('creates status change notifications for ticket updated events', async () => {
    await registerInternalNotificationSubscriber();

    const tenantId = uuidv4();
    const ticketId = uuidv4();
    const performerId = uuidv4();
    const assignedUserId = uuidv4();
    const boardId = uuidv4();
    const oldStatusId = uuidv4();
    const newStatusId = uuidv4();

    const knexStub = createConnectionStub({
      tickets: [
        {
          ticket_id: ticketId,
          ticket_number: 'T-510',
          title: 'VPN outage',
          assigned_to: assignedUserId,
          contact_name_id: null,
          tenant: tenantId
        },
        {
          assigned_to: assignedUserId
        }
      ],
      users: [
        {
          user_id: performerId,
          first_name: 'Taylor',
          last_name: 'Tech'
        }
      ],
      ticket_resources: [[]],
      statuses: [
        {
          tenant: tenantId,
          board_id: boardId,
          status_id: oldStatusId,
          name: 'Open'
        },
        {
          tenant: tenantId,
          board_id: boardId,
          status_id: newStatusId,
          name: 'Resolved'
        }
      ]
    });

    getConnectionMock.mockResolvedValue(knexStub);
    createTenantKnexMock.mockResolvedValue({ knex: knexStub, tenant: tenantId });

    const event = {
      id: uuidv4(),
      eventType: 'TICKET_UPDATED' as const,
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        ticketId,
        userId: performerId,
        changes: {
          status_id: {
            old: oldStatusId,
            new: newStatusId
          }
        }
      }
    };

    await eventBus.publish(event, { channel: 'internal-notifications' });

    expect(getCallByTemplate('ticket-status-changed')).toMatchObject({
      user_id: assignedUserId,
      data: expect.objectContaining({
        oldStatus: 'Open',
        newStatus: 'Resolved',
      }),
    });

    await unregisterInternalNotificationSubscriber();
  });

  it('creates notifications for ticket closed events including client portal user', async () => {
    await registerInternalNotificationSubscriber();

    const tenantId = uuidv4();
    const ticketId = uuidv4();
    const assignedUserId = uuidv4();
    const contactId = uuidv4();
    const contactUserId = uuidv4();

    const closedById = uuidv4();

    // Since 81a4a60b09 the handler notifies every assignee via
    // getAllTicketAssignees (second tickets read + ticket_resources scan) and
    // resolves the closer's name before that.
    const knexStub = createConnectionStub({
      tickets: [
        {
          ticket_id: ticketId,
          ticket_number: 'T-520',
          title: 'Completed task',
          assigned_to: assignedUserId,
          contact_name_id: contactId,
          tenant: tenantId
        },
        {
          assigned_to: assignedUserId
        }
      ],
      ticket_resources: [[]],
      users: [
        {
          user_id: closedById,
          first_name: 'Casey',
          last_name: 'Closer'
        },
        {
          user_id: contactUserId,
          user_type: 'client'
        }
      ]
    });

    getConnectionMock.mockResolvedValue(knexStub);
    createTenantKnexMock.mockResolvedValue({ knex: knexStub, tenant: tenantId });

    const event = {
      id: uuidv4(),
      eventType: 'TICKET_CLOSED' as const,
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        ticketId,
        userId: closedById
      }
    };

    await eventBus.publish(event, { channel: 'internal-notifications' });

    expect(getCallByTemplate('ticket-closed')?.user_id).toBe(assignedUserId);
    expect(getCallByTemplate('ticket-closed-client')?.user_id).toBe(contactUserId);

    await unregisterInternalNotificationSubscriber();
  });

  it('creates project created notifications for assigned user', async () => {
    await registerInternalNotificationSubscriber();

    const tenantId = uuidv4();
    const projectId = uuidv4();
    const assignedUserId = uuidv4();
    const creatorId = uuidv4();

    const knexStub = createConnectionStub({
      'projects as p': [
        {
          project_id: projectId,
          project_name: 'Migration',
          wbs_code: 'PRJ-10',
          assigned_to: assignedUserId,
          client_name: 'Globex'
        }
      ]
    });

    getConnectionMock.mockResolvedValue(knexStub);
    createTenantKnexMock.mockResolvedValue({ knex: knexStub, tenant: tenantId });

    const event = {
      id: uuidv4(),
      eventType: 'PROJECT_CREATED' as const,
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        projectId,
        userId: creatorId
      }
    };

    await eventBus.publish(event, { channel: 'internal-notifications' });

    expect(getCallByTemplate('project-created')?.user_id).toBe(assignedUserId);

    await unregisterInternalNotificationSubscriber();
  });

  it('creates project assigned notifications', async () => {
    await registerInternalNotificationSubscriber();

    const tenantId = uuidv4();
    const projectId = uuidv4();
    const assignedUserId = uuidv4();

    const knexStub = createConnectionStub({
      projects: [
        {
          project_id: projectId,
          project_name: 'Migration',
          tenant: tenantId
        }
      ]
    });

    getConnectionMock.mockResolvedValue(knexStub);
    createTenantKnexMock.mockResolvedValue({ knex: knexStub, tenant: tenantId });

    const event = {
      id: uuidv4(),
      eventType: 'PROJECT_ASSIGNED' as const,
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        projectId,
        assignedTo: assignedUserId,
        userId: uuidv4()
      }
    };

    await eventBus.publish(event, { channel: 'internal-notifications' });

    expect(getCallByTemplate('project-assigned')?.user_id).toBe(assignedUserId);

    await unregisterInternalNotificationSubscriber();
  });

  it('creates project task assigned notifications', async () => {
    await registerInternalNotificationSubscriber();

    const tenantId = uuidv4();
    const projectId = uuidv4();
    const taskId = uuidv4();
    const assignedUserId = uuidv4();
    const assignedById = uuidv4();

    const knexStub = createConnectionStub({
      'project_tasks as pt': [
        {
          task_name: 'Configure firewall',
          project_name: 'Migration'
        }
      ],
      // The handler resolves the assigner's name whenever assignedByUserId is set.
      users: [
        {
          user_id: assignedById,
          first_name: 'Al',
          last_name: 'Assigner'
        }
      ]
    });

    getConnectionMock.mockResolvedValue(knexStub);
    createTenantKnexMock.mockResolvedValue({ knex: knexStub, tenant: tenantId });

    const event = {
      id: uuidv4(),
      eventType: 'PROJECT_TASK_ASSIGNED' as const,
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        projectId,
        taskId,
        assignedToId: assignedUserId,
        assignedToType: 'user' as const,
        assignedByUserId: assignedById
      }
    };

    await eventBus.publish(event, { channel: 'internal-notifications' });

    expect(getCallByTemplate('task-assigned')?.user_id).toBe(assignedUserId);

    await unregisterInternalNotificationSubscriber();
  });

  it('creates project task additional agent notifications for the new agent and the primary assignee', async () => {
    await registerInternalNotificationSubscriber();

    const tenantId = uuidv4();
    const projectId = uuidv4();
    const taskId = uuidv4();
    const primaryAssigneeId = uuidv4();
    const additionalAgentId = uuidv4();
    const assignedById = uuidv4();

    const knexStub = createConnectionStub({
      'project_tasks as pt': [
        {
          task_name: 'Update documentation',
          primary_assignee: primaryAssigneeId,
          project_name: 'Client onboarding'
        }
      ],
      users: [
        {
          user_id: additionalAgentId,
          first_name: 'Taylor',
          last_name: 'Helper'
        }
      ]
    });

    getConnectionMock.mockResolvedValue(knexStub);
    createTenantKnexMock.mockResolvedValue({ knex: knexStub, tenant: tenantId });

    const event = {
      id: uuidv4(),
      eventType: 'PROJECT_TASK_ASSIGNED' as const,
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        projectId,
        taskId,
        assignedToId: additionalAgentId,
        assignedToType: 'user' as const,
        assignedByUserId: assignedById
      }
    };

    await eventBus.publish(event, { channel: 'internal-notifications' });

    expect(getCallByTemplate('task-assigned')?.user_id).toBe(additionalAgentId);

    await unregisterInternalNotificationSubscriber();
  });

  it('creates invoice generated notifications', async () => {
    await registerInternalNotificationSubscriber();

    const tenantId = uuidv4();
    const invoiceId = uuidv4();
    const userId = uuidv4();

    const knexStub = createConnectionStub({
      'invoices as i': [
        {
          invoice_number: 'INV-100',
          client_name: 'Globex'
        }
      ]
    });

    getConnectionMock.mockResolvedValue(knexStub);
    createTenantKnexMock.mockResolvedValue({ knex: knexStub, tenant: tenantId });

    const event = {
      id: uuidv4(),
      eventType: 'INVOICE_GENERATED' as const,
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        invoiceId,
        clientId: uuidv4(),
        userId,
        amount: 1000
      }
    };

    await eventBus.publish(event, { channel: 'internal-notifications' });

    expect(getCallByTemplate('invoice-generated')?.user_id).toBe(userId);

    await unregisterInternalNotificationSubscriber();
  });

  it('creates message sent notifications for recipients', async () => {
    await registerInternalNotificationSubscriber();

    const tenantId = uuidv4();
    const recipientId = uuidv4();

    const knexStub = createConnectionStub({});
    getConnectionMock.mockResolvedValue(knexStub);
    createTenantKnexMock.mockResolvedValue({ knex: knexStub, tenant: tenantId });

    const event = {
      id: uuidv4(),
      eventType: 'MESSAGE_SENT' as const,
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        recipientId,
        messageId: uuidv4(),
        senderId: uuidv4(),
        senderName: 'Support Agent',
        messagePreview: 'Hello there',
        conversationId: uuidv4()
      }
    };

    await eventBus.publish(event, { channel: 'internal-notifications' });

    expect(getCallByTemplate('message-sent')?.user_id).toBe(recipientId);

    await unregisterInternalNotificationSubscriber();
  });

  it('creates document mention notifications', async () => {
    await registerInternalNotificationSubscriber();

    const tenantId = uuidv4();
    const documentId = uuidv4();
    const authorId = uuidv4();
    const mentionedUserId = uuidv4();

    const content = JSON.stringify([
      {
        type: 'paragraph',
        content: [
          {
            type: 'mention',
            props: { userId: mentionedUserId }
          }
        ]
      }
    ]);

    const knexStub = createConnectionStub({
      documents: [
        {
          document_id: documentId,
          document_name: 'Security Policy',
          tenant: tenantId
        }
      ],
      users: [
        {
          first_name: 'Doc',
          last_name: 'Author'
        },
        [
          {
            user_id: mentionedUserId,
            username: 'doc.user',
            display_name: 'Doc User'
          }
        ]
      ]
    });

    getConnectionMock.mockResolvedValue(knexStub);
    createTenantKnexMock.mockResolvedValue({ knex: knexStub, tenant: tenantId });

    const event = {
      id: uuidv4(),
      eventType: 'USER_MENTIONED_IN_DOCUMENT' as const,
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        documentId,
        documentName: 'Security Policy',
        userId: authorId,
        content
      }
    };

    await eventBus.publish(event, { channel: 'internal-notifications' });

    expect(getCallByTemplate('user-mentioned-in-document')?.user_id).toBe(mentionedUserId);

    await unregisterInternalNotificationSubscriber();
  });
});

/**
 * Real-Postgres behavioral coverage for the transactional outbox delivery
 * path. The stub suites above mock the ledger, the connection layer, and the
 * notification insert; these tests drive the REAL handlers through the REAL
 * `handleInternalNotificationEvent`/harness path against `test_database` so a
 * rollback of the ledger transaction provably rolls back the notification
 * writes too (the Defect-1 regression: TICKET_CLOSED / TICKET_COMMENT_ADDED
 * used to bypass the caller-supplied transaction and commit on a separate
 * pooled connection).
 *
 * Module-graph mechanics: the file's static `vi.mock` factories apply to every
 * import, so each test that needs the real modules calls `vi.resetModules()`
 * + `vi.doUnmock(...)` (or a targeted `vi.doMock` fault injection) and then
 * `await import(...)`s the subscriber freshly. The stub suites have already
 * run by then, so the registry reset cannot disturb them.
 */
describeDb('inbound outbox transactional delivery against Postgres', () => {
  const INBOUND_OUTBOX_NOTIFICATION_CONSUMER = 'internal-notification';

  let db: Knex;
  let tenantId: string;
  const createdTicketIds: string[] = [];
  // The real handlers open the app's shared tenant pool (getConnection) against
  // test_database. Every fresh module graph owns its own pool; these must be
  // destroyed so the next DB-backed file in the same vitest fork can drop and
  // recreate test_database without lingering connections.
  const appPoolDestroyers: Array<() => Promise<void>> = [];

  type SubscriberModule = typeof import('server/src/lib/eventBus/subscribers/internalNotificationSubscriber');

  async function freshSubscriber(opts?: {
    dedupe?: {
      reserveInboundOutboxEventForConsumer?: (params: unknown) => Promise<unknown>;
      completeInboundOutboxEventForConsumer?: (params: unknown) => Promise<unknown>;
      recordInboundOutboxDeliveryFailure?: (params: unknown) => Promise<unknown>;
      failInboundOutboxEventForConsumer?: (params: unknown) => Promise<unknown>;
    };
    durableStore?: {
      reserveInboundOutboxEventDelivery?: (params: unknown) => Promise<unknown>;
      failInboundOutboxEventDelivery?: (params: unknown) => Promise<unknown>;
    };
    effects?: boolean;
  }): Promise<SubscriberModule> {
    vi.resetModules();
    vi.doUnmock('@alga-psa/shared/services/email/inboundEmailConsumerDedupe');
    vi.doUnmock('@alga-psa/shared/services/email/inboundEmailDurableStore');
    vi.doUnmock('server/src/lib/db/db');
    vi.doUnmock('@alga-psa/notifications/actions');
    vi.doUnmock('server/src/lib/utils/notificationLinkResolver');
    if (opts?.dedupe) {
      vi.doMock('@alga-psa/shared/services/email/inboundEmailConsumerDedupe', async (importOriginal) => {
        const actual = await importOriginal<typeof import('@alga-psa/shared/services/email/inboundEmailConsumerDedupe')>();
        return {
          ...actual,
          ...(opts.dedupe!.reserveInboundOutboxEventForConsumer
            ? { reserveInboundOutboxEventForConsumer: opts.dedupe!.reserveInboundOutboxEventForConsumer }
            : {}),
          ...(opts.dedupe!.completeInboundOutboxEventForConsumer
            ? { completeInboundOutboxEventForConsumer: opts.dedupe!.completeInboundOutboxEventForConsumer }
            : {}),
          ...(opts.dedupe!.recordInboundOutboxDeliveryFailure
            ? { recordInboundOutboxDeliveryFailure: opts.dedupe!.recordInboundOutboxDeliveryFailure }
            : {}),
          ...(opts.dedupe!.failInboundOutboxEventForConsumer
            ? { failInboundOutboxEventForConsumer: opts.dedupe!.failInboundOutboxEventForConsumer }
            : {}),
        };
      });
    }
    if (opts?.durableStore) {
      vi.doMock('@alga-psa/shared/services/email/inboundEmailDurableStore', async (importOriginal) => {
        const actual = await importOriginal<typeof import('@alga-psa/shared/services/email/inboundEmailDurableStore')>();
        return {
          ...actual,
          ...(opts.durableStore!.reserveInboundOutboxEventDelivery
            ? { reserveInboundOutboxEventDelivery: opts.durableStore!.reserveInboundOutboxEventDelivery }
            : {}),
          ...(opts.durableStore!.failInboundOutboxEventDelivery
            ? { failInboundOutboxEventDelivery: opts.durableStore!.failInboundOutboxEventDelivery }
            : {}),
        };
      });
    }
    if (opts?.effects) {
      // Replace the fire-and-forget external effects (workflow publish, realtime
      // broadcast) with countable spies so the DB-backed tests can assert external-effect
      // timing and counts. Post-creation hooks stay REAL (registered per test).
      vi.doMock('@alga-psa/event-bus/publishers', async (importOriginal) => {
        const actual = await importOriginal<typeof import('@alga-psa/event-bus/publishers')>();
        return {
          ...actual,
          publishWorkflowEvent: effectPublishWorkflowEventSpy,
        };
      });
      vi.doMock('@alga-psa/notifications/realtime/internalNotificationBroadcaster', async (importOriginal) => {
        const actual = await importOriginal<typeof import('@alga-psa/notifications/realtime/internalNotificationBroadcaster')>();
        return {
          ...actual,
          broadcastNotification: effectBroadcastNotificationSpy,
        };
      });
    }
    const subscriber = await import('server/src/lib/eventBus/subscribers/internalNotificationSubscriber');
    const dbModule = await import('@alga-psa/db');
    if (typeof dbModule.destroyTenantConnection === 'function') {
      appPoolDestroyers.push(() => dbModule.destroyTenantConnection());
    }
    return subscriber;
  }

  async function seedOutboxScenario(params: {
    eventType: 'TICKET_CLOSED' | 'TICKET_COMMENT_ADDED';
    assigneeId: string;
    actorUserId: string;
    contactNameId?: string | null;
  }): Promise<{ eventId: string; ticketId: string; commentId: string }> {
    const eventId = randomUUID();
    const inboxId = randomUUID();
    const ingressId = randomUUID();
    const providerId = randomUUID();
    const ticketId = randomUUID();
    const commentId = randomUUID();
    const client = await tenantDb(db, tenantId).table('clients').first<{ client_id: string }>('client_id');
    if (!client) throw new Error('Expected seeded client');

    await tenantDb(db, tenantId).table('inbound_email_ingress').insert({
      tenant: tenantId,
      ingress_id: ingressId,
      provider_id: providerId,
      provider_type: 'imap',
      ingress_key: `transactional-test:${eventId}`,
      provider_pointer: JSON.stringify({ eventId }),
      status: 'staged',
      attempt_count: 0,
      lease_version: 0,
      received_at: db.fn.now(),
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
      completed_at: db.fn.now(),
    });

    await tenantDb(db, tenantId).table('inbound_email_inbox').insert({
      tenant: tenantId,
      inbox_id: inboxId,
      ingress_id: ingressId,
      provider_id: providerId,
      provider_type: 'imap',
      normalized_message_id: `rfc822:${eventId}`,
      envelope: JSON.stringify({ eventId }),
      legacy_imported: false,
      status: 'succeeded',
      outcome_kind: 'created',
      ticket_id: ticketId,
      comment_id: commentId,
      attempt_count: 0,
      lease_version: 0,
      source_object_key: `obj-${eventId}`,
      source_sha256: `sha256-${eventId}`,
      source_size_bytes: 1,
      source_staged_at: new Date(),
      received_at: db.fn.now(),
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
      completed_at: db.fn.now(),
    });

    await tenantDb(db, tenantId).table('inbound_email_outbox').insert({
      tenant: tenantId,
      outbox_id: eventId,
      inbox_id: inboxId,
      event_key: `${params.eventType.toLowerCase()}:${eventId}`,
      event_type: params.eventType,
      payload: JSON.stringify({ tenantId, ticketId, userId: params.actorUserId }),
      publish_options: null,
      status: 'published',
      attempt_count: 0,
      lease_version: 0,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
      published_at: db.fn.now(),
    });

    await tenantDb(db, tenantId).table('tickets').insert({
      tenant: tenantId,
      ticket_id: ticketId,
      ticket_number: `T-${eventId.slice(0, 8)}`,
      title: `Transactional ${params.eventType} ${eventId.slice(0, 6)}`,
      client_id: client.client_id,
      assigned_to: params.assigneeId,
      contact_name_id: params.contactNameId ?? null,
      entered_by: params.actorUserId,
    });
    createdTicketIds.push(ticketId);

    return { eventId, ticketId, commentId };
  }

  async function countNotificationsForTicket(ticketId: string): Promise<number> {
    const row = await tenantDb(db, tenantId).table('internal_notifications')
      .where({ tenant: tenantId })
      .where('link', 'like', `%/msp/tickets/${ticketId}%`)
      .count<{ count: string }[]>('* as count')
      .first();
    return Number(row?.count ?? 0);
  }

  async function listNotificationsForTicket(ticketId: string): Promise<Array<{ template_name: string; user_id: string }>> {
    return tenantDb(db, tenantId).table('internal_notifications')
      .where({ tenant: tenantId })
      .where('link', 'like', `%/msp/tickets/${ticketId}%`)
      .select('template_name', 'user_id') as unknown as Array<{ template_name: string; user_id: string }>;
  }

  async function getDelivery(eventId: string, consumer: string): Promise<Record<string, any> | undefined> {
    return tenantDb(db, tenantId).table('inbound_email_event_deliveries')
      .where({ tenant: tenantId, outbox_id: eventId, consumer })
      .first();
  }

  function buildEvent(params: {
    eventId: string;
    eventType: 'TICKET_CLOSED' | 'TICKET_COMMENT_ADDED';
    tenantId: string;
    ticketId: string;
    actorUserId: string;
    commentId?: string;
  }): Record<string, any> {
    const payload: Record<string, any> = {
      tenantId: params.tenantId,
      ticketId: params.ticketId,
      userId: params.actorUserId,
    };
    if (params.eventType === 'TICKET_COMMENT_ADDED') {
      payload.comment = {
        id: params.commentId,
        content: 'Transactional comment body',
        author: 'Test Author',
        isInternal: false,
        authorType: 'internal',
      };
    }
    return {
      id: params.eventId,
      eventType: params.eventType,
      timestamp: new Date().toISOString(),
      payload,
    };
  }

  beforeAll(async () => {
    process.env.UNIFIED_INBOUND_EMAIL_DURABLE_MODE = 'enforce';
    db = await createTestDbConnection();
    const tenant = await tenantDb(db, 'transactional').unscoped<{ tenant: string }>('tenants', 'transactional outbox suite').first('tenant');
    if (!tenant?.tenant) throw new Error('Expected seeded tenant');
    tenantId = tenant.tenant;
  }, 180_000);

  afterEach(async () => {
    await tenantDb(db, tenantId).table('inbound_email_event_deliveries').where({ tenant: tenantId }).delete();
    await tenantDb(db, tenantId).table('inbound_email_outbox').where({ tenant: tenantId }).delete();
    await tenantDb(db, tenantId).table('inbound_email_inbox').where({ tenant: tenantId }).delete();
    await tenantDb(db, tenantId).table('inbound_email_ingress').where({ tenant: tenantId }).delete();
    while (createdTicketIds.length) {
      const ticketId = createdTicketIds.pop();
      if (!ticketId) continue;
      try {
        await tenantDb(db, tenantId).table('internal_notifications')
          .where({ tenant: tenantId })
          .where('link', 'like', `%/msp/tickets/${ticketId}%`)
          .delete();
        await tenantDb(db, tenantId).table('tickets').where({ tenant: tenantId, ticket_id: ticketId }).delete();
      } catch {
        // best effort; the seeded tickets stay untouched
      }
    }
    while (appPoolDestroyers.length) {
      const destroy = appPoolDestroyers.pop();
      if (destroy) await destroy().catch(() => undefined);
    }
  });

  afterAll(async () => {
    process.env.UNIFIED_INBOUND_EMAIL_DURABLE_MODE = 'off';
    if (db) await db.destroy();
  });

  it.each(['TICKET_CLOSED', 'TICKET_COMMENT_ADDED'] as const)(
    '%s rollback atomicity: a failed delivery leaves zero notification rows, no delivered mark, and a retryable failure record',
    async (eventType) => {
      const subscriber = await freshSubscriber();
      const { reserveInboundOutboxEventForConsumer } = await import('@alga-psa/shared/services/email/inboundEmailConsumerDedupe');
      const realUser = await tenantDb(db, tenantId).table('users')
        .where({ tenant: tenantId, user_type: 'internal' })
        .first<{ user_id: string }>('user_id');
      if (!realUser) throw new Error('Expected seeded internal user');

      const actorUserId = randomUUID();
      const { eventId, ticketId } = await seedOutboxScenario({ eventType, assigneeId: realUser.user_id, actorUserId });
      const event = buildEvent({ eventId, eventType, tenantId, ticketId, actorUserId });

      // Drive the real handler inside a real ledger transaction, then simulate
      // a crash-after-effect before commit. Post-fix the handler must run on
      // the caller-supplied transaction so its notification writes roll back
      // together with the reservation.
      await expect(withTransaction(db, async (trx) => {
        await reserveInboundOutboxEventForConsumer({
          event: { id: eventId, eventType, payload: event.payload },
          consumer: INBOUND_OUTBOX_NOTIFICATION_CONSUMER,
          db: trx,
          owner: `owner-${randomUUID()}`,
        });
        if (eventType === 'TICKET_CLOSED') {
          await subscriber.internalNotificationSubscriberTestHarness.handleTicketClosed(event, { db: trx, propagateErrors: true });
        } else {
          await subscriber.internalNotificationSubscriberTestHarness.handleTicketCommentAdded(event, { db: trx, propagateErrors: true });
        }
        throw new Error('simulated crash before commit');
      })).rejects.toThrow('simulated crash before commit');

      expect(await countNotificationsForTicket(ticketId)).toBe(0);
      expect(await getDelivery(eventId, INBOUND_OUTBOX_NOTIFICATION_CONSUMER)).toBeUndefined();

      // The transactional protocol records a retryable failure on a fresh
      // connection after the rollback (this is what handleTransactionalOutboxDelivery
      // does in its catch block); the sweeper re-drives it.
      const { recordInboundOutboxDeliveryFailure } = await import('@alga-psa/shared/services/email/inboundEmailConsumerDedupe');
      await recordInboundOutboxDeliveryFailure({
        event: { id: eventId, eventType, payload: event.payload },
        consumer: INBOUND_OUTBOX_NOTIFICATION_CONSUMER,
        db,
        error: 'simulated crash before commit',
      });
      const failure = await getDelivery(eventId, INBOUND_OUTBOX_NOTIFICATION_CONSUMER);
      expect(failure?.status).toBe('retryable_failed');
      expect(Number(failure?.attempt_count)).toBeGreaterThanOrEqual(1);
    },
    120_000,
  );

  it.each(['TICKET_CLOSED', 'TICKET_COMMENT_ADDED'] as const)(
    '%s retry then exactly-once: a recorded failure is re-driven to delivered with exactly one notification',
    async (eventType) => {
      const subscriber = await freshSubscriber();
      const actorUserId = randomUUID();
      const missingAssigneeId = randomUUID();
      const { eventId, ticketId, commentId } = await seedOutboxScenario({ eventType, assigneeId: missingAssigneeId, actorUserId });
      const event = buildEvent({ eventId, eventType, tenantId, ticketId, actorUserId, commentId });

      // First delivery: the notification insert violates the users FK because
      // the assignee does not exist yet. The effect fails, the transaction
      // rolls back, and a retryable failure is recorded for the sweeper.
      await subscriber.internalNotificationSubscriberTestHarness.handleInternalNotificationEvent(event);
      expect(await countNotificationsForTicket(ticketId)).toBe(0);
      let delivery = await getDelivery(eventId, INBOUND_OUTBOX_NOTIFICATION_CONSUMER);
      expect(delivery?.status).toBe('retryable_failed');
      expect(Number(delivery?.attempt_count)).toBe(1);

      // Repair the cause and make the retry due (the sweeper would do this).
      await tenantDb(db, tenantId).table('users').insert({
        tenant: tenantId,
        user_id: missingAssigneeId,
        username: `assignee-${missingAssigneeId.slice(0, 6)}`,
        hashed_password: 'x',
        email: `assignee-${missingAssigneeId.slice(0, 6)}@test.local`,
        user_type: 'internal',
      }).onConflict(['tenant', 'user_id']).ignore();
      await tenantDb(db, tenantId).table('inbound_email_event_deliveries')
        .where({ tenant: tenantId, outbox_id: eventId, consumer: INBOUND_OUTBOX_NOTIFICATION_CONSUMER })
        .update({ next_attempt_at: db.raw("now() - interval '1 second'") });

      // Re-drive: the reservation is reclaimed (retryable -> delivering), the
      // effect succeeds, and the ledger reaches delivered.
      await subscriber.internalNotificationSubscriberTestHarness.handleInternalNotificationEvent(event);
      delivery = await getDelivery(eventId, INBOUND_OUTBOX_NOTIFICATION_CONSUMER);
      expect(delivery?.status).toBe('delivered');
      const notifications = await listNotificationsForTicket(ticketId);
      expect(notifications).toHaveLength(1);
      expect(notifications[0].user_id).toBe(missingAssigneeId);
      expect(notifications[0].template_name).toBe(eventType === 'TICKET_CLOSED' ? 'ticket-closed' : 'ticket-comment-added');
    },
    120_000,
  );

  it.each(['TICKET_CLOSED', 'TICKET_COMMENT_ADDED'] as const)(
    '%s no duplication on replay: a delivered event redelivers as a skip with stable notification counts',
    async (eventType) => {
      const subscriber = await freshSubscriber();
      const actorUserId = randomUUID();
      const realUser = await tenantDb(db, tenantId).table('users')
        .where({ tenant: tenantId, user_type: 'internal' })
        .first<{ user_id: string }>('user_id');
      if (!realUser) throw new Error('Expected seeded internal user');

      const { eventId, ticketId, commentId } = await seedOutboxScenario({ eventType, assigneeId: realUser.user_id, actorUserId });
      const event = buildEvent({ eventId, eventType, tenantId, ticketId, actorUserId, commentId });

      await subscriber.internalNotificationSubscriberTestHarness.handleInternalNotificationEvent(event);
      const afterFirst = await listNotificationsForTicket(ticketId);
      expect(afterFirst.length).toBeGreaterThan(0);
      const delivered = await getDelivery(eventId, INBOUND_OUTBOX_NOTIFICATION_CONSUMER);
      expect(delivered?.status).toBe('delivered');

      // Same stable outbox id redelivered (crash-after-publish / sweeper force
      // re-publish): the gate skips, no second notification.
      await subscriber.internalNotificationSubscriberTestHarness.handleInternalNotificationEvent(event);
      await subscriber.internalNotificationSubscriberTestHarness.handleInternalNotificationEvent(event);

      expect(await listNotificationsForTicket(ticketId)).toEqual(afterFirst);
      expect(await countNotificationsForTicket(ticketId)).toBe(afterFirst.length);
      const stillDelivered = await getDelivery(eventId, INBOUND_OUTBOX_NOTIFICATION_CONSUMER);
      expect(stillDelivered?.status).toBe('delivered');
    },
    120_000,
  );

  it.each(['TICKET_CLOSED', 'TICKET_COMMENT_ADDED'] as const)(
    '%s failure-ledger write failure propagates: the subscriber invocation rejects instead of ACKing silently',
    async (eventType) => {
      const recordFailureThrows = vi.fn(async () => {
        throw new Error('simulated failure-ledger outage');
      });
      const subscriber = await freshSubscriber({ dedupe: { recordInboundOutboxDeliveryFailure: recordFailureThrows } });
      const actorUserId = randomUUID();
      const missingAssigneeId = randomUUID();
      const { eventId, ticketId, commentId } = await seedOutboxScenario({ eventType, assigneeId: missingAssigneeId, actorUserId });
      const event = buildEvent({ eventId, eventType, tenantId, ticketId, actorUserId, commentId });

      // Effect fails (missing assignee FK); recording the failure ALSO fails,
      // so the invocation must reject so the event bus redelivers rather than
      // ACKing an event with neither an effect nor a failure record.
      await expect(
        subscriber.internalNotificationSubscriberTestHarness.handleInternalNotificationEvent(event)
      ).rejects.toThrow('simulated failure-ledger outage');

      expect(recordFailureThrows).toHaveBeenCalledTimes(1);
      const delivery = await getDelivery(eventId, INBOUND_OUTBOX_NOTIFICATION_CONSUMER);
      expect(delivery).toBeUndefined();
      expect(await countNotificationsForTicket(ticketId)).toBe(0);
    },
    120_000,
  );

  it.each(['TICKET_CLOSED', 'TICKET_COMMENT_ADDED'] as const)(
    '%s reserve-ledger write failure does not fail open: the effect is not delivered and a retryable failure is recorded',
    async (eventType) => {
      const reserveDeliveryThrows = vi.fn(async () => {
        throw new Error('simulated reserve-ledger outage');
      });
      // Inject at the durable-store level so the REAL reserve function's error
      // path is exercised: `reserveInboundOutboxEventForConsumer` catches
      // ledger errors and, on the transactional path, must rethrow instead of
      // failing open to `{ decision: 'deliver' }`. Overriding the dedupe export
      // would bypass that catch entirely.
      const subscriber = await freshSubscriber({ durableStore: { reserveInboundOutboxEventDelivery: reserveDeliveryThrows } });
      const actorUserId = randomUUID();
      const realUser = await tenantDb(db, tenantId).table('users')
        .where({ tenant: tenantId, user_type: 'internal' })
        .first<{ user_id: string }>('user_id');
      if (!realUser) throw new Error('Expected seeded internal user');

      const { eventId, ticketId, commentId } = await seedOutboxScenario({ eventType, assigneeId: realUser.user_id, actorUserId });
      const event = buildEvent({ eventId, eventType, tenantId, ticketId, actorUserId, commentId });

      // Post-fix: the reserve error rejects inside the transaction, the whole
      // thing rolls back (no effect, no reservation), and the transactional
      // protocol records a retryable failure for the recovery sweeper. The
      // invocation resolves — the ledger failure record, not fail-open, is the
      // ACK authority. Pre-fix this would fail open, run the effect inside the
      // transaction, and commit a notification with NO ledger row.
      await subscriber.internalNotificationSubscriberTestHarness.handleInternalNotificationEvent(event);

      expect(await countNotificationsForTicket(ticketId)).toBe(0);
      const delivery = await getDelivery(eventId, INBOUND_OUTBOX_NOTIFICATION_CONSUMER);
      expect(delivery?.status).toBe('retryable_failed');
      expect(Number(delivery?.attempt_count)).toBeGreaterThanOrEqual(1);
      expect(delivery?.last_error).toContain('simulated reserve-ledger outage');
    },
    120_000,
  );

  it('withInboundOutboxDelivery propagates a failure-ledger write failure (effect fails + record fails => rejection)', async () => {
    const failRecordThrows = vi.fn(async () => {
      throw new Error('simulated fenced failure-record outage');
    });
    // Inject at the durable-store level: `withInboundOutboxDelivery` calls
    // `failInboundOutboxEventForConsumer` -> `failInboundOutboxEventDelivery`
    // through module-internal bindings, so overriding the dedupe export would
    // not reach it. Overriding the store function does.
    await freshSubscriber({ durableStore: { failInboundOutboxEventDelivery: failRecordThrows } });
    const dedupe = await import('@alga-psa/shared/services/email/inboundEmailConsumerDedupe');
    const { withInboundOutboxDelivery } = dedupe;

    const actorUserId = randomUUID();
    const { eventId, ticketId } = await seedOutboxScenario({ eventType: 'TICKET_CLOSED', assigneeId: actorUserId, actorUserId });

    const event = { id: eventId, eventType: 'TICKET_CLOSED', payload: { tenantId, ticketId, userId: actorUserId } };

    // Effect throws, and recording that failure throws: the wrapper must reject
    // (never return { status: 'failed' } to be ACKed), leaving the committed
    // `delivering` reservation for the sweeper to reclaim.
    await expect(
      withInboundOutboxDelivery({
        event,
        consumer: 'webhook',
        db,
        owner: `owner-${randomUUID()}`,
        effect: async () => {
          throw new Error('simulated effect failure');
        },
      })
    ).rejects.toThrow('simulated fenced failure-record outage');

    expect(failRecordThrows).toHaveBeenCalledTimes(1);
    const delivery = await getDelivery(eventId, 'webhook');
    expect(delivery?.status).toBe('delivering');
    expect(delivery?.lease_token).toBeTruthy();
  }, 60_000);

  // External-effect timing and counts for the transactional delivery path. The
  // internal-notification consumer's external effects (workflow event publish,
  // realtime broadcast, post-creation hooks) are registered via registerAfterCommit
  // and must fire exactly once per COMMITTED transaction — zero times when the
  // transaction rolls back after the insert, once (after commit) on success, and
  // zero re-fires when an already-delivered event is replayed as a skip.
  it('external effects are emitted zero times when the ledger transaction rolls back after the notification insert', async () => {
    const completeThrows = vi.fn(async () => {
      throw new Error('simulated completion-mark failure after effect');
    });
    const subscriber = await freshSubscriber({ effects: true, dedupe: { completeInboundOutboxEventForConsumer: completeThrows } });
    const hooksModule = await import('@alga-psa/notifications/actions/internal-notification-actions/notificationHooks');
    hooksModule.registerInternalNotificationHook((notification: unknown) => effectHookSpy(notification));
    effectPublishWorkflowEventSpy.mockClear();
    effectBroadcastNotificationSpy.mockClear();
    effectHookSpy.mockClear();

    const realUser = await tenantDb(db, tenantId).table('users')
      .where({ tenant: tenantId, user_type: 'internal' })
      .first<{ user_id: string }>('user_id');
    if (!realUser) throw new Error('Expected seeded internal user');

    const actorUserId = randomUUID();
    const { eventId, ticketId, commentId } = await seedOutboxScenario({ eventType: 'TICKET_CLOSED', assigneeId: realUser.user_id, actorUserId });
    const event = buildEvent({ eventId, eventType: 'TICKET_CLOSED', tenantId, ticketId, actorUserId, commentId });

    // Full transactional delivery path: reserve -> effect (notification insert +
    // after-commit hook registration) -> completion mark. The completion mark
    // throws, so the owning transaction rolls the effect back and the queued
    // after-commit hooks are dropped before any external effect can fire.
    await subscriber.internalNotificationSubscriberTestHarness.handleInternalNotificationEvent(event);

    expect(effectPublishWorkflowEventSpy).not.toHaveBeenCalled();
    expect(effectBroadcastNotificationSpy).not.toHaveBeenCalled();
    expect(effectHookSpy).not.toHaveBeenCalled();
    expect(await countNotificationsForTicket(ticketId)).toBe(0);
    const delivery = await getDelivery(eventId, INBOUND_OUTBOX_NOTIFICATION_CONSUMER);
    expect(delivery?.status).toBe('retryable_failed');
    expect(Number(delivery?.attempt_count)).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('successful delivery emits each external effect exactly once, after the commit', async () => {
    const subscriber = await freshSubscriber({ effects: true });
    const hooksModule = await import('@alga-psa/notifications/actions/internal-notification-actions/notificationHooks');
    const rowVisibleAtHook = { visible: false };
    // runPostCreationHooks is fire-and-forget, so capture the hook's async body
    // in a promise we can await after the delivery resolves.
    let hookPromise: Promise<void> = Promise.resolve();
    hooksModule.registerInternalNotificationHook((notification: any) => {
      hookPromise = (async () => {
        // A separate connection observes the notification row only because the
        // transaction committed BEFORE the after-commit hooks flushed — proving the
        // effects fire after the commit, never inside the open transaction.
        const count = await tenantDb(db, tenantId).table('internal_notifications')
          .where({ tenant: tenantId, internal_notification_id: notification.internal_notification_id })
          .count<{ count: string }[]>('* as count')
          .first();
        rowVisibleAtHook.visible = Number(count?.count) > 0;
        effectHookSpy(notification);
      })();
    });
    effectPublishWorkflowEventSpy.mockClear();
    effectBroadcastNotificationSpy.mockClear();
    effectHookSpy.mockClear();

    const realUser = await tenantDb(db, tenantId).table('users')
      .where({ tenant: tenantId, user_type: 'internal' })
      .first<{ user_id: string }>('user_id');
    if (!realUser) throw new Error('Expected seeded internal user');

    const actorUserId = randomUUID();
    const { eventId, ticketId, commentId } = await seedOutboxScenario({ eventType: 'TICKET_CLOSED', assigneeId: realUser.user_id, actorUserId });
    const event = buildEvent({ eventId, eventType: 'TICKET_CLOSED', tenantId, ticketId, actorUserId, commentId });

    await subscriber.internalNotificationSubscriberTestHarness.handleInternalNotificationEvent(event);
    await hookPromise;

    expect(effectPublishWorkflowEventSpy).toHaveBeenCalledTimes(1);
    expect(effectPublishWorkflowEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'NOTIFICATION_SENT' })
    );
    expect(effectBroadcastNotificationSpy).toHaveBeenCalledTimes(1);
    expect(effectHookSpy).toHaveBeenCalledTimes(1);
    expect(rowVisibleAtHook.visible).toBe(true);
    expect(await countNotificationsForTicket(ticketId)).toBe(1);
    const delivery = await getDelivery(eventId, INBOUND_OUTBOX_NOTIFICATION_CONSUMER);
    expect(delivery?.status).toBe('delivered');
  }, 120_000);

  it('replay of an already-delivered outbox event re-fires zero external effects', async () => {
    const subscriber = await freshSubscriber({ effects: true });
    const hooksModule = await import('@alga-psa/notifications/actions/internal-notification-actions/notificationHooks');
    hooksModule.registerInternalNotificationHook((notification: unknown) => effectHookSpy(notification));
    effectPublishWorkflowEventSpy.mockClear();
    effectBroadcastNotificationSpy.mockClear();
    effectHookSpy.mockClear();

    const realUser = await tenantDb(db, tenantId).table('users')
      .where({ tenant: tenantId, user_type: 'internal' })
      .first<{ user_id: string }>('user_id');
    if (!realUser) throw new Error('Expected seeded internal user');

    const actorUserId = randomUUID();
    const { eventId, ticketId, commentId } = await seedOutboxScenario({ eventType: 'TICKET_CLOSED', assigneeId: realUser.user_id, actorUserId });
    const event = buildEvent({ eventId, eventType: 'TICKET_CLOSED', tenantId, ticketId, actorUserId, commentId });

    // First delivery: committed, delivered, effects fired once.
    await subscriber.internalNotificationSubscriberTestHarness.handleInternalNotificationEvent(event);
    const afterFirst = await listNotificationsForTicket(ticketId);
    expect(afterFirst.length).toBe(1);
    const delivered = await getDelivery(eventId, INBOUND_OUTBOX_NOTIFICATION_CONSUMER);
    expect(delivered?.status).toBe('delivered');

    // Two redeliveries of the same stable outbox event id: the reservation skips,
    // the effect is NOT re-produced, and the external effects do NOT re-fire.
    await subscriber.internalNotificationSubscriberTestHarness.handleInternalNotificationEvent(event);
    await subscriber.internalNotificationSubscriberTestHarness.handleInternalNotificationEvent(event);

    expect(effectPublishWorkflowEventSpy).toHaveBeenCalledTimes(1);
    expect(effectBroadcastNotificationSpy).toHaveBeenCalledTimes(1);
    expect(effectHookSpy).toHaveBeenCalledTimes(1);
    expect(await listNotificationsForTicket(ticketId)).toEqual(afterFirst);
    const stillDelivered = await getDelivery(eventId, INBOUND_OUTBOX_NOTIFICATION_CONSUMER);
    expect(stillDelivered?.status).toBe('delivered');
  }, 120_000);
});
