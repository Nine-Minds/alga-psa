import { describe, expect, it } from 'vitest';
import type { IComment } from '@alga-psa/types';
import { resolveCommentAuthor } from './commentAuthorResolution';
import { resolveLatestActivityActor } from './latestActivityActor';

// T028 (F016/F017): a non-interactive ('service') user is a named non-human author,
// never a client/contact and never a plain internal user.
const author = (user_type: string) => ({
  'user-1': {
    user_id: 'user-1',
    first_name: 'Datto',
    last_name: 'RMM',
    user_type,
    avatarUrl: null,
  },
});
const comment = { user_id: 'user-1', contact_id: 'contact-1' } as Pick<IComment, 'user_id' | 'contact_id'>;

describe('T028 comment author resolution for service users', () => {
  it('resolves a service user as a named service author', () => {
    const resolved = resolveCommentAuthor(comment, { userMap: author('service') });
    expect(resolved.source).toBe('user');
    expect(resolved.displayName).toBe('Datto RMM');
    expect(resolved.authorKind).toBe('service');
    expect(resolved.avatarKind).toBe('service');
    expect(resolved.avatarKind).not.toBe('contact');
  });

  it('keeps internal and client output unchanged', () => {
    const internal = resolveCommentAuthor(comment, { userMap: author('internal') });
    expect(internal.avatarKind).toBe('user');
    expect(internal.authorKind).toBe('internal');
    const client = resolveCommentAuthor(comment, { userMap: author('client') });
    expect(client.avatarKind).toBe('contact');
    expect(client.authorKind).toBe('client');
  });

  it('latest-activity actor kind is service for a service user, unchanged otherwise', () => {
    const row = {
      latest_activity_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      entered_at: '2026-01-01T00:00:00Z',
      updated_by: 'user-1',
    };
    const actorFor = (userType: string) =>
      resolveLatestActivityActor(row as any, null, {
        users: { 'user-1': { name: 'Datto RMM', userType } },
        contacts: {},
      } as any);
    expect(actorFor('service')).toEqual({ kind: 'service', name: 'Datto RMM' });
    expect(actorFor('internal')).toEqual({ kind: 'user', name: 'Datto RMM' });
    expect(actorFor('client')).toEqual({ kind: 'client_user', name: 'Datto RMM' });
  });
});
