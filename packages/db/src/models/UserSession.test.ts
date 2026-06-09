import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateMock = vi.fn(async () => 1);
const whereNullMock = vi.fn(() => ({ update: updateMock }));
const whereMock = vi.fn(() => ({ whereNull: whereNullMock }));

const knexFn = Object.assign(
  vi.fn((_table: string) => ({ where: whereMock })),
  { fn: { now: () => '__now__' } },
);

const getConnectionMock = vi.fn(async () => knexFn);

vi.mock('../lib/tenant', () => ({ getConnection: (...args: unknown[]) => getConnectionMock(...(args as [])) }));

const { UserSession } = await import('./UserSession');

describe('UserSession.extendExpiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates expires_at for the matching, non-revoked session row', async () => {
    const expiresAt = new Date('2030-01-01T00:00:00.000Z');

    await UserSession.extendExpiry('tenant-1', 'sess-1', expiresAt);

    expect(getConnectionMock).toHaveBeenCalledWith('tenant-1');
    expect(whereMock).toHaveBeenCalledWith({ tenant: 'tenant-1', session_id: 'sess-1' });
    // Guard: never resurrect a revoked session.
    expect(whereNullMock).toHaveBeenCalledWith('revoked_at');
    expect(updateMock).toHaveBeenCalledWith({ expires_at: expiresAt, updated_at: '__now__' });
  });
});
