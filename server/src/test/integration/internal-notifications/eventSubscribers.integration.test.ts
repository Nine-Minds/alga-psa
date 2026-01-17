import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

type QueryQueue = Array<any>;
type JoinHelpers = {
  on: (...args: any[]) => JoinHelpers;
  andOn: (...args: any[]) => JoinHelpers;
};

const eventHandlers = new Map<string, Array<{ channel: string; handler: (event: any) => Promise<void> }>>();

const loggerMock = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
};

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

vi.mock('server/src/lib/actions/internal-notification-actions/internalNotificationActions', () => ({
  createNotificationFromTemplateInternal: createNotificationFromTemplateInternalMock,
  createNotificationFromTemplateAction: vi.fn(),
  getNotificationsAction: vi.fn(),
  getUnreadCountAction: vi.fn(),
  markAsReadAction: vi.fn(),
  markAllAsReadAction: vi.fn(),
  deleteNotificationAction: vi.fn()
}));

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
  return knexStub;
}

const expectedEventTypes = [
  'TICKET_CREATED',
  'TICKET_ASSIGNED',
  'TICKET_UPDATED',
  'TICKET_CLOSED',
  'TICKET_COMMENT_ADDED',
  'PROJECT_CREATED',
  'PROJECT_ASSIGNED',
  'PROJECT_TASK_ASSIGNED',
  'INVOICE_GENERATED',
  'MESSAGE_SENT',
  'USER_MENTIONED_IN_DOCUMENT'
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
});

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

    const assignmentEvent = {
      id: uuidv4(),
      eventType: 'TICKET_ASSIGNED' as const,
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        ticketId,
        userId: performedBy
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
    const contactId = uuidv4();
    const contactUserId = uuidv4();

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

    const event = {
      id: uuidv4(),
      eventType: 'TICKET_ASSIGNED' as const,
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        ticketId,
        userId: additionalAgentId,
        isAdditionalAgent: true
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

  it('creates status change notifications for ticket updated events', async () => {
    await registerInternalNotificationSubscriber();

    const tenantId = uuidv4();
    const ticketId = uuidv4();
    const performerId = uuidv4();
    const assignedUserId = uuidv4();
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
        }
      ],
      users: [
        {
          user_id: performerId,
          first_name: 'Taylor',
          last_name: 'Tech'
        }
      ],
      statuses: [
        { name: 'Open' },
        { name: 'Resolved' }
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

    expect(getCallByTemplate('ticket-status-changed')?.user_id).toBe(assignedUserId);

    await unregisterInternalNotificationSubscriber();
  });

  it('creates notifications for ticket closed events including client portal user', async () => {
    await registerInternalNotificationSubscriber();

    const tenantId = uuidv4();
    const ticketId = uuidv4();
    const assignedUserId = uuidv4();
    const contactId = uuidv4();
    const contactUserId = uuidv4();

    const knexStub = createConnectionStub({
      tickets: [
        {
          ticket_id: ticketId,
          ticket_number: 'T-520',
          title: 'Completed task',
          assigned_to: assignedUserId,
          contact_name_id: contactId,
          tenant: tenantId
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
      eventType: 'TICKET_CLOSED' as const,
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        ticketId,
        userId: uuidv4()
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

    const knexStub = createConnectionStub({
      'project_tasks as pt': [
        {
          task_name: 'Configure firewall',
          project_name: 'Migration'
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
        assignedTo: assignedUserId,
        userId: uuidv4()
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
        assignedTo: additionalAgentId,
        userId: assignedById,
        isAdditionalAgent: true
      }
    };

    await eventBus.publish(event, { channel: 'internal-notifications' });

    expect(getCallByTemplate('task-additional-agent-assigned')?.user_id).toBe(additionalAgentId);
    expect(getCallByTemplate('task-additional-agent-added')?.user_id).toBe(primaryAssigneeId);

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
