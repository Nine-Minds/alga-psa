// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ tenant: 'tenant-a' as string | null }));
const userBatch = vi.hoisted(() => vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `/u/${id}`]))));
const teamBatch = vi.hoisted(() => vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `/t/${id}`]))));
const contactOne = vi.hoisted(() => vi.fn(async (id: string) => `/c/${id}`));

vi.mock('@alga-psa/auth', () => ({
  withOptionalAuth:
    (action: (...a: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      session.tenant
        ? action({ user_id: 'u-1', tenant: session.tenant }, { tenant: session.tenant }, ...args)
        : action(null, null, ...args),
}));
vi.mock('@alga-psa/user-composition/actions/avatarActions', () => ({
  getUserAvatarUrlsBatchAction: userBatch,
  getContactAvatarUrlAction: contactOne,
}));
vi.mock('@alga-psa/teams/actions/team-actions/avatarActions', () => ({ getTeamAvatarUrlsBatchAction: teamBatch }));

import {
  getTicketContactAvatarUrl,
  getTicketTeamAvatarUrlsBatch,
  getTicketUserAvatarUrlsBatch,
} from './ticketAvatarActions';
import { nativeTicketDataSource } from '../lib/nativeTicketDataSource';

describe('native ticket avatar actions are session-tenant checked', () => {
  beforeEach(() => {
    session.tenant = 'tenant-a';
    vi.clearAllMocks();
  });

  it('answers for the session tenant', async () => {
    expect(await getTicketUserAvatarUrlsBatch(['u1'], 'tenant-a')).toEqual(new Map([['u1', '/u/u1']]));
    expect(await getTicketTeamAvatarUrlsBatch(['t1'], 'tenant-a')).toEqual(new Map([['t1', '/t/t1']]));
    expect(await getTicketContactAvatarUrl('c1', 'tenant-a')).toBe('/c/c1');
    expect(userBatch).toHaveBeenCalledWith(['u1'], 'tenant-a');
  });

  it('returns no avatars for a foreign tenant and never reads it', async () => {
    expect(await getTicketUserAvatarUrlsBatch(['u1'], 'tenant-b')).toEqual(new Map());
    expect(await getTicketTeamAvatarUrlsBatch(['t1'], 'tenant-b')).toEqual(new Map());
    expect(await getTicketContactAvatarUrl('c1', 'tenant-b')).toBeNull();
    expect(userBatch).not.toHaveBeenCalled();
    expect(teamBatch).not.toHaveBeenCalled();
    expect(contactOne).not.toHaveBeenCalled();
  });

  it('returns no avatars without a session', async () => {
    session.tenant = null;
    expect(await getTicketUserAvatarUrlsBatch(['u1'], 'tenant-a')).toEqual(new Map());
    expect(await getTicketContactAvatarUrl('c1', 'tenant-a')).toBeNull();
    expect(userBatch).not.toHaveBeenCalled();
  });

  it('is what the native data source forwards to', async () => {
    expect(await nativeTicketDataSource.avatars.getUserAvatarUrlsBatchAction(['u1'], 'tenant-b')).toEqual(new Map());
    expect(await nativeTicketDataSource.avatars.getTeamAvatarUrlsBatchAction(['t1'], 'tenant-a')).toEqual(
      new Map([['t1', '/t/t1']]),
    );
    expect(await nativeTicketDataSource.avatars.getContactAvatarUrlAction('c1', 'tenant-b')).toBeNull();
    expect(userBatch).not.toHaveBeenCalled();
  });
});
