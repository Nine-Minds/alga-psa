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
    // Shaped like a real CoManagedTicketQueueItem, which is the only thing
    // production ever passes. These four cases previously used a hand-written
    // FLAT object and so agreed with a bug instead of catching it: the
    // predicate read `responsibility`/`work_revision` from the top level, every
    // real item carries them under `fields`, and the result was a silent
    // `undefined === 'msp'` -> false for every row. Nothing was handback
    // eligible, so the qualified list's selection column offered no rows and
    // the single composer never rendered.
    const item = (fields: Record<string, unknown>, relationshipId: string | null = RELATIONSHIP) =>
      ({ tenant: TENANT, ticketId: TICKET, workspaceName: 'Customer', relationshipId, fields }) as never;

    expect(isQualifiedHandbackEligible(item({ responsibility: 'msp', work_revision: 3 }))).toBe(true);
    // Customer-responsible work is never handback-selectable from the list.
    expect(isQualifiedHandbackEligible(item({ responsibility: 'customer', work_revision: 3 }))).toBe(false);
    // A native row has no relationship.
    expect(isQualifiedHandbackEligible(item({ responsibility: 'msp', work_revision: 3 }, null))).toBe(false);
    // No revision means the command cannot freeze an identity.
    expect(isQualifiedHandbackEligible(item({ responsibility: 'msp', work_revision: null }))).toBe(false);
    // Redacted rows omit the fields entirely rather than sending nulls.
    expect(isQualifiedHandbackEligible({ relationshipId: RELATIONSHIP })).toBe(false);
  });

  it('does not accept a flat item, which is how the eligibility bug hid', () => {
    // The regression that would have caught it. A top-level shape carries no
    // `fields`, so it must be ineligible rather than quietly true.
    expect(isQualifiedHandbackEligible(
      { relationshipId: RELATIONSHIP, responsibility: 'msp', work_revision: 3 } as never,
    )).toBe(false);
  });
});
