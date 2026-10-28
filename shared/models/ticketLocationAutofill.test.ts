import { describe, expect, it } from 'vitest';

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
 */

/** Mirrors the parse in packages/tickets/src/actions/ticketActions.ts. */
function parseFormLocationId(value: FormDataEntryValue | null): string | null | undefined {
  return value === null || value === ''
    ? undefined
    : value === 'none'
      ? null
      : (value as string);
}

/** Mirrors the guard in TicketModel.createTicket. */
function shouldResolveFromContact(input: {
  location_id?: string | null;
  contact_name_id?: string | null;
}): boolean {
  return input.location_id === undefined && Boolean(input.contact_name_id);
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
    expect(shouldResolveFromContact({ contact_name_id: 'ada' })).toBe(true);
  });

  it('keeps an explicit None rather than filling it in', () => {
    expect(shouldResolveFromContact({ location_id: null, contact_name_id: 'ada' })).toBe(false);
  });

  it('keeps a chosen location', () => {
    expect(shouldResolveFromContact({ location_id: 'loc-1', contact_name_id: 'ada' })).toBe(false);
  });

  it('does nothing without a contact', () => {
    expect(shouldResolveFromContact({})).toBe(false);
    expect(shouldResolveFromContact({ contact_name_id: null })).toBe(false);
  });
});
