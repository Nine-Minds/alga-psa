import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateMock = vi.fn(async () => 1);
const builder = {
  where: vi.fn(() => builder),
  whereNull: vi.fn(() => builder),
  update: updateMock,
};

const knexFn = Object.assign(
  vi.fn((_table: string) => builder),
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
    expect(knexFn).toHaveBeenCalledWith('sessions');
    expect(builder.where).toHaveBeenCalledWith('sessions.tenant', 'tenant-1');
    expect(builder.where).toHaveBeenCalledWith({ session_id: 'sess-1' });
    // Guard: never resurrect a revoked session.
    expect(builder.whereNull).toHaveBeenCalledWith('revoked_at');
    expect(updateMock).toHaveBeenCalledWith({ expires_at: expiresAt, updated_at: '__now__' });
  });
});
