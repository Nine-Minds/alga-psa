import { describe, expect, it } from 'vitest';
import { updateClientLocationSchema, updateClientSchema } from '../../../lib/api/schemas/client';

describe('client write schemas', () => {
  it('lets a location email be cleared with null while a blank string means "not sent"', () => {
    expect(updateClientLocationSchema.parse({ email: null })).toEqual({ email: null });
    expect(updateClientLocationSchema.parse({ email: '' })).toEqual({});
    expect(updateClientLocationSchema.parse({ email: ' Ops@Acme.test ' })).toEqual({ email: 'ops@acme.test' });
    expect(updateClientLocationSchema.safeParse({ email: 'nope' }).success).toBe(false);
  });

  it('accepts the deactivate_contacts choice alongside is_inactive', () => {
    expect(updateClientSchema.parse({ is_inactive: true, deactivate_contacts: false })).toEqual({ is_inactive: true, deactivate_contacts: false });
    expect(updateClientSchema.parse({ is_inactive: true })).toEqual({ is_inactive: true });
    // Location fields are still refused on the client body.
    expect(updateClientSchema.safeParse({ email: 'x@example.com' }).success).toBe(false);
  });
});
