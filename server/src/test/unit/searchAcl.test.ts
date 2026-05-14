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
});
