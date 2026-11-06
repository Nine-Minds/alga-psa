import { describe, expect, it } from 'vitest';
import { isPermissionSubset } from './permissionSubset';

describe('isPermissionSubset', () => {
  it('allows a nonempty permission set contained in the actor authority', () => {
    expect(isPermissionSubset(['ticket:read', 'user:update'], new Set(['ticket:read', 'user:update', 'user:create']))).toBe(true);
  });

  it('rejects the set when any requested permission is missing', () => {
    expect(isPermissionSubset(['ticket:read', 'user:admin'], new Set(['ticket:read', 'user:update']))).toBe(false);
  });
});
