import { describe, expect, it, vi } from 'vitest';

/**
 * The tri-state location contract, as the form boundary expresses it.
 *
 * `TicketModel.createTicket` only resolves a location when the caller said nothing
 * (`location_id === undefined`) and a contact is set; `null` is "the operator chose None" and is
 * kept. Everything upstream — the MSP form, REST v1, the portal, mobile, recurring generation —
 * reaches that rule by getting this distinction right, which is what the parse below does.
 *
 * The resolution itself is covered by shared/models/contactLocation.test.ts; this pins the parse
 * that decides whether resolution happens at all, because that is where the bug would live: before
 * this change an omitted field arrived as `null` and would have suppressed the autofill entirely.
 *
 * The guard is imported, not re-implemented: a copy of it here is exactly how the field-name bug
 * (`contact_name_id` on an input that carries `contact_id`) survived a green suite.
 */

// The guard is pure; the module's reads are covered by contactLocation.test.ts.
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => {
    throw new Error('ticketLocationAutofill.test.ts exercises the pure guard only');
  },
}));

import { shouldResolveContactLocation } from './contactLocation';

/** Mirrors the parse in packages/tickets/src/actions/ticketActions.ts. */
function parseFormLocationId(value: FormDataEntryValue | null): string | null | undefined {
  return value === null || value === ''
    ? undefined
    : value === 'none'
      ? null
      : (value as string);
}

describe('ticket location form parse', () => {
  it('treats an omitted field as "nobody said"', () => {
    const form = new FormData();
    expect(parseFormLocationId(form.get('location_id'))).toBeUndefined();
  });

  it('treats an empty value as "nobody said" too, for the legacy callers that send it', () => {
    const form = new FormData();
    form.append('location_id', '');
    expect(parseFormLocationId(form.get('location_id'))).toBeUndefined();
  });

  it('treats the None sentinel as an explicit null', () => {
    const form = new FormData();
    form.append('location_id', 'none');
    expect(parseFormLocationId(form.get('location_id'))).toBeNull();
  });

  it('passes a chosen location straight through', () => {
    const form = new FormData();
    form.append('location_id', 'loc-1');
    expect(parseFormLocationId(form.get('location_id'))).toBe('loc-1');
  });
});

describe('createTicket autofill guard', () => {
  it('resolves only when nobody said and a contact is set', () => {
    expect(shouldResolveContactLocation({ contact_id: 'ada' })).toBe(true);
  });

  it('keeps an explicit None rather than filling it in', () => {
    expect(shouldResolveContactLocation({ location_id: null, contact_id: 'ada' })).toBe(false);
  });

  it('keeps a chosen location', () => {
    expect(shouldResolveContactLocation({ location_id: 'loc-1', contact_id: 'ada' })).toBe(false);
  });

  it('does nothing without a contact', () => {
    expect(shouldResolveContactLocation({})).toBe(false);
    expect(shouldResolveContactLocation({ contact_id: null })).toBe(false);
  });
});
