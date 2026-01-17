import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockKnexFactory = vi.fn();
const mockGetKnexConfig = vi.fn();

vi.mock('@alga-psa/core', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('./knexfile', () => ({
  getKnexConfig: mockGetKnexConfig,
}));

vi.mock('./knex-turbopack', () => ({
  default: mockKnexFactory,
}));

describe('withTransaction', () => {
  beforeEach(() => {
    mockKnexFactory.mockReset();
    mockGetKnexConfig.mockReset();
    vi.clearAllMocks();
  });

  it('starts a transaction when given a tenant id', async () => {
    mockGetKnexConfig.mockResolvedValue({
      client: 'postgres',
      connection: { host: 'localhost', port: 5432, database: 'db', user: 'user', password: 'pw' },
      pool: {},
    });

    const trx = { id: 'trx-1' } as any;
    const knex = {
      transaction: vi.fn(async (cb: any) => cb(trx)),
    } as any;
    mockKnexFactory.mockReturnValue(knex);

    const { withTransaction, resetTenantConnectionPool } = await import('@alga-psa/db');
    await resetTenantConnectionPool();

    const result = await withTransaction('tenant-1', async (t) => ({ ok: true, trx: t }));

    expect(mockGetKnexConfig).toHaveBeenCalled();
    expect(mockKnexFactory).toHaveBeenCalled();
    expect(knex.transaction).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, trx });
  });

  it('uses an existing knex instance when provided', async () => {
    const trx = { id: 'trx-2' } as any;
    const knex = {
      transaction: vi.fn(async (cb: any) => cb(trx)),
    } as any;

    const { withTransaction } = await import('@alga-psa/db');

    const result = await withTransaction(knex, async (t) => ({ ok: true, trx: t }));

    expect(knex.transaction).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, trx });
  });

  it('does not nest transactions when provided a transaction', async () => {
    const trx = {
      commit: vi.fn(),
      rollback: vi.fn(),
      id: 'trx-3',
    } as any;

    const { withTransaction } = await import('@alga-psa/db');

    const result = await withTransaction(trx, async (t) => ({ ok: true, trx: t }));

    expect(result).toEqual({ ok: true, trx });
  });

  it('commits on success when it opens the transaction', async () => {
    const trx = {
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => {}),
    } as any;

    const knex = {
      transaction: vi.fn(async (cb: any) => {
        try {
          const result = await cb(trx);
          await trx.commit();
          return result;
        } catch (error) {
          await trx.rollback(error);
          throw error;
        }
      }),
    } as any;

    const { withTransaction } = await import('@alga-psa/db');

    const result = await withTransaction(knex, async () => ({ ok: true }));

    expect(result).toEqual({ ok: true });
    expect(trx.commit).toHaveBeenCalledTimes(1);
    expect(trx.rollback).not.toHaveBeenCalled();
  });

  it('rolls back on error when it opens the transaction', async () => {
    const trx = {
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => {}),
    } as any;

    const knex = {
      transaction: vi.fn(async (cb: any) => {
        try {
          const result = await cb(trx);
          await trx.commit();
          return result;
        } catch (error) {
          await trx.rollback(error);
          throw error;
        }
      }),
    } as any;

    const { withTransaction } = await import('@alga-psa/db');

    await expect(withTransaction(knex, async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');

    expect(trx.commit).not.toHaveBeenCalled();
    expect(trx.rollback).toHaveBeenCalledTimes(1);
  });
});
