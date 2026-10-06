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

describe('tenant context', () => {
  beforeEach(() => {
    mockKnexFactory.mockReset();
    mockGetKnexConfig.mockReset();
    vi.clearAllMocks();
  });

  it('createTenantKnex uses an explicit tenant id when provided', async () => {
    mockGetKnexConfig.mockResolvedValue({
      client: 'postgres',
      connection: { host: 'localhost', port: 5432, database: 'db', user: 'user', password: 'pw' },
      pool: {},
    });

    const knex = { transaction: vi.fn(), destroy: vi.fn(async () => {}) } as any;
    mockKnexFactory.mockReturnValue(knex);

    const { createTenantKnex, resetTenantConnectionPool } = await import('@alga-psa/db');
    await resetTenantConnectionPool();

    const result = await createTenantKnex('tenant-123');

    expect(result).toEqual({ knex, tenant: 'tenant-123' });
  });

  it('createTenantKnex falls back to AsyncLocalStorage tenant context', async () => {
    mockGetKnexConfig.mockResolvedValue({
      client: 'postgres',
      connection: { host: 'localhost', port: 5432, database: 'db', user: 'user', password: 'pw' },
      pool: {},
    });

    const knex = { transaction: vi.fn(), destroy: vi.fn(async () => {}) } as any;
    mockKnexFactory.mockReturnValue(knex);

    const { createTenantKnex, getTenantContext, runWithTenant, resetTenantConnectionPool } = await import('@alga-psa/db');
    await resetTenantConnectionPool();

    await runWithTenant('tenant-ctx', async () => {
      expect(getTenantContext()).toBe('tenant-ctx');
      const result = await createTenantKnex();
      expect(result).toEqual({ knex, tenant: 'tenant-ctx' });
    });
  });

  it('runWithoutTenant clears an inherited tenant for the callback and its async work only', async () => {
    const { getTenantContext, runWithTenant, runWithoutTenant } = await import('@alga-psa/db');

    await runWithTenant('tenant-outer', async () => {
      const seen = await runWithoutTenant(async () => {
        const before = getTenantContext();
        await Promise.resolve();
        const afterAwait = getTenantContext();
        const inTimer = await new Promise<string | undefined>((resolve) =>
          setTimeout(() => resolve(getTenantContext()), 0)
        );
        return { before, afterAwait, inTimer };
      });

      expect(seen).toEqual({ before: undefined, afterAwait: undefined, inTimer: undefined });
      expect(getTenantContext()).toBe('tenant-outer');
    });
  });
});
