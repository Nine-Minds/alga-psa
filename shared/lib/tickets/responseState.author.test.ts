import type { Knex } from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { nextResponseStateForComment, resolveCommentAuthor } from './responseState';

vi.mock('@alga-psa/db', () => ({
  tenantDb: (connection: Knex, tenant: string) => ({
    table: (table: string) => connection(table).where({ tenant }),
  }),
}));

describe('comment author response-state rules', () => {
  it.each([
    ['internal', 'internal', null, 'awaiting_client'],
    ['service', 'internal', null, 'awaiting_client'],
    ['client', 'client', 'contact-1', 'awaiting_internal'],
    ['unrecognized', 'unknown', null, null],
    [null, 'unknown', null, null],
  ] as const)('resolves %s authors before applying the public reply rule', async (
    userType, authorType, contactId, expectedState,
  ) => {
    const query = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      first: vi.fn(async () => userType === null ? undefined : {
        user_type: userType,
        contact_id: 'contact-1',
      }),
    };
    const connection = vi.fn(() => query) as unknown as Knex;

    const author = await resolveCommentAuthor(connection, 'tenant-1', 'user-1');

    expect(author).toEqual({ authorType, contactId });
    expect(nextResponseStateForComment(null, author.authorType, false)).toBe(expectedState);
    expect(nextResponseStateForComment('awaiting_internal', author.authorType, true)).toBe('awaiting_internal');
  });
});
