import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('@alga-psa/shared/core/logger', () => ({
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

const createNotificationFromTemplateActionMock = vi.fn().mockResolvedValue({
  internal_notification_id: 1
});

vi.mock('server/src/lib/actions/internal-notification-actions/internalNotificationActions', () => ({
  createNotificationFromTemplateAction: createNotificationFromTemplateActionMock,
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
  createNotificationFromTemplateActionMock.mockClear();
  getConnectionMock.mockReset();
});

describe('Mention notifications via TICKET_COMMENT_ADDED', () => {
  it('creates notifications for mentioned users and excludes the author', async () => {
    await registerInternalNotificationSubscriber();

    const tenantId = uuidv4();
    const ticketId = uuidv4();
    const commentId = uuidv4();
    const authorId = uuidv4();
    const mentionedUserId = uuidv4();

    const blockNoteContent = JSON.stringify([
      {
        type: 'paragraph',
        content: [
          {
            type: 'mention',
            props: {
              userId: mentionedUserId
            }
          },
          {
            type: 'text',
            text: ' can you help?'
          }
        ]
      }
    ]);

    const knexStub = createConnectionStub({
      tickets: [
        {
          ticket_id: ticketId,
          ticket_number: 'T-42',
          title: 'Printer offline',
          assigned_to: null,
          contact_name_id: null
        }
      ],
      users: [
        {
          user_id: authorId,
          first_name: 'Alice',
          last_name: 'Author'
        },
        [
          {
            user_id: mentionedUserId,
            username: 'bob.mentioned',
            display_name: 'Bob Mentioned'
          }
        ]
      ]
    });

    getConnectionMock.mockResolvedValue(knexStub);
    createTenantKnexMock.mockResolvedValue({ knex: knexStub, tenant: tenantId });

    const handlers = eventBus.__handlers.get('TICKET_COMMENT_ADDED');
    expect(handlers?.length).toBeGreaterThan(0);
    const handler = handlers![0].handler;

    await handler({
      id: uuidv4(),
      eventType: 'TICKET_COMMENT_ADDED',
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        ticketId,
        userId: authorId,
        comment: {
          id: commentId,
          content: blockNoteContent,
          isInternal: false,
          author: 'Alice Author'
        }
      }
    });

    const calls = createNotificationFromTemplateActionMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const mentionCall = calls.find(([args]) => args.user_id === mentionedUserId && args.template_name === 'user-mentioned-in-comment');
    expect(mentionCall).toBeDefined();

    const authorCall = calls.find(([args]) => args.user_id === authorId);
    expect(authorCall).toBeUndefined();

    await unregisterInternalNotificationSubscriber();
  });

  it('does not notify client portal contact for internal comments', async () => {
    await registerInternalNotificationSubscriber();

    const tenantId = uuidv4();
    const ticketId = uuidv4();
    const commentId = uuidv4();
    const authorId = uuidv4();
    const contactUserId = uuidv4();

    const blockNoteContent = JSON.stringify([
      {
        type: 'paragraph',
        content: [
          {
            type: 'mention',
            props: {
              userId: contactUserId
            }
          }
        ]
      }
    ]);

    const knexStub = createConnectionStub({
      tickets: [
        {
          ticket_id: ticketId,
          ticket_number: 'T-100',
          title: 'VPN Issue',
          assigned_to: null,
          contact_name_id: 'contact-1'
        }
      ],
      users: [
        {
          user_id: authorId,
          first_name: 'Alex',
          last_name: 'Admin'
        },
        [
          {
            user_id: contactUserId,
            username: 'client.user',
            display_name: 'Client User'
          }
        ],
        null // Contact lookup should resolve to null because comment is internal
      ]
    });

    getConnectionMock.mockResolvedValue(knexStub);
    createTenantKnexMock.mockResolvedValue({ knex: knexStub, tenant: tenantId });

    const handlers = eventBus.__handlers.get('TICKET_COMMENT_ADDED');
    const handler = handlers![0].handler;

    await handler({
      id: uuidv4(),
      eventType: 'TICKET_COMMENT_ADDED',
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        ticketId,
        userId: authorId,
        comment: {
          id: commentId,
          content: blockNoteContent,
          isInternal: true,
          author: 'Alex Admin'
        }
      }
    });

    const calls = createNotificationFromTemplateActionMock.mock.calls;
    const clientPortalCall = calls.find(([args]) => args.template_name === 'ticket-comment-added-client');
    expect(clientPortalCall).toBeUndefined();

    await unregisterInternalNotificationSubscriber();
  });
});
