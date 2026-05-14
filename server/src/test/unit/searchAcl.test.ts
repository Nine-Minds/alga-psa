import { describe, expect, it } from 'vitest';

import { aclPredicateSql } from '../../lib/search/acl';

describe('search ACL SQL predicate', () => {
  it('T105 filters required_permission through the user permission set', () => {
    const fragment = aclPredicateSql({
      userId: '00000000-0000-0000-0000-000000000001',
      permissions: ['client:read'],
    });

    expect(fragment.sql).toContain(
      '(required_permission IS NULL OR required_permission = ANY(?::text[]))',
    );
    expect(fragment.bindings[0]).toEqual(['client:read']);
    expect(fragment.bindings[0]).not.toContain('ticket:read');
  });

  it('T107 requires visible_to_user_ids overlap when the row has a user restriction', () => {
    const userId = '00000000-0000-0000-0000-000000000001';
    const fragment = aclPredicateSql({
      userId,
      permissions: ['client:read'],
    });

    expect(fragment.sql).toContain(
      '(cardinality(visible_to_user_ids) = 0 OR visible_to_user_ids && ARRAY[?]::uuid[])',
    );
    expect(fragment.bindings[1]).toBe(userId);
  });
});
