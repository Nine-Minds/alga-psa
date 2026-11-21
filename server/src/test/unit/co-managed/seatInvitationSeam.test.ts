/**
 * Seat invitation acceptance crosses from `@alga-psa/users` (the team setup flow that receives the
 * token) to `@alga-psa/co-managed` (the seat command) through the `coManagedSeatInvitation` shared-work
 * seam. The co-managed registration installs the provider; the users contract resolves it by name. The
 * users package must never import co-managed: that edge closed the cycle
 * clients -> portal-shared -> users -> co-managed -> scheduling -> clients.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const accept = vi.hoisted(() => vi.fn());
const gate = vi.hoisted(() => ({ seatServed: true }));

class SeatError extends Error {
  constructor(public readonly code: string) { super(`refused: ${code}`); }
}

vi.mock('@alga-psa/core/capability', () => ({
  serves: async (key: string) => ({ served: key === 'co-managed-seat' ? gate.seatServed : false }),
}));
vi.mock('@alga-psa/co-managed/seatInvitation', () => ({
  acceptCoManagedSeatInvitation: (...a: unknown[]) => accept(...a),
  CoManagedSeatInvitationError: SeatError,
}));

import { registerCoManagedSeatInvitationAcceptance } from '@alga-psa/co-managed/seatInvitationRegistration';
import { seatInvitationAcceptance } from '@alga-psa/users/lib/coManagedInvitationCapability';

const knex = { marker: 'knex' } as never;
const input = { token: 'a'.repeat(64), password: 'Sup3r-secret-pass!' };

beforeEach(() => {
  accept.mockReset();
  gate.seatServed = true;
  seatInvitationAcceptance().reset();
  registerCoManagedSeatInvitationAcceptance();
});

describe('the seat invitation seam, as co-managed registers it and users resolves it', () => {
  it('runs the seat command for a sponsor co-managed-seat serves', async () => {
    accept.mockResolvedValue({ created: true, user_id: 'seat-user', email: 'x@y.z', state: 'active' });
    const answer = await seatInvitationAcceptance().delegate('sponsor', (seat) => seat.acceptSeatInvitation(knex, input));
    expect(answer).toEqual({ handled: true, accepted: { user_id: 'seat-user', created: true } });
    expect(accept).toHaveBeenCalledWith(knex, input);
  });

  it('carries a seat refusal across as its code and message, not as a class', async () => {
    accept.mockRejectedValue(new SeatError('INVITATION_EXPIRED'));
    const answer = await seatInvitationAcceptance().delegate('sponsor', (seat) => seat.acceptSeatInvitation(knex, input));
    expect(answer).toEqual({ handled: true, refused: { code: 'INVITATION_EXPIRED', message: 'refused: INVITATION_EXPIRED' } });
  });

  it('lets an unexpected failure propagate', async () => {
    accept.mockRejectedValue(new Error('connection reset'));
    await expect(seatInvitationAcceptance().delegate('sponsor', (seat) => seat.acceptSeatInvitation(knex, input)))
      .rejects.toThrow('connection reset');
  });

  it('is not handled for a sponsor co-managed-seat does not serve', async () => {
    gate.seatServed = false;
    expect(await seatInvitationAcceptance().delegate('sponsor', (seat) => seat.acceptSeatInvitation(knex, input)))
      .toEqual({ handled: false });
    expect(accept).not.toHaveBeenCalled();
  });

  it('registers once however many times the registration runs', () => {
    expect(() => registerCoManagedSeatInvitationAcceptance()).not.toThrow();
    expect(seatInvitationAcceptance().hasProvider()).toBe(true);
  });
});

describe('the users package', () => {
  it('never imports @alga-psa/co-managed, and does not declare it', () => {
    const root = resolve(__dirname, '../../../../../packages/users');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies })).not.toContain('@alga-psa/co-managed');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && /(from|import\()\s*['"]@alga-psa\/co-managed(\/|['"])/.test(readFileSync(path, 'utf8'))) offenders.push(path);
      }
    };
    walk(join(root, 'src'));
    expect(offenders).toEqual([]);
  });
});
