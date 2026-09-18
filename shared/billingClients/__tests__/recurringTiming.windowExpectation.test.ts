/**
 * Behavioral coverage for isRecurringLineExpectedInClientCadenceWindow, the
 * predicate the invoice-generation materialization guard uses to decide which
 * recurring client-cadence lines must have a settled service period inside an
 * invoice window. The live smoke failure: an arrears line assigned exactly at
 * the window start (its first billable period ends a month later) was demanded
 * by the guard, so previewing a sibling line's window failed with a false
 * "not materialized" error instead of the coded missing-usage state.
 */
import { describe, expect, it } from 'vitest';
import { isRecurringLineExpectedInClientCadenceWindow } from '../recurringTiming';

const WINDOW = { windowStart: '2026-09-01', windowEnd: '2026-10-01' };

describe('isRecurringLineExpectedInClientCadenceWindow', () => {
  it('expects an arrears line whose assignment began before the window start', () => {
    expect(
      isRecurringLineExpectedInClientCadenceWindow({
        duePosition: 'arrears',
        assignmentStart: '2026-08-01',
        assignmentEnd: null,
        ...WINDOW,
      }),
    ).toBe(true);
  });

  it('does not expect an arrears line assigned exactly at the window start', () => {
    // Its first billed service period is [2026-09-01, 2026-10-01), settled in
    // the NEXT window — nothing exists to materialize in this one.
    expect(
      isRecurringLineExpectedInClientCadenceWindow({
        duePosition: 'arrears',
        assignmentStart: '2026-09-01',
        assignmentEnd: null,
        ...WINDOW,
      }),
    ).toBe(false);
  });

  it('does not expect an arrears line assigned after the window start', () => {
    expect(
      isRecurringLineExpectedInClientCadenceWindow({
        duePosition: 'arrears',
        assignmentStart: '2026-09-15',
        assignmentEnd: null,
        ...WINDOW,
      }),
    ).toBe(false);
  });

  it('expects an arrears line that began mid prior period (prorated first period)', () => {
    expect(
      isRecurringLineExpectedInClientCadenceWindow({
        duePosition: 'arrears',
        assignmentStart: '2026-08-15',
        assignmentEnd: null,
        ...WINDOW,
      }),
    ).toBe(true);
  });

  it('expects an advance line assigned at the window start', () => {
    // Advance bills the window itself, so an assignment starting with the
    // window has a service period settling inside it.
    expect(
      isRecurringLineExpectedInClientCadenceWindow({
        duePosition: 'advance',
        assignmentStart: '2026-09-01',
        assignmentEnd: null,
        ...WINDOW,
      }),
    ).toBe(true);
  });

  it('does not expect an advance line whose assignment starts at the window end', () => {
    expect(
      isRecurringLineExpectedInClientCadenceWindow({
        duePosition: 'advance',
        assignmentStart: '2026-10-01',
        assignmentEnd: null,
        ...WINDOW,
      }),
    ).toBe(false);
  });

  it('does not expect an advance line that ended before the window start', () => {
    expect(
      isRecurringLineExpectedInClientCadenceWindow({
        duePosition: 'advance',
        assignmentStart: '2026-01-01',
        assignmentEnd: '2026-08-01',
        ...WINDOW,
      }),
    ).toBe(false);
  });
});
