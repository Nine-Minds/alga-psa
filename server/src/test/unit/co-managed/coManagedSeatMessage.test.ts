import { describe, expect, it } from 'vitest';
import { coManagedSeatMessage } from '@/components/co-managed/coManagedSeatMessage';

const t = (_key: string, options?: { defaultValue: string }) => options?.defaultValue ?? _key;

describe('seat refusal messages', () => {
  // F084: the chooser's blocker mapping covers every reason createCoManagedSeatArrangement refuses with.
  it.each([
    ['SPONSOR_NOT_ELIGIBLE', /no co-managed pool/],
    ['ENTITLEMENT_LAPSED', /lapsed/],
    ['CAPACITY_UNAVAILABLE', /no seats left/],
    ['CLIENT_INACTIVE', /Reactivate this client/],
    ['CLIENT_NOT_FOUND', /no longer available/],
    ['CLIENT_HAS_ARRANGEMENT', /already has co-managed IT/],
    ['OPERATION_CONFLICT', /different details/],
    ['INVALID_RESERVATION', /whole number of seats/],
  ])('%s has its own plain message', (code, text) => {
    expect(coManagedSeatMessage(code, t)).toMatch(text);
  });

  it('names the invitation and allocation refusals', () => {
    expect(coManagedSeatMessage('EMAIL_IN_USE', t)).toMatch(/already belongs to a user/);
    expect(coManagedSeatMessage('EMAIL_INVITED', t)).toMatch(/pending invitation/);
    expect(coManagedSeatMessage('SEAT_LIMIT', t)).toMatch(/Every seat is in use/);
    expect(coManagedSeatMessage('CO_MANAGED_SEAT_LIMIT', t)).toMatch(/Every seat is in use/);
    expect(coManagedSeatMessage('CO_MANAGED_POOL_LIMIT', t)).toMatch(/does not have that many seats/);
    expect(coManagedSeatMessage('CO_MANAGED_ALLOCATION_CONFLICT', t)).toMatch(/changed while you were editing/);
    expect(coManagedSeatMessage('ASSIGNMENT_NOT_PENDING', t)).toMatch(/already accepted/);
  });

  it('an unknown code is a generic message, never the raw code', () => {
    expect(coManagedSeatMessage('SOMETHING_NEW', t)).toBe('That did not work. Refresh and try again.');
    expect(coManagedSeatMessage(undefined, t)).toBe('That did not work. Refresh and try again.');
  });
});
