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

  it('T108 allows rows with empty visible_to_user_ids for users with required permission', () => {
    const fragment = aclPredicateSql({
      userId: '00000000-0000-0000-0000-000000000001',
      permissions: ['client:read'],
    });

    expect(fragment.sql).toContain('required_permission = ANY(?::text[])');
    expect(fragment.sql).toContain('cardinality(visible_to_user_ids) = 0 OR');
    expect(fragment.bindings[0]).toEqual(['client:read']);
  });

  it('T109 hides internal-only rows from client-type users', () => {
    const fragment = aclPredicateSql({
      userId: '00000000-0000-0000-0000-000000000001',
      permissions: ['ticket:read'],
      isInternal: false,
    });

    expect(fragment.sql).toContain('(is_internal_only = false OR ?::boolean = true)');
    expect(fragment.bindings[3]).toBe(false);
  });

  it('T110 hides private rows unless the user is in visible_to_user_ids', () => {
    const userId = '00000000-0000-0000-0000-000000000001';
    const fragment = aclPredicateSql({
      userId,
      permissions: ['document:read'],
    });

    expect(fragment.sql).toContain(
      '(is_private = false OR visible_to_user_ids && ARRAY[?]::uuid[])',
    );
    expect(fragment.bindings[4]).toBe(userId);
  });

  it('T111 filters client_scope_id through accessible clients', () => {
    const accessibleClientIds = ['10000000-0000-0000-0000-000000000001'];
    const fragment = aclPredicateSql({
      userId: '00000000-0000-0000-0000-000000000001',
      permissions: ['document:read'],
      accessibleClientIds,
    });

    expect(fragment.sql).toContain('(client_scope_id IS NULL OR client_scope_id = ANY(?::uuid[]))');
    expect(fragment.bindings[5]).toEqual(accessibleClientIds);
  });
});
