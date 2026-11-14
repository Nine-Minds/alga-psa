import { describe, expect, it } from 'vitest';
import { assertSeatTechnicianWrite, isSeatTechnicianGuardError, SeatTechnicianGuardError } from './seatTechnicianGuard';

// A database that must not be touched: the cheap cases decide before any query.
const untouched = new Proxy({}, { get() { throw new Error('the guard queried the database'); } }) as any;

describe('assertSeatTechnicianWrite', () => {
  it('asks the database nothing when there is no user, or no role to write', async () => {
    await assertSeatTechnicianWrite(untouched, 't', [], { teamMembership: true });
    await assertSeatTechnicianWrite(untouched, 't', [undefined, null, ''], { roleIds: ['r'] });
    await assertSeatTechnicianWrite(untouched, 't', ['u'], { roleIds: [] });
  });

  it('recognises its refusal by name across bundle boundaries', () => {
    const refusal = new SeatTechnicianGuardError('SEAT_TECHNICIAN_TEAM_REFUSED', ['u']);
    expect(isSeatTechnicianGuardError(refusal)).toBe(true);
    expect(isSeatTechnicianGuardError({ name: 'SeatTechnicianGuardError' })).toBe(true);
    expect(isSeatTechnicianGuardError(new Error('other'))).toBe(false);
    expect(refusal).toMatchObject({ statusCode: 409, code: 'SEAT_TECHNICIAN_TEAM_REFUSED', userIds: ['u'] });
  });
});
