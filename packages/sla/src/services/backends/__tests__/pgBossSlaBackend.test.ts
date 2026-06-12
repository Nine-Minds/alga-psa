import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  createTenantKnexMock,
  withTransactionMock,
  getConnectionMock,
  pauseSlaMock,
  resumeSlaMock,
  recordFirstResponseMock,
  recordResolutionMock,
  getSlaStatusMock,
} = vi.hoisted(() => ({
  createTenantKnexMock: vi.fn(async () => ({ knex: {} })),
  withTransactionMock: vi.fn(),
  getConnectionMock: vi.fn(async () => ({ select: vi.fn() })),
  pauseSlaMock: vi.fn(),
  resumeSlaMock: vi.fn(),
  recordFirstResponseMock: vi.fn(),
  recordResolutionMock: vi.fn(),
  getSlaStatusMock: vi.fn(async () => ({ status: 'on_track' })),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  withTransaction: withTransactionMock,
  getConnection: getConnectionMock,
  getTenantContext: vi.fn(() => 'tenant-test'),
}));

vi.mock('../../slaPauseService', () => ({
  pauseSla: pauseSlaMock,
  resumeSla: resumeSlaMock,
}));

vi.mock('../../slaService', () => ({
  recordFirstResponse: recordFirstResponseMock,
  recordResolution: recordResolutionMock,
  getSlaStatus: getSlaStatusMock,
}));

import { PgBossSlaBackend } from '../PgBossSlaBackend';

// The mutation hooks must be genuine no-ops. The SLA columns are persisted by
// the caller before the backend runs; re-doing the write on a second pooled
// connection while the caller's transaction holds the tickets row lock
// self-deadlocks until pgbouncer reaps the session.
describe('PgBossSlaBackend', () => {
  beforeEach(() => {
    createTenantKnexMock.mockClear();
    withTransactionMock.mockClear();
    getConnectionMock.mockClear();
    pauseSlaMock.mockClear();
    resumeSlaMock.mockClear();
    recordFirstResponseMock.mockClear();
    recordResolutionMock.mockClear();
    getSlaStatusMock.mockClear();
  });

  const expectNoDbWork = () => {
    expect(withTransactionMock).not.toHaveBeenCalled();
    expect(createTenantKnexMock).not.toHaveBeenCalled();
    expect(getConnectionMock).not.toHaveBeenCalled();
    expect(pauseSlaMock).not.toHaveBeenCalled();
    expect(resumeSlaMock).not.toHaveBeenCalled();
    expect(recordFirstResponseMock).not.toHaveBeenCalled();
    expect(recordResolutionMock).not.toHaveBeenCalled();
  };

  it('startSlaTracking is a no-op', async () => {
    const backend = new PgBossSlaBackend();
    await expect(
      backend.startSlaTracking('ticket-1', 'policy-1', [], {
        schedule_id: '24x7',
        schedule_name: '24x7',
        timezone: 'UTC',
        is_default: false,
        is_24x7: true,
        entries: [],
        holidays: [],
      })
    ).resolves.toBeUndefined();
    expectNoDbWork();
  });

  it('pauseSla is a no-op (no transaction, no service delegation)', async () => {
    const backend = new PgBossSlaBackend();
    await expect(backend.pauseSla('ticket-1', 'status_pause')).resolves.toBeUndefined();
    expectNoDbWork();
  });

  it('resumeSla is a no-op (no transaction, no service delegation)', async () => {
    const backend = new PgBossSlaBackend();
    await expect(backend.resumeSla('ticket-1')).resolves.toBeUndefined();
    expectNoDbWork();
  });

  it("completeSla('response') is a no-op (no transaction, no service delegation)", async () => {
    const backend = new PgBossSlaBackend();
    await expect(backend.completeSla('ticket-1', 'response', true)).resolves.toBeUndefined();
    expectNoDbWork();
  });

  it("completeSla('resolution') is a no-op (no transaction, no service delegation)", async () => {
    const backend = new PgBossSlaBackend();
    await expect(backend.completeSla('ticket-1', 'resolution', null)).resolves.toBeUndefined();
    expectNoDbWork();
  });

  it('cancelSla is a no-op', async () => {
    const backend = new PgBossSlaBackend();
    await expect(backend.cancelSla('tenant-1', 'ticket-1')).resolves.toBeUndefined();
    expectNoDbWork();
  });

  it('getSlaStatus delegates to slaService.getSlaStatus()', async () => {
    const backend = new PgBossSlaBackend();
    const status = await backend.getSlaStatus('ticket-1');
    expect(getSlaStatusMock).toHaveBeenCalledTimes(1);
    expect(status).toEqual({ status: 'on_track' });
  });
});
