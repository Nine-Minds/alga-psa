import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Knex } from 'knex';

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_knex: unknown, fn: (trx: Knex.Transaction) => Promise<void>) => {
    await fn({} as Knex.Transaction);
  }),
  getConnection: vi.fn(async () => ({
    select: vi.fn(),
  })),
  getTenantContext: vi.fn(() => 'tenant-test'),
}));

const pauseSlaMock = vi.fn();
const resumeSlaMock = vi.fn();
const recordFirstResponseMock = vi.fn();
const recordResolutionMock = vi.fn();
const getSlaStatusMock = vi.fn(async () => ({ status: 'on_track' }));

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

describe('PgBossSlaBackend', () => {
  beforeEach(() => {
    pauseSlaMock.mockClear();
    resumeSlaMock.mockClear();
    recordFirstResponseMock.mockClear();
    recordResolutionMock.mockClear();
    getSlaStatusMock.mockClear();
  });

  it('startSlaTracking returns without error', async () => {
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
  });

  it('pauseSla calls slaPauseService.pauseSla()', async () => {
    const backend = new PgBossSlaBackend();
    await backend.pauseSla('ticket-1', 'status_pause');
    expect(pauseSlaMock).toHaveBeenCalledTimes(1);
  });

  it('resumeSla calls slaPauseService.resumeSla()', async () => {
    const backend = new PgBossSlaBackend();
    await backend.resumeSla('ticket-1');
    expect(resumeSlaMock).toHaveBeenCalledTimes(1);
  });

  it("completeSla('response') calls slaService.recordFirstResponse()", async () => {
    const backend = new PgBossSlaBackend();
    await backend.completeSla('ticket-1', 'response', true);
    expect(recordFirstResponseMock).toHaveBeenCalledTimes(1);
  });

  it("completeSla('resolution') calls slaService.recordResolution()", async () => {
    const backend = new PgBossSlaBackend();
    await backend.completeSla('ticket-1', 'resolution', true);
    expect(recordResolutionMock).toHaveBeenCalledTimes(1);
  });

  it('cancelSla returns without error', async () => {
    const backend = new PgBossSlaBackend();
    await expect(backend.cancelSla('ticket-1')).resolves.toBeUndefined();
  });

  it('getSlaStatus delegates to slaService.getSlaStatus()', async () => {
    const backend = new PgBossSlaBackend();
    const status = await backend.getSlaStatus('ticket-1');
    expect(getSlaStatusMock).toHaveBeenCalledTimes(1);
    expect(status).toEqual({ status: 'on_track' });
  });
});
