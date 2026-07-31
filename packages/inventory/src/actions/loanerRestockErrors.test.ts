import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  actionError: (message: string) => ({ actionError: message }),
  permissionError: (message: string) => ({ permissionError: message }),
}));

import {
  loanerActionErrorFrom,
  restockReturnActionErrorFrom,
  normalizeDueDate,
  humanStatus,
  currentStatusOf,
} from './loanerRestockErrors';

describe('loanerActionErrorFrom', () => {
  it('returns permission envelopes for RBAC and not-logged-in failures', () => {
    expect(loanerActionErrorFrom(new Error('Permission denied: inventory update required'))).toEqual({
      permissionError: 'Permission denied: inventory update required',
    });
    expect(loanerActionErrorFrom(new Error('user is not logged in'))).toEqual({
      permissionError: 'user is not logged in',
    });
  });

  it('maps the expected loaner business-rule failures to actionable messages', () => {
    expect(loanerActionErrorFrom(new Error('client_id is required to loan out a unit'))).toEqual({
      actionError: 'Choose a client before loaning out the unit.',
    });
    expect(loanerActionErrorFrom(new Error('location_id is required to return a loaner'))).toEqual({
      actionError: 'Choose a return location.',
    });
    expect(loanerActionErrorFrom(new Error('loan_due_at must be a valid date'))).toEqual({
      actionError: 'Choose a valid due date.',
    });
    expect(loanerActionErrorFrom(new Error('Stock unit not found'))).toEqual({
      actionError: 'Stock unit not found. It may have been updated or deleted. Refresh and try again.',
    });
  });

  it('humanizes the snake_case status embedded in loan-out / return guard errors', () => {
    // The raw guard message carries a snake_case enum; it must never reach the user.
    expect(
      loanerActionErrorFrom(new Error('Unit must be in_stock to loan out (current status: on_loan)')),
    ).toEqual({ actionError: "This unit can't be loaned out — it's currently On loan." });

    expect(
      loanerActionErrorFrom(new Error('Unit must be on_loan to return (current status: in_rma)')),
    ).toEqual({ actionError: "This unit isn't out on loan — it's currently In RMA." });
  });

  it('falls back to a status-free sentence when the guard message omits the current status', () => {
    expect(loanerActionErrorFrom(new Error('Unit must be in_stock to loan out'))).toEqual({
      actionError: "This unit can't be loaned out.",
    });
    expect(loanerActionErrorFrom(new Error('Unit must be on_loan to return'))).toEqual({
      actionError: "This unit isn't out on loan.",
    });
  });

  it('maps a 22P02 uuid-cast error to a safe message instead of leaking raw Knex SQL', () => {
    // A serial/MAC typed where a UUID is expected — the live-reproduced defect this fixes.
    expect(
      loanerActionErrorFrom({
        code: '22P02',
        message: 'invalid input syntax for type uuid: "SN-123" - select * from "stock_units" where ...',
      }),
    ).toEqual({
      actionError: "That doesn't look like a valid record reference. Pick the unit and client from the lists.",
    });
  });

  it('maps foreign-key and unique-violation codes, and returns null for unexpected errors', () => {
    expect(loanerActionErrorFrom({ code: '23503' })).toEqual({
      actionError: 'One of the selected loaner records is no longer valid. Refresh and try again.',
    });
    expect(loanerActionErrorFrom({ code: '23505' })).toEqual({
      actionError: 'This loaner update conflicts with an existing record. Refresh and try again.',
    });
    // Unexpected failures are NOT swallowed — the caller rethrows so they surface loudly.
    expect(loanerActionErrorFrom(new Error('connection terminated unexpectedly'))).toBeNull();
    expect(loanerActionErrorFrom({ code: '42P01' })).toBeNull();
  });
});

describe('restockReturnActionErrorFrom', () => {
  it('returns permission envelopes for RBAC and not-logged-in failures', () => {
    expect(restockReturnActionErrorFrom(new Error('Permission denied: inventory update required'))).toEqual({
      permissionError: 'Permission denied: inventory update required',
    });
    expect(restockReturnActionErrorFrom(new Error('user is not logged in'))).toEqual({
      permissionError: 'user is not logged in',
    });
  });

  it('maps the expected restock business-rule failures to actionable messages', () => {
    expect(restockReturnActionErrorFrom(new Error('restocking_fee_cents must be a non-negative integer (cents)'))).toEqual({
      actionError: 'Restocking fee must be a non-negative amount.',
    });
    expect(restockReturnActionErrorFrom(new Error('location_id is required to restock this unit'))).toEqual({
      actionError: 'Choose a location to restock this unit.',
    });
    expect(
      restockReturnActionErrorFrom(new Error('service_id and location_id are required for a non-serialized restock return')),
    ).toEqual({ actionError: 'Choose a product and location before restocking non-serialized inventory.' });
    expect(
      restockReturnActionErrorFrom(new Error('quantity must be a positive number for a non-serialized restock return')),
    ).toEqual({ actionError: 'Restock quantity must be greater than zero.' });
    expect(
      restockReturnActionErrorFrom(new Error('This product is serialized; provide unit_id to restock a specific unit')),
    ).toEqual({ actionError: 'This product is serialized. Choose the specific unit to restock.' });
  });

  it('humanizes the delivered/returned guard status and keeps the eligibility hint', () => {
    expect(
      restockReturnActionErrorFrom(new Error('Unit must be delivered or returned to restock (current status: on_loan)')),
    ).toEqual({
      actionError:
        "This unit can't be restocked — it's currently On loan. Only delivered or returned units can be restocked.",
    });
  });

  it('maps a 22P02 uuid-cast error to a safe message (location-oriented copy)', () => {
    expect(restockReturnActionErrorFrom({ code: '22P02' })).toEqual({
      actionError: "That doesn't look like a valid record reference. Pick the unit and location from the lists.",
    });
  });

  it('maps constraint codes and returns null for unexpected errors', () => {
    expect(restockReturnActionErrorFrom({ code: '23503' })).toEqual({
      actionError: 'One of the selected records is no longer valid. Refresh and try again.',
    });
    expect(restockReturnActionErrorFrom({ code: '23505' })).toEqual({
      actionError: 'This restock conflicts with an existing record. Refresh and try again.',
    });
    expect(restockReturnActionErrorFrom(new Error('some unmapped failure'))).toBeNull();
  });
});

describe('normalizeDueDate', () => {
  it('treats null, undefined, and empty string as an open-ended (no) due date', () => {
    expect(normalizeDueDate(null)).toBeNull();
    expect(normalizeDueDate(undefined)).toBeNull();
    expect(normalizeDueDate('')).toBeNull();
  });

  it('pins a date-only string to UTC midnight so the stored day never shifts with time zones', () => {
    expect(normalizeDueDate('2026-07-20')).toBe('2026-07-20T00:00:00.000Z');
  });

  it('passes through full timestamps and Date instances unchanged', () => {
    expect(normalizeDueDate('2026-07-20T15:30:00.000Z')).toBe('2026-07-20T15:30:00.000Z');
    const d = new Date('2026-07-20T00:00:00Z');
    expect(normalizeDueDate(d)).toBe(d);
  });

  it('throws the guarded message for garbage input (mapped to a toast upstream)', () => {
    expect(() => normalizeDueDate('not-a-date')).toThrow('loan_due_at must be a valid date');
    expect(() => normalizeDueDate('2026-13-45')).toThrow('loan_due_at must be a valid date');
  });
});

describe('status helpers', () => {
  it('humanStatus labels every known enum and gracefully de-snakes unknowns', () => {
    expect(humanStatus('in_stock')).toBe('In stock');
    expect(humanStatus('in_rma')).toBe('In RMA');
    expect(humanStatus('some_future_status')).toBe('some future status');
  });

  it('currentStatusOf extracts the embedded status, or null when absent', () => {
    expect(currentStatusOf('Unit must be in_stock to loan out (current status: allocated)')).toBe('allocated');
    expect(currentStatusOf('Unit must be in_stock to loan out')).toBeNull();
  });
});
