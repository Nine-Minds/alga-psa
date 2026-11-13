/**
 * Ticket alga-2026-0003292: there is no zero-role state, so a user cannot be
 * created without one. The update schema omits role_ids and is unaffected.
 */
import { describe, expect, it } from 'vitest';
import { createUserSchema, updateUserSchema } from '../../../lib/api/schemas/userSchemas';

const base = {
  username: 'glinda',
  email: 'glinda@emeraldcity.oz',
  password: 'Bcfa42b3d5db5b!',
};

describe('createUserSchema role_ids', () => {
  it('rejects a create with no role_ids', () => {
    expect(createUserSchema.safeParse(base).success).toBe(false);
  });

  it('rejects an empty role_ids array', () => {
    expect(createUserSchema.safeParse({ ...base, role_ids: [] }).success).toBe(false);
  });

  it('accepts a create with one role', () => {
    const parsed = createUserSchema.safeParse({
      ...base,
      role_ids: ['7c9e6679-7425-40de-944b-e07fc1f90ae7'],
    });
    expect(parsed.success).toBe(true);
  });

  it('leaves updates unaffected', () => {
    expect(updateUserSchema.safeParse({ first_name: 'Glinda' }).success).toBe(true);
  });
});
