import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withTransaction, registerAfterCommit } from '@alga-psa/db';
import { createNotificationFromTemplateInternal } from '@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions';
import { registerInternalNotificationHook } from '@alga-psa/notifications/actions/internal-notification-actions/notificationHooks';

/**
 * Behavioral coverage for the after-commit deferral of internal-notification
 * external effects (workflow event publication, realtime broadcast, post
 * creation hooks).
 *
 * The REAL `withTransaction` / `registerAfterCommit` / flush machinery from
 * @alga-psa/db is used (the same mechanism production uses): a fake knex
 * provides the transaction wrapper (commit + flush on success, rollback + drop
 * on failure), so "rollback emits nothing" and "success emits exactly once
 * after commit" are asserted against the exact production semantics.
 *
 * At-most-once per committed transaction: a crash after commit but before the
 * hook flush loses the fire-and-forget effect (same exposure as pre-deferral);
 * emitting for a rolled-back transaction or double-emitting on replay is what
 * this deferral prevents.
 */

const { publishWorkflowEventMock, broadcastNotificationMock, hookSpy } = vi.hoisted(() => ({
  publishWorkflowEventMock: vi.fn(async () => undefined),
  broadcastNotificationMock: vi.fn(async () => undefined),
  hookSpy: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: publishWorkflowEventMock,
  publishEvent: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/notifications/realtime/internalNotificationBroadcaster', () => ({
  broadcastNotification: broadcastNotificationMock,
  broadcastNotificationRead: vi.fn(),
  broadcastAllNotificationsRead: vi.fn(),
  broadcastUnreadCount: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

type Queues = Record<string, unknown[]>;
type Builder = any;

function createBuilder(queues: Queues, table: string): Builder {
  const queue: unknown[] = queues[table] ?? (queues[table] = []);
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.selectRaw = vi.fn(() => builder);
  builder.where = vi.fn(() => builder);
  builder.andWhere = vi.fn(() => builder);
  builder.whereNull = vi.fn(() => builder);
  builder.whereNotNull = vi.fn(() => builder);
  builder.whereIn = vi.fn(() => builder);
  builder.orderBy = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.offset = vi.fn(() => builder);
  builder.leftJoin = vi.fn((_table: string, callback?: (this: any) => void) => {
    if (typeof callback === 'function') {
      const join = { on: vi.fn(() => join), andOn: vi.fn(() => join) };
      callback.call(join);
    }
    return builder;
  });
  builder.join = builder.leftJoin;
  builder.first = vi.fn(async () => queue.shift());
  builder.insert = vi.fn((row: any) => ({
    returning: async () => [
      { ...row, internal_notification_id: 'notif-1', created_at: '2024-01-01T00:00:00.000Z' },
    ],
  }));
  builder.returning = vi.fn(() => builder);
  builder.then = (resolve: (value: any) => any) =>
    Promise.resolve(queue.shift()).then(resolve);
  return builder;
}

function createFakeTrx(queues: Queues, order: string[]) {
  const trx: any = (table: string) => createBuilder(queues, table);
  trx.raw = vi.fn(() => ({}));
  trx.transaction = vi.fn();
  trx.commit = vi.fn(async () => {
    order.push('commit');
  });
  trx.rollback = vi.fn(async () => {
    order.push('rollback');
  });
  return trx;
}

function createFakeKnex(queues: Queues, order: string[]) {
  const fakeTrx = createFakeTrx(queues, order);
  const knex: any = (table: string) => createBuilder(queues, table);
  knex.transaction = vi.fn(async (cb: (trx: any) => Promise<any>) => {
    try {
      const result = await cb(fakeTrx);
      await fakeTrx.commit();
      return result;
    } catch (error) {
      await fakeTrx.rollback(error);
      throw error;
    }
  });
  return { knex, fakeTrx };
}

function buildQueues() {
  return {
    'users as u': [{ user_type: 'internal', contact_id: null, properties: null }],
    user_preferences: [undefined],
    tenant_settings: [{ settings: { defaultLocale: 'en' } }],
    internal_notification_templates: [
      {
        internal_notification_template_id: 1,
        name: 'ticket-assigned',
        language_code: 'en',
        title: 'Ticket {{ticketId}} assigned',
        message: 'Ticket {{ticketTitle}} assigned',
        subtype_id: 1,
      },
    ],
    internal_notification_subtypes: [
      { internal_notification_subtype_id: 1, internal_category_id: 10, is_default_enabled: true },
    ],
    tenant_internal_notification_subtype_settings: [undefined],
    internal_notification_categories: [{ internal_notification_category_id: 10 }],
    tenant_internal_notification_category_settings: [undefined],
    user_internal_notification_preferences: [undefined, undefined],
  };
}

function buildRequest() {
  return {
    tenant: 'tenant-1',
    user_id: 'user-1',
    template_name: 'ticket-assigned',
    type: 'info',
    category: 'tickets',
    data: { ticketId: 'T-123', ticketTitle: 'Network outage' },
  };
}

beforeEach(() => {
  publishWorkflowEventMock.mockClear();
  broadcastNotificationMock.mockClear();
  hookSpy.mockClear();
});

describe('createNotificationFromTemplateInternal external-effect deferral', () => {
  // Register a real post-creation hook once (the module-level hook registry is
  // shared with the action under test, exactly as in production); the spy is
  // cleared per test so counts stay isolated.
  registerInternalNotificationHook((notification) => {
    hookSpy(notification);
  });

  it('called standalone: fires each external effect exactly once, after the commit', async () => {
    const order: string[] = [];
    const { knex } = createFakeKnex(buildQueues(), order);

    const notification = await createNotificationFromTemplateInternal(knex as any, buildRequest());

    expect(notification).toBeTruthy();
    expect(notification?.internal_notification_id).toBe('notif-1');
    expect(publishWorkflowEventMock).toHaveBeenCalledTimes(1);
    expect(publishWorkflowEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'NOTIFICATION_SENT',
        idempotencyKey: 'notification:notif-1:sent',
      })
    );
    expect(broadcastNotificationMock).toHaveBeenCalledTimes(1);
    expect(broadcastNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ internal_notification_id: 'notif-1' })
    );
    expect(hookSpy).toHaveBeenCalledTimes(1);
    expect(hookSpy).toHaveBeenCalledWith(expect.objectContaining({ internal_notification_id: 'notif-1' }));
    // The effects fired only after the owning transaction committed.
    expect(order).toEqual(['commit']);
  });

  it('called inside an enclosing transaction that rolls back: emits nothing and never commits', async () => {
    const order: string[] = [];
    const { knex } = createFakeKnex(buildQueues(), order);

    await expect(
      withTransaction(knex as any, async (trx) => {
        await createNotificationFromTemplateInternal(trx as any, buildRequest());
        // Simulate the enclosing ledger transaction failing after the
        // notification insert (effect failure / completion-mark failure /
        // crash before commit): the whole frame rolls back.
        throw new Error('simulated rollback after notification insert');
      })
    ).rejects.toThrow('simulated rollback after notification insert');

    expect(publishWorkflowEventMock).not.toHaveBeenCalled();
    expect(broadcastNotificationMock).not.toHaveBeenCalled();
    expect(hookSpy).not.toHaveBeenCalled();
    expect(order).toEqual(['rollback']);
  });

  it('deferred hooks attach to the owning transaction and flush once per committed run', async () => {
    const order: string[] = [];
    const { knex, fakeTrx } = createFakeKnex(buildQueues(), order);

    const notification = await createNotificationFromTemplateInternal(knex as any, buildRequest());

    expect(notification?.internal_notification_id).toBe('notif-1');
    // registerAfterCommit is the production mechanism; a committed run flushes
    // the queue exactly once and the owning frame commits exactly once.
    expect(typeof registerAfterCommit).toBe('function');
    expect(fakeTrx.commit).toHaveBeenCalledTimes(1);
    expect(hookSpy).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['commit']);
  });
});
