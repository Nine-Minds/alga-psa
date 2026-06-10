import { describe, it, expect, vi } from 'vitest';
import type { Knex } from 'knex';
import {
  startSlaForTicket,
  recordFirstResponse,
  recordResolution,
  handlePriorityChange,
  handlePolicyChange,
} from '../slaService';
import {
  pauseSla,
  resumeSla,
  handleStatusChange,
  handleResponseStateChange,
} from '../slaPauseService';
import { acquireTicketSlaLock } from '../slaLock';

const TENANT_ID = 'tenant-1';
const TICKET_ID = 'ticket-1';
const LOCK_SQL = 'select pg_advisory_xact_lock(hashtext(?))';
const LOCK_KEY = `sla:${TENANT_ID}:${TICKET_ID}`;

function createTrackingTrx() {
  const mockData: Record<string, any> = {};
  const sequence: string[] = [];

  const createChain = (table: string) => {
    const rows = () => {
      const value = mockData[table];
      if (value === undefined || value === null) return [];
      return Array.isArray(value) ? value : [value];
    };
    const chain: any = {
      where: vi.fn().mockImplementation(() => chain),
      select: vi.fn().mockImplementation(() => chain),
      orderBy: vi.fn().mockImplementation(() => chain),
      first: vi.fn().mockImplementation(() => {
        sequence.push(`read:${table}`);
        return Promise.resolve(rows()[0] ?? null);
      }),
      update: vi.fn().mockImplementation(() => {
        sequence.push(`write:${table}`);
        return Promise.resolve(1);
      }),
      insert: vi.fn().mockImplementation(() => {
        sequence.push(`write:${table}`);
        return Promise.resolve([1]);
      }),
      then: (resolve: any, reject: any) => {
        sequence.push(`read:${table}`);
        return Promise.resolve(rows()).then(resolve, reject);
      },
    };
    return chain;
  };

  const trx = ((table: string) => createChain(table)) as any;
  trx.raw = vi.fn().mockImplementation((sql: string, bindings?: any[]) => {
    sequence.push(`raw:${sql}:${(bindings ?? []).join(',')}`);
    return Promise.resolve({ rows: [] });
  });
  trx.setData = (table: string, data: any) => {
    mockData[table] = data;
  };
  trx.getSequence = () => sequence;

  return trx as Knex.Transaction & {
    setData: (table: string, data: any) => void;
    getSequence: () => string[];
  };
}

function expectLockTakenFirst(trx: ReturnType<typeof createTrackingTrx>) {
  expect(trx.raw).toHaveBeenCalledWith(LOCK_SQL, [LOCK_KEY]);
  const sequence = trx.getSequence();
  expect(sequence[0]).toBe(`raw:${LOCK_SQL}:${LOCK_KEY}`);
}

describe('acquireTicketSlaLock', () => {
  it('takes a transaction-scoped advisory lock keyed on tenant and ticket', async () => {
    const trx = createTrackingTrx();
    await acquireTicketSlaLock(trx, TENANT_ID, TICKET_ID);
    expectLockTakenFirst(trx);
  });
});

describe('per-ticket serialization of SLA writes', () => {
  const seedTicket = (trx: ReturnType<typeof createTrackingTrx>, extra: Record<string, any> = {}) => {
    trx.setData('tickets', {
      sla_policy_id: 'policy-1',
      sla_started_at: new Date('2024-01-01T00:00:00Z').toISOString(),
      sla_response_at: null,
      sla_response_due_at: new Date('2024-01-01T01:00:00Z').toISOString(),
      sla_resolution_at: null,
      sla_resolution_due_at: new Date('2024-01-01T04:00:00Z').toISOString(),
      sla_paused_at: null,
      sla_total_pause_minutes: 0,
      status_id: 'status-1',
      priority_id: 'priority-1',
      client_id: 'client-1',
      board_id: 'board-1',
      response_state: null,
      due_date: null,
      ...extra,
    });
  };

  it('startSlaForTicket locks before any read or write', async () => {
    const trx = createTrackingTrx();
    seedTicket(trx);
    await startSlaForTicket(trx, TENANT_ID, TICKET_ID, 'client-1', 'board-1', 'priority-1');
    expectLockTakenFirst(trx);
  });

  it('recordFirstResponse locks before any read or write', async () => {
    const trx = createTrackingTrx();
    seedTicket(trx);
    await recordFirstResponse(trx, TENANT_ID, TICKET_ID, new Date());
    expectLockTakenFirst(trx);
  });

  it('recordResolution locks before any read or write', async () => {
    const trx = createTrackingTrx();
    seedTicket(trx);
    await recordResolution(trx, TENANT_ID, TICKET_ID, new Date());
    expectLockTakenFirst(trx);
  });

  it('handlePriorityChange locks before any read or write', async () => {
    const trx = createTrackingTrx();
    seedTicket(trx);
    await handlePriorityChange(trx, TENANT_ID, TICKET_ID, 'priority-2');
    expectLockTakenFirst(trx);
  });

  it('handlePolicyChange locks before any read or write', async () => {
    const trx = createTrackingTrx();
    seedTicket(trx);
    await handlePolicyChange(trx, TENANT_ID, TICKET_ID, null);
    expectLockTakenFirst(trx);
  });

  it('pauseSla locks before any read or write', async () => {
    const trx = createTrackingTrx();
    seedTicket(trx);
    await pauseSla(trx, TENANT_ID, TICKET_ID, 'status_pause');
    expectLockTakenFirst(trx);
  });

  it('resumeSla locks before any read or write', async () => {
    const trx = createTrackingTrx();
    seedTicket(trx, { sla_paused_at: new Date('2024-01-01T00:30:00Z').toISOString() });
    await resumeSla(trx, TENANT_ID, TICKET_ID);
    expectLockTakenFirst(trx);
  });

  it('handleStatusChange locks before reading pause state', async () => {
    const trx = createTrackingTrx();
    seedTicket(trx);
    await handleStatusChange(trx, TENANT_ID, TICKET_ID, 'status-1', 'status-2');
    expectLockTakenFirst(trx);
  });

  it('handleResponseStateChange locks before reading pause state', async () => {
    const trx = createTrackingTrx();
    seedTicket(trx);
    await handleResponseStateChange(trx, TENANT_ID, TICKET_ID, null, 'awaiting_client');
    expectLockTakenFirst(trx);
  });
});
