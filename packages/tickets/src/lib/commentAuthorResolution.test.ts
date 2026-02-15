import { describe, expect, it } from 'vitest';
import type { IComment } from '@alga-psa/types';
import { resolveCommentAuthor } from './commentAuthorResolution';

describe('resolveCommentAuthor', () => {
  it('prefers user author when both user_id and contact_id are present', () => {
    const resolved = resolveCommentAuthor(
      {
        user_id: 'user-1',
        contact_id: 'contact-1',
      } as Pick<IComment, 'user_id' | 'contact_id'>,
      {
        userMap: {
          'user-1': {
            user_id: 'user-1',
            first_name: 'Pat',
            last_name: 'Agent',
            email: 'pat.agent@example.com',
            user_type: 'internal',
            avatarUrl: null,
          },
        },
        contactMap: {
          'contact-1': {
            contact_id: 'contact-1',
            full_name: 'Pat Contact',
            email: 'pat.contact@example.com',
            avatarUrl: null,
          },
        },
      }
    );

    expect(resolved.source).toBe('user');
    expect(resolved.displayName).toBe('Pat Agent');
    expect(resolved.email).toBe('pat.agent@example.com');
    expect(resolved.avatarKind).toBe('user');
  });

  it('uses contact author when user is not resolvable and contact is present', () => {
    const resolved = resolveCommentAuthor(
      {
        user_id: null,
        contact_id: 'contact-2',
      } as Pick<IComment, 'user_id' | 'contact_id'>,
      {
        userMap: {},
        contactMap: {
          'contact-2': {
            contact_id: 'contact-2',
            full_name: 'Casey Contact',
            email: 'casey.contact@example.com',
            avatarUrl: null,
          },
        },
      }
    );

    expect(resolved.source).toBe('contact');
    expect(resolved.displayName).toBe('Casey Contact');
    expect(resolved.email).toBe('casey.contact@example.com');
    expect(resolved.avatarKind).toBe('contact');
  });

  it('falls back to Unknown User when neither user nor contact can be resolved', () => {
    const resolved = resolveCommentAuthor(
      {
        user_id: null,
        contact_id: null,
      } as Pick<IComment, 'user_id' | 'contact_id'>,
      {
        userMap: {},
        contactMap: {},
      }
    );

    expect(resolved.source).toBe('unknown');
    expect(resolved.displayName).toBe('Unknown User');
    expect(resolved.avatarKind).toBe('unknown');
    expect(resolved.email).toBeUndefined();
  });
});
