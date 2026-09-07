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

  it('resolves a client-portal user author with a contact avatar', () => {
    const resolved = resolveCommentAuthor(
      {
        user_id: 'user-client-1',
        contact_id: null,
      } as Pick<IComment, 'user_id' | 'contact_id'>,
      {
        userMap: {
          'user-client-1': {
            user_id: 'user-client-1',
            first_name: 'Robin',
            last_name: 'Portal',
            email: 'robin.portal@example.com',
            user_type: 'client',
            avatarUrl: '/avatars/contact-robin.png',
          },
        },
        contactMap: {},
      }
    );

    expect(resolved.source).toBe('user');
    expect(resolved.displayName).toBe('Robin Portal');
    expect(resolved.userType).toBe('client');
    expect(resolved.avatarKind).toBe('contact');
    expect(resolved.avatarUrl).toBe('/avatars/contact-robin.png');
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

it('uses saved foreign labels and initials without a local directory or avatar identity', () => {
  const resolved = resolveCommentAuthor({ actor_reference_id: 'owner-reference', actor_display_name: 'Morgan Provider', actor_organization_name: 'Historical MSP' }, { userMap: {} });
  expect(resolved).toEqual({ source: 'collaborator', displayName: 'Morgan Provider (Historical MSP)', avatarName: 'Morgan Provider', avatarKind: 'user', avatarUrl: null });
  expect(resolved.userId).toBeUndefined(); expect(resolved.contactId).toBeUndefined(); expect(resolved.email).toBeUndefined();
});

it.each([{ user_id: 'collision' }, { contact_id: 'collision' }, { actor_display_name: null }, { actor_organization_name: '' }, { actor_reference_id: null }])('does not fall back to a local identity for malformed foreign attribution', alteration => {
  const resolved = resolveCommentAuthor({ actor_reference_id: 'owner-reference', actor_display_name: 'Morgan Provider', actor_organization_name: 'MSP', ...alteration }, {
    userMap: { collision: { user_id: 'collision', first_name: 'Local', last_name: 'Person', email: 'private@example.test', user_type: 'internal', avatarUrl: '/private-avatar' } },
    contactMap: { collision: { contact_id: 'collision', full_name: 'Local Contact', email: 'contact@example.test', avatarUrl: '/private-contact-avatar' } },
  });
  expect(resolved.source).toBe('collaborator'); expect(resolved.displayName).toBe('Unknown User');
  expect(resolved.email).toBeUndefined(); expect(resolved.avatarUrl).toBeNull(); expect(resolved.userId).toBeUndefined(); expect(resolved.contactId).toBeUndefined();
});
