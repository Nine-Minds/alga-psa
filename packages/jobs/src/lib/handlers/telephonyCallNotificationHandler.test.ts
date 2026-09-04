import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Webhook → job → CDR fetch → canonical → ingest, plus the per-tenant
 * auto-ticket policy. The policy is the dangerous half: a ticket minted for the
 * wrong client is a support incident, so only a freshly ingested, confidently
 * matched call may create one, and only when the tenant asked for it.
 */
const mocks = vi.hoisted(() => ({
  tenantScopes: [] as string[],
  fetchCallRecord: vi.fn(async () => ({ id: 'graph-call-1' })),
  mapToCanonical: vi.fn(() => ({ provider: 'teams-phone', providerCallId: 'graph-call-1', direction: 'inbound' })),
  providerState: vi.fn(async () => ({ autoCreateTickets: false })),
  ticketDefaults: vi.fn(async () => ({ boardId: 'board-1', statusId: 'status-open' })),
  priorityForBoard: vi.fn(async () => 'priority-normal'),
  ingest: vi.fn(async () => ({
    status: 'ingested',
    callRecordId: 'call-record-1',
    matchStatus: 'matched',
    interactionId: 'interaction-1',
    created: true,
  })),
  autoTicket: vi.fn(async () => ({ status: 'created', ticketId: 'ticket-1', ticketNumber: '2001' })),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/db', () => ({
  runWithTenant: async (tenantId: string, fn: () => Promise<unknown>) => {
    mocks.tenantScopes.push(tenantId);
    return fn();
  },
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib', () => ({
  renewTelephonyCallSubscriptions: vi.fn(async () => []),
  resolveCallRecordIdFromNotification: (notification: Record<string, unknown>) =>
    (notification?.resourceData as any)?.id ?? null,
  fetchTeamsCallRecord: mocks.fetchCallRecord,
  mapTeamsCallRecordToCanonical: mocks.mapToCanonical,
  getTeamsPhoneProviderState: mocks.providerState,
  getTeamsTicketCreationDefaults: mocks.ticketDefaults,
  resolveDefaultPriorityIdForBoard: mocks.priorityForBoard,
}));

vi.mock('@alga-psa/telephony', () => ({
  ingestCanonicalCall: mocks.ingest,
  autoCreateTicketForCall: mocks.autoTicket,
}));

const notification = { resourceData: { id: 'graph-call-1' } };

let processTelephonyCallNotification: (data: any) => Promise<void>;

beforeAll(async () => {
  // The module decides edition at import time.
  process.env.EDITION = 'ee';
  ({ processTelephonyCallNotification } = await import('./telephonyCallNotificationHandler'));
});

describe('processTelephonyCallNotification', () => {
  beforeEach(() => {
    mocks.tenantScopes.length = 0;
    vi.clearAllMocks();
    mocks.fetchCallRecord.mockResolvedValue({ id: 'graph-call-1' } as any);
    mocks.mapToCanonical.mockReturnValue({
      provider: 'teams-phone',
      providerCallId: 'graph-call-1',
      direction: 'inbound',
    } as any);
    mocks.ingest.mockResolvedValue({
      status: 'ingested',
      callRecordId: 'call-record-1',
      matchStatus: 'matched',
      interactionId: 'interaction-1',
      created: true,
    } as any);
    mocks.providerState.mockResolvedValue({ autoCreateTickets: false } as any);
  });

  it('T028: the whole notification runs inside the tenant scope', async () => {
    await processTelephonyCallNotification({ tenantId: 'tenant-1', notification });

    expect(mocks.tenantScopes).toEqual(['tenant-1']);
    expect(mocks.fetchCallRecord).toHaveBeenCalledWith({ tenantId: 'tenant-1', callRecordId: 'graph-call-1' });
    expect(mocks.ingest).toHaveBeenCalledTimes(1);
  });

  it('T028: a notification with no resolvable call id never touches Graph', async () => {
    await processTelephonyCallNotification({ tenantId: 'tenant-1', notification: {} });

    expect(mocks.fetchCallRecord).not.toHaveBeenCalled();
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it('T038: a CDR that cannot be mapped is dropped rather than ingested', async () => {
    mocks.mapToCanonical.mockReturnValue(null as any);

    await processTelephonyCallNotification({ tenantId: 'tenant-1', notification });

    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it('T043: with the auto-ticket policy off a matched call yields no ticket', async () => {
    await processTelephonyCallNotification({ tenantId: 'tenant-1', notification });

    expect(mocks.autoTicket).not.toHaveBeenCalled();
  });

  it('T043: with the policy on a matched call yields a ticket on the board defaults', async () => {
    mocks.providerState.mockResolvedValue({ autoCreateTickets: true } as any);

    await processTelephonyCallNotification({ tenantId: 'tenant-1', notification });

    expect(mocks.autoTicket).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      callRecordId: 'call-record-1',
      defaults: { boardId: 'board-1', statusId: 'status-open', priorityId: 'priority-normal' },
    });
  });

  it('T043: an unmatched call never auto-creates a ticket, policy or not', async () => {
    mocks.providerState.mockResolvedValue({ autoCreateTickets: true } as any);
    mocks.ingest.mockResolvedValue({
      status: 'ingested',
      callRecordId: 'call-record-1',
      matchStatus: 'unmatched',
      interactionId: null,
      created: true,
    } as any);

    await processTelephonyCallNotification({ tenantId: 'tenant-1', notification });

    expect(mocks.autoTicket).not.toHaveBeenCalled();
  });

  it('T023/T043: a re-delivered notification does not mint a second ticket', async () => {
    mocks.providerState.mockResolvedValue({ autoCreateTickets: true } as any);
    mocks.ingest.mockResolvedValue({
      status: 'ingested',
      callRecordId: 'call-record-1',
      matchStatus: 'matched',
      interactionId: 'interaction-1',
      created: false,
    } as any);

    await processTelephonyCallNotification({ tenantId: 'tenant-1', notification });

    expect(mocks.autoTicket).not.toHaveBeenCalled();
  });

  it('T027: an ingestion the release gate skipped stops before the ticket policy', async () => {
    mocks.providerState.mockResolvedValue({ autoCreateTickets: true } as any);
    mocks.ingest.mockResolvedValue({ status: 'skipped', reason: 'feature_disabled' } as any);

    await processTelephonyCallNotification({ tenantId: 'tenant-1', notification });

    expect(mocks.providerState).not.toHaveBeenCalled();
    expect(mocks.autoTicket).not.toHaveBeenCalled();
  });
});
