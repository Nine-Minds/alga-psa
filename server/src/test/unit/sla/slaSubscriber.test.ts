import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

const withTenantTransactionRetryReadOnlyMock = vi.hoisted(() => vi.fn());
const recordResolutionMock = vi.hoisted(() => vi.fn());
const dispatchSlaBackendActionsMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/core/logger', () => ({
  default: loggerMock,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
  runWithTenant: vi.fn(async (_tenantId: string, fn: () => Promise<unknown>) => fn()),
  withTransaction: vi.fn(),
  withTenantTransactionRetryReadOnly: (
    tenantId: string,
    callback: (trx: unknown) => Promise<unknown>
  ) => withTenantTransactionRetryReadOnlyMock(tenantId, callback),
}));

vi.mock('@alga-psa/sla', () => ({
  startSlaForTicket: vi.fn(),
  recordFirstResponse: vi.fn(),
  recordResolution: (...args: unknown[]) => recordResolutionMock(...args),
  handlePriorityChange: vi.fn(),
  handlePolicyChange: vi.fn(),
  handleStatusChange: vi.fn(),
  handleResponseStateChange: vi.fn(),
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
