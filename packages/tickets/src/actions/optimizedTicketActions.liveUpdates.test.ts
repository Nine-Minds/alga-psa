import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;

const hasPermissionMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const publishWorkflowEventMock = vi.fn();
const publishEventMock = vi.fn();
const publishRedisMock = vi.fn();
const disconnectRedisMock = vi.fn();
const validateStatusBelongsToBoardMock = vi.fn(
  async (_statusId: string, _boardId: string, _tenant: string, _trx: unknown) => ({ valid: true })
);
const auditLogInserts: Record<string, unknown>[] = [];
const ticketUpdates: Record<string, unknown>[] = [];
// Queue mirroring @alga-psa/db's after-commit hook registry: hooks registered
// via registerAfterCommit during a transaction run after the (mocked)
// transaction resolves, matching production's flush-after-commit semantics.
const afterCommitHooksQueue: Array<() => unknown | Promise<unknown>> = [];

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (table: string) => conn(table),
    unscoped: (table: string) => conn(table),
  }),
  withTransaction: async (...args: any[]) => {
    try {
      const result = await withTransactionMock(...args);
      const hooks = afterCommitHooksQueue.splice(0);
      for (const hook of hooks) {
        try {
          await hook();
        } catch {
          // Production swallows after-commit hook failures.
        }
      }
      return result;
    } catch (error) {
      afterCommitHooksQueue.length = 0;
      throw error;
    }
  },
  registerAfterCommit: (_trx: unknown, hook: () => unknown | Promise<unknown>, _label?: string) => {
    afterCommitHooksQueue.push(hook);
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@alga-psa/validation', () => ({
  validateData: (_schema: unknown, value: unknown) => value,
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: (...args: any[]) => publishEventMock(...args),
  publishWorkflowEvent: (...args: any[]) => publishWorkflowEventMock(...args),
}));

vi.mock('@alga-psa/event-bus', () => ({
  getEventBus: () => ({
    publish: vi.fn(),
  }),
  getRedisClient: vi.fn(async () => ({
    publish: publishRedisMock,
    disconnect: disconnectRedisMock,
  })),
  getRedisConfig: vi.fn(() => ({ prefix: 'alga-psa:' })),
}));

vi.mock('../models/ticket', () => ({
  default: class Ticket {},
}));

vi.mock('@alga-psa/auth/actions', () => ({
  getTicketAttributes: vi.fn(),
}));

vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({
  deleteEntityTags: vi.fn(),
}));

vi.mock('@alga-psa/shared/models/ticketModel', () => ({
  TicketModel: {
    validateStatusBelongsToBoard: (
      statusId: string,
      boardId: string,
      tenant: string,
      trx: unknown
    ) => validateStatusBelongsToBoardMock(statusId, boardId, tenant, trx),
  },
}));

vi.mock('../lib/workflowTicketTransitionEvents', () => ({
  buildTicketTransitionWorkflowEvents: vi.fn(() => []),
}));

vi.mock('../lib/workflowTicketCommunicationEvents', () => ({
  buildTicketCommunicationWorkflowEvents: vi.fn(() => []),
}));

vi.mock('../lib/workflowTicketSlaStageEvents', () => ({
  buildTicketResolutionSlaStageCompletionEvent: vi.fn(() => null),
}));

vi.mock('../lib/validateTicketClosure', () => ({
  enforceTicketCloseRules: vi.fn(async () => undefined),
}));

import {
  resetTicketUpdatePublisherClientForTests,
  setTicketUpdateEventBusLoaderForTests,
} from '../lib/liveUpdates';

function makeTicket(overrides: Record<string, unknown> = {}) {
  return {
    ticket_id: 'ticket-1',
    tenant: 'tenant-1',
    title: 'Original title',
    status_id: 'status-1',
    priority_id: 1,
    assigned_to: null,
    board_id: 'board-1',
    category_id: null,
    subcategory_id: null,
    itil_impact: null,
    itil_urgency: null,
    itil_priority_level: null,
    response_state: null,
    escalated: false,
    entered_at: '2026-05-07T11:55:00.000Z',
    updated_at: '2026-05-07T11:55:00.000Z',
    closed_at: null,
    closed_by: null,
    is_closed: false,
    master_ticket_id: null,
    ...overrides,
  };
}

function makeStatus(status_id: string, is_closed = false) {
  return {
    status_id,
    tenant: 'tenant-1',
    is_closed: is_closed || status_id.startsWith('closed-'),
  };
}

function makeUpdateResult(awaitValue: unknown, returningValue: unknown) {
  return {
    returning: vi.fn(async () => returningValue),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(awaitValue).then(resolve, reject),
    catch: (reject: (reason: unknown) => unknown) =>
      Promise.resolve(awaitValue).catch(reject),
    finally: (handler: () => void) =>
      Promise.resolve(awaitValue).finally(handler),
  };
}

function buildTrx(params: {
  currentTicket?: Record<string, unknown>;
  bundleSettings?: Record<string, unknown> | undefined;
  childTickets?: Array<Record<string, unknown>>;
}) {
  const currentTicket = { ...makeTicket(), ...(params.currentTicket ?? {}) };
  let childTickets = (params.childTickets ?? []).map((child) => ({ ...child }));
  const bundleSettings = params.bundleSettings;

  const ticketsTable = {
    where(whereArgs: Record<string, unknown>) {
      if ('ticket_id' in whereArgs) {
        return {
          first: vi.fn(async () => currentTicket),
          update: vi.fn((data: Record<string, unknown>) => {
            ticketUpdates.push(data);
            return makeUpdateResult(1, [{ ...currentTicket, ...data, updated_at: '2026-05-07T12:00:00.000Z' }]);
          }),
        };
      }

      if ('master_ticket_id' in whereArgs) {
        return {
          select: vi.fn(async (columns: string[]) =>
            childTickets.map((child) =>
              columns.reduce<Record<string, unknown>>((acc, column) => {
                acc[column] = child[column];
                return acc;
              }, {})
            )
          ),
          update: vi.fn((data: Record<string, unknown>) => {
            childTickets = childTickets.map((child) => ({ ...child, ...data }));
            return makeUpdateResult(childTickets.length, childTickets.length);
          }),
        };
      }

      throw new Error(`Unexpected tickets.where args: ${JSON.stringify(whereArgs)}`);
    },
  };

  const statusesTable = {
    where(whereArgs: Record<string, unknown>) {
      return {
        first: vi.fn(async () => {
          if (whereArgs.status_id === currentTicket.status_id) {
            return makeStatus(String(currentTicket.status_id), false);
          }

          return makeStatus(String(whereArgs.status_id), false);
        }),
      };
    },
  };

  const bundleSettingsTable = {
    where: vi.fn(() => ({
      first: vi.fn(async () => bundleSettings),
    })),
  };

  return ((table: string) => {
    if (table === 'tickets') {
      return ticketsTable;
    }

    if (table === 'statuses') {
      return statusesTable;
    }

    if (table === 'ticket_bundle_settings') {
      return bundleSettingsTable;
    }

    if (table === 'ticket_resources') {
      return {
        where: vi.fn(() => ({
          delete: vi.fn(async () => 0),
          select: vi.fn(async () => []),
        })),
      };
    }

    if (table === 'ticket_audit_logs') {
      return {
        insert: vi.fn(async (row: Record<string, unknown>) => {
          auditLogInserts.push(row);
          return undefined;
        }),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  }) as any;
}

describe('updateTicketWithCache live updates', () => {
  beforeEach(async () => {
    await resetTicketUpdatePublisherClientForTests();
    vi.clearAllMocks();
    auditLogInserts.length = 0;
    ticketUpdates.length = 0;
    afterCommitHooksQueue.length = 0;
    setTicketUpdateEventBusLoaderForTests(async () => ({
      getRedisClient: vi.fn(async () => ({
        publish: publishRedisMock,
        disconnect: disconnectRedisMock,
      })),
    }));
    delete process.env.LIVE_TICKET_UPDATES_DISABLED;
    currentUser = {
      user_id: 'user-1',
      username: 'pat.agent',
      first_name: 'Pat',
      last_name: 'Agent',
      tenant: 'tenant-1',
      user_type: 'internal',
    };
    hasPermissionMock.mockResolvedValue(true);
    createTenantKnexMock.mockResolvedValue({ knex: { any: true } });
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(buildTrx({})));
  });

  it('T004: successful update publishes exactly one live update with only changed fields', async () => {
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) =>
      callback(
        buildTrx({
          currentTicket: makeTicket({
            title: 'Original title',
            status_id: 'status-1',
          }),
        })
      )
    );

    const { updateTicketWithCache } = await import('./optimizedTicketActions');
    await expect(
      updateTicketWithCache('ticket-1', {
        title: 'Original title',
        status_id: 'status-2',
      })
    ).resolves.toBe('success');

    expect(publishRedisMock).toHaveBeenCalledTimes(1);
    expect(publishRedisMock).toHaveBeenCalledWith(
      'alga-psa:ticket-updates:tenant-1:ticket-1',
      expect.stringContaining('"updatedFields":["status_id"]')
    );
  });

  it('T005: permission failure results in zero live-update publishes', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const { updateTicketWithCache } = await import('./optimizedTicketActions');
    // Expected failures return a typed action error instead of throwing.
    const result = await updateTicketWithCache('ticket-1', { status_id: 'status-2' });
    expect(result).toEqual(
      expect.objectContaining({ permissionError: 'Permission denied: Cannot update ticket' })
    );

    expect(publishRedisMock).not.toHaveBeenCalled();
  });

  it('T006: bundled child sync publishes one live update per affected child', async () => {
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) =>
      callback(
        buildTrx({
          currentTicket: makeTicket({
            ticket_id: 'parent-1',
            status_id: 'status-1',
          }),
          bundleSettings: {
            tenant: 'tenant-1',
            master_ticket_id: 'parent-1',
            mode: 'sync_updates',
          },
          childTickets: [
            makeTicket({ ticket_id: 'child-1', master_ticket_id: 'parent-1', status_id: 'status-1' }),
            makeTicket({ ticket_id: 'child-2', master_ticket_id: 'parent-1', status_id: 'status-2' }),
          ],
        })
      )
    );

    const { updateTicketWithCache } = await import('./optimizedTicketActions');
    await expect(updateTicketWithCache('parent-1', { status_id: 'status-2' })).resolves.toBe('success');

    const channels = publishRedisMock.mock.calls.map((call) => call[0]);
    expect(channels).toContain('alga-psa:ticket-updates:tenant-1:parent-1');
    expect(channels.filter((channel) => channel === 'alga-psa:ticket-updates:tenant-1:child-1')).toHaveLength(1);
    expect(channels).not.toContain('alga-psa:ticket-updates:tenant-1:child-2');
  });

  it('T024: suppressed bundled master close publishes no per-child close events (master event carries the flags)', async () => {
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) =>
      callback(
        buildTrx({
          currentTicket: makeTicket({
            ticket_id: 'parent-1',
            status_id: 'status-1',
          }),
          bundleSettings: {
            tenant: 'tenant-1',
            master_ticket_id: 'parent-1',
            mode: 'sync_updates',
          },
          childTickets: [
            makeTicket({ ticket_id: 'child-1', master_ticket_id: 'parent-1', status_id: 'status-1' }),
            makeTicket({ ticket_id: 'child-2', master_ticket_id: 'parent-1', status_id: 'closed-status-1' }),
          ],
        })
      )
    );

    const { updateTicketWithCache } = await import('./optimizedTicketActions');
    await expect(
      updateTicketWithCache(
        'parent-1',
        { status_id: 'closed-status-1' },
        {
          suppressContactNotifications: true,
          suppressInternalNotifications: true,
        }
      )
    ).resolves.toBe('success');

    expect(publishWorkflowEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'TICKET_CLOSED',
        payload: expect.objectContaining({
          ticketId: 'parent-1',
          suppressContactNotifications: true,
          suppressInternalNotifications: true,
        }),
      })
    );
    // Children never publish TICKET_CLOSED of their own — the master's event
    // (with flags) drives child requester handling in the close subscriber.
    // A silent close must not fan out events a normal close doesn't.
    expect(
      publishWorkflowEventMock.mock.calls.some(
        ([event]) =>
          event.eventType === 'TICKET_CLOSED' &&
          (event.payload?.ticketId === 'child-1' || event.payload?.ticketId === 'child-2')
      )
    ).toBe(false);

    // Child live UI updates still fire for the changed child only.
    const channels = publishRedisMock.mock.calls.map((call) => call[0]);
    expect(channels.filter((channel) => channel === 'alga-psa:ticket-updates:tenant-1:child-1')).toHaveLength(1);
    expect(channels).not.toContain('alga-psa:ticket-updates:tenant-1:child-2');
  });

  it('T007: live-update kill switch skips Redis publish without blocking the ticket update', async () => {
    process.env.LIVE_TICKET_UPDATES_DISABLED = '1';

    const { updateTicketWithCache } = await import('./optimizedTicketActions');
    await expect(updateTicketWithCache('ticket-1', { status_id: 'status-2' })).resolves.toBe('success');

    expect(publishRedisMock).not.toHaveBeenCalled();
  });

  it('accepts contact-only suppression and publishes it on TICKET_UPDATED without changing dedupe behavior', async () => {
    const { updateTicketWithCache } = await import('./optimizedTicketActions');

    await expect(
      updateTicketWithCache(
        'ticket-1',
        { title: 'Silently changed title' },
        { suppressContactNotifications: true }
      )
    ).resolves.toBe('success');

    expect(publishWorkflowEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'TICKET_UPDATED',
        payload: expect.objectContaining({
          ticketId: 'ticket-1',
          suppressContactNotifications: true,
          suppressInternalNotifications: false,
        }),
      })
    );
    const activityDetails = JSON.parse(String(auditLogInserts.at(-1)?.details ?? '{}'));
    expect(activityDetails.notification_suppression).toEqual({
      suppress_contact_notifications: true,
      suppress_internal_notifications: false,
    });
  });

  it('accepts full suppression and publishes it on TICKET_UPDATED', async () => {
    const { updateTicketWithCache } = await import('./optimizedTicketActions');

    await expect(
      updateTicketWithCache(
        'ticket-1',
        { title: 'Fully silent title' },
        {
          suppressContactNotifications: true,
          suppressInternalNotifications: true,
        }
      )
    ).resolves.toBe('success');

    expect(publishWorkflowEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'TICKET_UPDATED',
        payload: expect.objectContaining({
          suppressContactNotifications: true,
          suppressInternalNotifications: true,
        }),
      })
    );
  });

  it('rejects internal suppression unless contact suppression is also set', async () => {
    const { updateTicketWithCache } = await import('./optimizedTicketActions');

    await expect(
      updateTicketWithCache(
        'ticket-1',
        { title: 'Invalid suppression request' },
        { suppressInternalNotifications: true }
      )
    ).rejects.toThrow('suppressInternalNotifications requires suppressContactNotifications');

    expect(publishWorkflowEventMock).not.toHaveBeenCalled();
  });

  it('publishes default-false suppression flags when no suppression options are supplied', async () => {
    const { updateTicketWithCache } = await import('./optimizedTicketActions');

    await expect(updateTicketWithCache('ticket-1', { title: 'Normal title' })).resolves.toBe('success');

    expect(publishWorkflowEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'TICKET_UPDATED',
        payload: expect.objectContaining({
          suppressContactNotifications: false,
          suppressInternalNotifications: false,
        }),
      })
    );
    const activityDetails = JSON.parse(String(auditLogInserts.at(-1)?.details ?? '{}'));
    expect(activityDetails.notification_suppression).toBeUndefined();
  });

  it('propagates suppression flags on a non-closing status update without error', async () => {
    const { updateTicketWithCache } = await import('./optimizedTicketActions');

    await expect(
      updateTicketWithCache(
        'ticket-1',
        { status_id: 'status-2' },
        { suppressContactNotifications: true }
      )
    ).resolves.toBe('success');

    expect(publishWorkflowEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'TICKET_UPDATED',
        payload: expect.objectContaining({
          changes: expect.objectContaining({
            status_id: { old: 'status-1', new: 'status-2' },
          }),
          suppressContactNotifications: true,
          suppressInternalNotifications: false,
        }),
      })
    );
  });

  it('publishes suppression flags on TICKET_ASSIGNED', async () => {
    const { updateTicketWithCache } = await import('./optimizedTicketActions');

    await expect(
      updateTicketWithCache(
        'ticket-1',
        { assigned_to: 'user-2' },
        {
          suppressContactNotifications: true,
          suppressInternalNotifications: true,
        }
      )
    ).resolves.toBe('success');

    expect(publishWorkflowEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'TICKET_ASSIGNED',
        payload: expect.objectContaining({
          newAssigneeId: 'user-2',
          suppressContactNotifications: true,
          suppressInternalNotifications: true,
        }),
      })
    );
  });

  it('publishes suppression flags on TICKET_CLOSED', async () => {
    const { updateTicketWithCache } = await import('./optimizedTicketActions');
    const slaEvents = await import('../lib/workflowTicketSlaStageEvents');
    (slaEvents.buildTicketResolutionSlaStageCompletionEvent as any).mockReturnValueOnce({
      eventType: 'TICKET_SLA_STAGE_MET',
      payload: {
        tenantId: 'tenant-1',
        ticketId: 'ticket-1',
        stage: 'resolution',
        occurredAt: '2026-05-07T12:00:00.000Z',
        targetAt: '2026-05-08T12:00:00.000Z',
        completedAt: '2026-05-07T12:00:00.000Z',
      },
      idempotencyKey: 'sla:ticket-1:resolution:met',
    });

    await expect(
      updateTicketWithCache(
        'ticket-1',
        { status_id: 'closed-status-1' },
        { suppressContactNotifications: true }
      )
    ).resolves.toBe('success');

    expect(publishWorkflowEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'TICKET_CLOSED',
        payload: expect.objectContaining({
          ticketId: 'ticket-1',
          suppressContactNotifications: true,
          suppressInternalNotifications: false,
        }),
      })
    );
    expect(publishWorkflowEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'TICKET_SLA_STAGE_MET',
        payload: expect.objectContaining({
          ticketId: 'ticket-1',
          stage: 'resolution',
        }),
        idempotencyKey: 'sla:ticket-1:resolution:met',
      })
    );
  });

  it('clears a pending response state when closing the ticket', async () => {
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) =>
      callback(
        buildTrx({
          currentTicket: makeTicket({
            status_id: 'status-1',
            response_state: 'awaiting_client',
          }),
        })
      )
    );

    const { updateTicketWithCache } = await import('./optimizedTicketActions');
    await expect(
      updateTicketWithCache('ticket-1', { status_id: 'closed-status-1' })
    ).resolves.toBe('success');

    expect(ticketUpdates[0]).toEqual({
      status_id: 'closed-status-1',
      response_state: null,
    });
    expect(publishRedisMock).toHaveBeenCalledWith(
      'alga-psa:ticket-updates:tenant-1:ticket-1',
      expect.stringContaining('"updatedFields":["status_id","response_state"]')
    );
    expect(publishEventMock).toHaveBeenCalledWith({
      eventType: 'TICKET_RESPONSE_STATE_CHANGED',
      payload: {
        tenantId: 'tenant-1',
        occurredAt: expect.any(String),
        ticketId: 'ticket-1',
        userId: 'user-1',
        previousResponseState: 'awaiting_client',
        newResponseState: null,
        previousState: 'awaiting_client',
        newState: null,
        trigger: 'close',
      },
    });
  });
});
