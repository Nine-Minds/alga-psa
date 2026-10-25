import { describe, expect, it } from 'vitest';
import { allowedCustodyEvents, assertCustodyTransition, nextCustodyState, CustodyTransitionError } from './stateMachine';
import { formatCustodyForLabel, formatCustodyForLabelMulti, formatFollowUpDate } from './labelFormat';

describe('custody state machine', () => {
  it('allows exactly the designed transitions', () => {
    expect(nextCustodyState('in_office', 'moved')).toBe('in_office');
    expect(nextCustodyState('in_office', 'handed_off')).toBe('in_office');
    expect(nextCustodyState('in_office', 'shipped')).toBe('with_vendor');
    expect(nextCustodyState('with_vendor', 'received')).toBe('in_office');
    expect(nextCustodyState('in_office', 'returned')).toBe('closed');
    expect(nextCustodyState('with_vendor', 'returned')).toBe('closed');
  });
  it('refuses everything else, including any step on a closed episode', () => {
    expect(() => assertCustodyTransition('with_vendor', 'moved')).toThrow(CustodyTransitionError);
    expect(() => assertCustodyTransition('in_office', 'received')).toThrow(CustodyTransitionError);
    expect(() => assertCustodyTransition('with_vendor', 'shipped')).toThrow(CustodyTransitionError);
    for (const e of ['moved', 'handed_off', 'shipped', 'received', 'returned'] as const) {
      expect(() => assertCustodyTransition('closed', e)).toThrow(/already closed/);
    }
    expect(allowedCustodyEvents('closed')).toEqual([]);
  });
});

const base = { state: 'in_office', location_name: 'Main Office', bin: 'Shelf B3', next_action_party: 'vendor', follow_up_on: '2026-10-29' } as const;

describe('custody label format', () => {
  it('prints location and who acts next, date-only without time zones', () => {
    expect(formatCustodyForLabel(base)).toEqual({ custodyLocation: 'Main Office / Shelf B3', nextAction: 'Waiting on vendor, Oct 29' });
    expect(formatFollowUpDate('2026-01-01')).toBe('Jan 1');
    expect(formatFollowUpDate('garbage')).toBeNull();
  });
  it('with vendor, our turn, client, and nothing', () => {
    expect(formatCustodyForLabel({ ...base, state: 'with_vendor', location_name: null, bin: null })?.custodyLocation).toBe('With vendor');
    expect(formatCustodyForLabel({ ...base, next_action_party: 'msp' })?.nextAction).toBe('Follow up Oct 29');
    expect(formatCustodyForLabel({ ...base, next_action_party: 'client', follow_up_on: null })?.nextAction).toBe('Waiting on client');
    expect(formatCustodyForLabel({ ...base, location_name: null, bin: null, next_action_party: 'msp', follow_up_on: null })).toBeNull();
    expect(formatCustodyForLabel({ ...base, state: 'closed' })).toBeNull();
    expect(formatCustodyForLabel(null)).toBeNull();
  });
  it('never emits the free-text note even when the record carries one', () => {
    const withNote = { ...base, next_action_note: 'call Bob on 555-0100', condition_note: 'cracked' } as any;
    expect(JSON.stringify(formatCustodyForLabel(withNote))).not.toMatch(/Bob|555|cracked/);
  });
  it('several held items give a count and no next action', () => {
    const one = formatCustodyForLabel(base)!;
    expect(formatCustodyForLabelMulti([one, one, one])).toEqual({ custodyLocation: '3 items held', nextAction: null });
    expect(formatCustodyForLabelMulti([one])).toEqual(one);
    expect(formatCustodyForLabelMulti([])).toBeNull();
  });
});
