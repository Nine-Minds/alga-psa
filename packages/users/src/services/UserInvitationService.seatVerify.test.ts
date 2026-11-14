/**
 * Verification is the boundary both the setup page and the completion action pass through. A seat-kind
 * invitation (the metadata `inviteCoManagedSeatTechnician` stamps on it) is refused there, before the
 * invitee's details are exposed, while `co-managed-seat` does not serve its sponsor. Ordinary invitations
 * never ask the seat capability.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gate = vi.hoisted(() => ({ seatServed: true, asked: [] as string[], metadata: {} as Record<string, unknown> }));

vi.mock('@alga-psa/core/capability', () => ({
  isCapabilityServed: async (key: string) => { gate.asked.push(key); return key === 'co-managed-seat' ? gate.seatServed : true; },
}));
vi.mock('@alga-psa/db', () => {
  const chain = (rows: () => unknown): any => new Proxy(function () {}, {
    get: (_t, prop) => prop === 'then' ? undefined : prop === 'first' ? async () => rows() : () => chain(rows),
    apply: () => chain(rows),
  });
  return {
    createTenantKnex: async () => ({ knex: {} }),
    requireTenantId: async () => 't1',
    withTransaction: async (_k: unknown, fn: any) => fn({ fn: { now: () => 0 }, raw: () => 0 }),
    tenantDb: (_c: unknown, _t: string) => ({
      unscoped: () => chain(() => ({ tenant: 't1', product_code: 'psa' })),
      table: () => chain(() => ({
        tenant: 't1', invitation_id: 'i1', email: 'dana@client.example', first_name: 'Dana', last_name: 'Reyes', role_id: null,
        role_name: null, token: 'tok', metadata: gate.metadata,
      })),
      tenantJoin: () => undefined,
    }),
  };
});

vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@alga-psa/auth', () => ({ checkPortalInvitationLimit: vi.fn(), formatRateLimitError: vi.fn() }));

import { UserInvitationService } from './UserInvitationService';

beforeEach(() => { gate.seatServed = true; gate.asked = []; gate.metadata = {}; });

describe('verifying a seat invitation', () => {
  it('opens for a served sponsor', async () => {
    gate.metadata = { co_managed_seat_assignment_id: 'as-1' };
    expect(await UserInvitationService.verifyToken('tok')).toMatchObject({ valid: true, tenant: 't1' });
    expect(gate.asked).toContain('co-managed-seat');
  });

  it('is refused while co-managed-seat does not serve the sponsor, with no invitee details', async () => {
    gate.metadata = { co_managed_seat_assignment_id: 'as-1' };
    gate.seatServed = false;
    const result = await UserInvitationService.verifyToken('tok');
    expect(result).toEqual({ valid: false, error: 'This feature is not available.', errorCode: 'CAPABILITY_UNAVAILABLE' });
  });

  it('never asks the seat capability for an ordinary invitation', async () => {
    gate.seatServed = false;
    expect(await UserInvitationService.verifyToken('tok')).toMatchObject({ valid: true });
    expect(gate.asked).not.toContain('co-managed-seat');
  });
});
