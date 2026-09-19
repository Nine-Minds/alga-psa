// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  isQualifiedHandbackEligible,
  isSharedTicketListIdentity,
  nativeTicketListIdentity,
  sharedTicketListIdentity,
  ticketListDetailHref,
  ticketListIdentityFromQueueItem,
  ticketListIdentityKey,
} from './ticketListIdentity';

const TENANT = '11111111-1111-4111-8111-111111111111';
const RELATIONSHIP = '22222222-2222-4222-8222-222222222222';
const TICKET = '33333333-3333-4333-8333-333333333333';

describe('ticketListIdentity', () => {
  it('distinguishes a native ticket from a shared ticket with the same id', () => {
    const native = nativeTicketListIdentity(TENANT, TICKET);
    const shared = sharedTicketListIdentity(TENANT, RELATIONSHIP, TICKET);
    expect(ticketListIdentityKey(native)).not.toBe(ticketListIdentityKey(shared));
    expect(isSharedTicketListIdentity(native)).toBe(false);
    expect(isSharedTicketListIdentity(shared)).toBe(true);
  });

  it('builds a stable, lower-cased key from the queue row identity', () => {
    const item = ticketListIdentityFromQueueItem({ tenant: TENANT.toUpperCase(), relationshipId: RELATIONSHIP, ticketId: TICKET });
    expect(ticketListIdentityKey(item)).toBe(`shared|${TENANT}|${RELATIONSHIP}|${TICKET}`);
  });

  it('treats a relationship-less qualified row as native', () => {
    expect(ticketListIdentityFromQueueItem({ tenant: TENANT, relationshipId: null, ticketId: TICKET }))
      .toEqual({ kind: 'native', tenant: TENANT, ticketId: TICKET });
  });

  it('routes native rows to the native detail and shared rows to the MSP-shell shared detail', () => {
    expect(ticketListDetailHref(nativeTicketListIdentity(TENANT, TICKET))).toBe(`/msp/tickets/${TICKET}`);
    expect(ticketListDetailHref(sharedTicketListIdentity(TENANT, RELATIONSHIP, TICKET)))
      .toBe(`/msp/co-management/tickets/${TENANT}/${RELATIONSHIP}/${TICKET}`);
  });

  it('applies the existing handback eligibility rules', () => {
    expect(isQualifiedHandbackEligible({ relationshipId: RELATIONSHIP, responsibility: 'msp', work_revision: 3 })).toBe(true);
    // Customer-responsible work is never handback-selectable from the list.
    expect(isQualifiedHandbackEligible({ relationshipId: RELATIONSHIP, responsibility: 'customer', work_revision: 3 })).toBe(false);
    // A native row has no relationship.
    expect(isQualifiedHandbackEligible({ relationshipId: null, responsibility: 'msp', work_revision: 3 })).toBe(false);
    // No revision means the command cannot freeze an identity.
    expect(isQualifiedHandbackEligible({ relationshipId: RELATIONSHIP, responsibility: 'msp', work_revision: null })).toBe(false);
  });
});
