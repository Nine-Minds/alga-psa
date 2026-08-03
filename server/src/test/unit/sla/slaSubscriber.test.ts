import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

const withTenantTransactionRetryReadOnlyMock = vi.hoisted(() => vi.fn());
const withTransactionMock = vi.hoisted(() => vi.fn());
const createTenantKnexMock = vi.hoisted(() => vi.fn());
const recordResolutionMock = vi.hoisted(() => vi.fn());
const startSlaForTicketMock = vi.hoisted(() => vi.fn());
const syncPauseStateMock = vi.hoisted(() => vi.fn());
const dispatchSlaBackendActionsMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/core/logger', () => ({
  default: loggerMock,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: unknown[]) => createTenantKnexMock(...args),
  runWithTenant: vi.fn(async (_tenantId: string, fn: () => Promise<unknown>) => fn()),
  withTransaction: (knex: unknown, callback: (trx: unknown) => Promise<unknown>) =>
    withTransactionMock(knex, callback),
  withTenantTransactionRetryReadOnly: (
    tenantId: string,
    callback: (trx: unknown) => Promise<unknown>
  ) => withTenantTransactionRetryReadOnlyMock(tenantId, callback),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
  }),
}));

vi.mock('@alga-psa/sla', () => ({
  startSlaForTicket: (...args: unknown[]) => startSlaForTicketMock(...args),
  recordFirstResponse: vi.fn(),
  recordResolution: (...args: unknown[]) => recordResolutionMock(...args),
  handlePriorityChange: vi.fn(),
  handlePolicyChange: vi.fn(),
  handleStatusChange: vi.fn(),
  handleResponseStateChange: vi.fn(),
  syncPauseState: (...args: unknown[]) => syncPauseStateMock(...args),
  dispatchSlaBackendActions: (...args: unknown[]) => dispatchSlaBackendActionsMock(...args),
}));

import { __testHooks } from '../../../lib/eventBus/subscribers/slaSubscriber';

function createClosedTicketTrx(closedAt = '2026-04-28T22:24:44Z') {
  const chain = {
    where: vi.fn(),
    select: vi.fn(),
    first: vi.fn(async () => ({ closed_at: closedAt })),
  };
  chain.where.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);

  return vi.fn((table: string) => {
    if (table !== 'tickets') {
      throw new Error(`Unexpected table ${table}`);
    }
    return chain;
  });
}

const TENANT_ID = '00000000-0000-0000-0000-000000000002';
const TICKET_ID = '00000000-0000-0000-0000-000000000003';
const USER_ID = '00000000-0000-0000-0000-000000000004';

function createCreatedTicketKnex() {
  const chain = {
    where: vi.fn(),
    select: vi.fn(),
    first: vi.fn(async () => ({
      client_id: '00000000-0000-0000-0000-000000000010',
      board_id: '00000000-0000-0000-0000-000000000011',
      priority_id: '00000000-0000-0000-0000-000000000012',
      entered_at: '2026-04-28T22:00:00Z',
    })),
  };
  chain.where.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);

  return vi.fn((table: string) => {
    if (table !== 'tickets') {
      throw new Error(`Unexpected table ${table}`);
    }
    return chain;
  });
}

function createdEvent() {
  return {
    id: '00000000-0000-0000-0000-000000000006',
    eventType: 'TICKET_CREATED' as const,
    timestamp: '2026-04-28T22:00:01Z',
    payload: {
      tenantId: TENANT_ID,
      ticketId: TICKET_ID,
      userId: USER_ID,
    },
  };
}

const startAction = {
  kind: 'start',
  ticketId: TICKET_ID,
  policyId: '00000000-0000-0000-0000-000000000020',
  targets: [],
  schedule: {},
};

describe('slaSubscriber TICKET_CREATED handling', () => {
  beforeEach(() => {
    loggerMock.info.mockReset();
    loggerMock.error.mockReset();
    startSlaForTicketMock.mockReset();
    syncPauseStateMock.mockReset();
    dispatchSlaBackendActionsMock.mockReset();
    createTenantKnexMock.mockResolvedValue({ knex: createCreatedTicketKnex() });
    withTransactionMock.mockImplementation(async (_knex, callback) => callback('trx'));
  });

  it('applies the creation status pause configuration', async () => {
    startSlaForTicketMock.mockResolvedValue({
      success: true,
      sla_policy_id: startAction.policyId,
      sla_started_at: new Date('2026-04-28T22:00:00Z'),
      sla_response_due_at: null,
      sla_resolution_due_at: null,
      created_in_closed_status: false,
      backendActions: [startAction],
    });
    const pauseAction = { kind: 'pause', ticketId: TICKET_ID, reason: 'status_pause' };
    syncPauseStateMock.mockResolvedValue({
      success: true,
      was_paused: false,
      is_now_paused: true,
      backendActions: [pauseAction],
    });

    await __testHooks.handleTicketCreatedEvent(createdEvent());

    expect(syncPauseStateMock).toHaveBeenCalledWith('trx', TENANT_ID, TICKET_ID, USER_ID);
    expect(dispatchSlaBackendActionsMock).toHaveBeenCalledWith([startAction, pauseAction]);
  });

  it('does not start or pause a timer for a ticket created closed', async () => {
    startSlaForTicketMock.mockResolvedValue({
      success: true,
      sla_policy_id: startAction.policyId,
      sla_started_at: new Date('2026-04-28T22:00:00Z'),
      sla_response_due_at: null,
      sla_resolution_due_at: null,
      created_in_closed_status: true,
    });

    await __testHooks.handleTicketCreatedEvent(createdEvent());

    expect(syncPauseStateMock).not.toHaveBeenCalled();
    expect(dispatchSlaBackendActionsMock).toHaveBeenCalledWith([]);
  });

  it('dispatches only the start action for a normal status', async () => {
    startSlaForTicketMock.mockResolvedValue({
      success: true,
      sla_policy_id: startAction.policyId,
      sla_started_at: new Date('2026-04-28T22:00:00Z'),
      sla_response_due_at: null,
      sla_resolution_due_at: null,
      created_in_closed_status: false,
      backendActions: [startAction],
    });
    syncPauseStateMock.mockResolvedValue({
      success: true,
      was_paused: false,
      is_now_paused: false,
    });

    await __testHooks.handleTicketCreatedEvent(createdEvent());

    expect(syncPauseStateMock).toHaveBeenCalledTimes(1);
    expect(dispatchSlaBackendActionsMock).toHaveBeenCalledWith([startAction]);
  });
});

describe('slaSubscriber TICKET_CLOSED handling', () => {
  beforeEach(() => {
    loggerMock.info.mockReset();
    loggerMock.error.mockReset();
    loggerMock.warn.mockReset();
    loggerMock.debug.mockReset();
    recordResolutionMock.mockReset();
    withTenantTransactionRetryReadOnlyMock.mockReset();
    dispatchSlaBackendActionsMock.mockReset();
  });

  it('rethrows recordResolution failures so the event bus can retry', async () => {
    const trx = createClosedTicketTrx();
    withTenantTransactionRetryReadOnlyMock.mockImplementation(async (_tenantId, callback) => callback(trx));
    recordResolutionMock.mockResolvedValue({
      success: false,
      met: null,
      recorded_at: new Date('2026-04-28T22:24:44Z'),
      error: 'transient failure',
    });

    const event = {
      id: '00000000-0000-0000-0000-000000000001',
      eventType: 'TICKET_CLOSED' as const,
      timestamp: '2026-04-28T22:24:45Z',
      payload: {
        tenantId: '00000000-0000-0000-0000-000000000002',
        ticketId: '00000000-0000-0000-0000-000000000003',
        userId: '00000000-0000-0000-0000-000000000004',
      },
    };

    await expect(__testHooks.handleTicketClosedEvent(event)).rejects.toThrow('transient failure');
    expect(loggerMock.error).toHaveBeenCalledWith(
      '[SlaSubscriber] recordResolution returned failure',
      expect.objectContaining({
        tenantId: '00000000-0000-0000-0000-000000000002',
        ticketId: '00000000-0000-0000-0000-000000000003',
        error: 'transient failure',
      })
    );
    // Nothing committed, so no backend action may be dispatched.
    expect(dispatchSlaBackendActionsMock).not.toHaveBeenCalled();
  });

  it('dispatches backend actions only after the transaction resolves', async () => {
    const trx = createClosedTicketTrx();
    const callOrder: string[] = [];
    withTenantTransactionRetryReadOnlyMock.mockImplementation(async (_tenantId, callback) => {
      const result = await callback(trx);
      callOrder.push('transaction-resolved');
      return result;
    });
    dispatchSlaBackendActionsMock.mockImplementation(async () => {
      callOrder.push('dispatch');
    });

    const backendActions = [
      { kind: 'complete', ticketId: '00000000-0000-0000-0000-000000000003', type: 'resolution', met: true },
    ];
    recordResolutionMock.mockResolvedValue({
      success: true,
      met: true,
      recorded_at: new Date('2026-04-28T22:24:44Z'),
      backendActions,
    });

    const event = {
      id: '00000000-0000-0000-0000-000000000005',
      eventType: 'TICKET_CLOSED' as const,
      timestamp: '2026-04-28T22:24:45Z',
      payload: {
        tenantId: '00000000-0000-0000-0000-000000000002',
        ticketId: '00000000-0000-0000-0000-000000000003',
        userId: '00000000-0000-0000-0000-000000000004',
      },
    };

    await __testHooks.handleTicketClosedEvent(event);

    expect(dispatchSlaBackendActionsMock).toHaveBeenCalledWith(backendActions);
    expect(callOrder).toEqual(['transaction-resolved', 'dispatch']);
  });
});
