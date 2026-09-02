import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The 3CX report-call path: the route enqueues a canonical record, and this
 * handler ingests it under tenant scope, then runs the shared auto-ticket tail.
 * The dangerous half is the tail — a ticket for the wrong client is an incident
 * — so only a freshly ingested, confidently matched call may mint one.
 */
const mocks = vi.hoisted(() => ({
  tenantScopes: [] as string[],
  ingest: vi.fn(),
  autoTicket: vi.fn(async () => ({ status: 'created', ticketId: 'ticket-1' })),
  threecxState: vi.fn(async () => ({ autoCreateTickets: false })),
  ticketDefaults: vi.fn(async () => ({ boardId: 'board-1', statusId: 'status-open' })),
  priorityForBoard: vi.fn(async () => 'priority-normal'),
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

vi.mock('@alga-psa/telephony', () => ({
  ingestCanonicalCall: mocks.ingest,
  autoCreateTicketForCall: mocks.autoTicket,
}));

vi.mock('@alga-psa/ee-threecx/lib', () => ({
  getThreecxProviderState: mocks.threecxState,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib', () => ({
  getTeamsTicketCreationDefaults: mocks.ticketDefaults,
  resolveDefaultPriorityIdForBoard: mocks.priorityForBoard,
}));

const inboundRecord = {
  provider: '3cx',
  providerCallId: 'hash-1',
  direction: 'inbound',
  callerNumber: { raw: '+15551234567', e164: '+15551234567' },
  startedAt: '2026-09-02T10:00:00Z',
  endedAt: '2026-09-02T10:00:42Z',
  durationSeconds: 42,
  modality: 'audio',
  raw: {},
};

let processTelephonyCanonicalCall: (data: any) => Promise<void>;

beforeAll(async () => {
  process.env.EDITION = 'ee';
  ({ processTelephonyCanonicalCall } = await import('./telephonyCanonicalCallHandler'));
});

describe('processTelephonyCanonicalCall', () => {
  beforeEach(() => {
    mocks.tenantScopes.length = 0;
    vi.clearAllMocks();
    mocks.ingest.mockResolvedValue({
      status: 'ingested',
      callRecordId: 'call-record-1',
      matchStatus: 'matched',
      interactionId: 'interaction-1',
      created: true,
    });
    mocks.threecxState.mockResolvedValue({ autoCreateTickets: false });
    mocks.ticketDefaults.mockResolvedValue({ boardId: 'board-1', statusId: 'status-open' });
    mocks.priorityForBoard.mockResolvedValue('priority-normal');
  });

  it('T085: ingests the record inside the tenant scope', async () => {
    await processTelephonyCanonicalCall({ tenantId: 'tenant-1', record: inboundRecord });

    expect(mocks.tenantScopes).toEqual(['tenant-1']);
    expect(mocks.ingest).toHaveBeenCalledWith({ tenantId: 'tenant-1', call: inboundRecord });
  });

  it('T086: an unmatched ingestion creates no ticket', async () => {
    mocks.threecxState.mockResolvedValue({ autoCreateTickets: true });
    mocks.ingest.mockResolvedValue({
      status: 'ingested',
      callRecordId: 'call-record-1',
      matchStatus: 'unmatched',
      interactionId: null,
      created: true,
    });

    await processTelephonyCanonicalCall({ tenantId: 'tenant-1', record: inboundRecord });

    expect(mocks.autoTicket).not.toHaveBeenCalled();
  });

  it('T087: an outbound record is ingested with direction outbound', async () => {
    const outboundRecord = { ...inboundRecord, direction: 'outbound', calleeNumber: inboundRecord.callerNumber, callerNumber: undefined };
    await processTelephonyCanonicalCall({ tenantId: 'tenant-1', record: outboundRecord });

    expect(mocks.ingest).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      call: expect.objectContaining({ direction: 'outbound' }),
    });
  });

  it('T088: with the auto-ticket policy on, a matched call mints a ticket on the board defaults', async () => {
    mocks.threecxState.mockResolvedValue({ autoCreateTickets: true });

    await processTelephonyCanonicalCall({ tenantId: 'tenant-1', record: inboundRecord });

    expect(mocks.autoTicket).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      callRecordId: 'call-record-1',
      defaults: { boardId: 'board-1', statusId: 'status-open', priorityId: 'priority-normal' },
    });
  });

  it('T090: a re-delivered record (created false) mints nothing new', async () => {
    mocks.threecxState.mockResolvedValue({ autoCreateTickets: true });
    mocks.ingest.mockResolvedValue({
      status: 'ingested',
      callRecordId: 'call-record-1',
      matchStatus: 'matched',
      interactionId: 'interaction-1',
      created: false,
    });

    await processTelephonyCanonicalCall({ tenantId: 'tenant-1', record: inboundRecord });

    expect(mocks.autoTicket).not.toHaveBeenCalled();
  });

  it('a skipped ingestion never consults the auto-ticket policy', async () => {
    mocks.threecxState.mockResolvedValue({ autoCreateTickets: true });
    mocks.ingest.mockResolvedValue({ status: 'skipped', reason: 'invalid_payload' });

    await processTelephonyCanonicalCall({ tenantId: 'tenant-1', record: inboundRecord });

    expect(mocks.threecxState).not.toHaveBeenCalled();
    expect(mocks.autoTicket).not.toHaveBeenCalled();
  });
});
