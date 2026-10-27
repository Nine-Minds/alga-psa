import { describe, expect, it, vi } from 'vitest';
import { matchesQueueTab } from './queries';

const tz = vi.hoisted(() => ({ value: 'UTC' }));
vi.mock('@alga-psa/db', () => ({ resolveEffectiveTimeZone: async () => tz.value }));
import { allowedCustodyEvents, assertCustodyTransition, nextCustodyState, CustodyTransitionError } from './stateMachine';
import { formatCustodyForLabel, formatCustodyForLabelMulti, formatFollowUpDate } from './labelFormat';
// Static imports (the @alga-psa/db mock above is hoisted): loading these module graphs at collection time keeps
// cold-import cost out of each test's 5s timeout, which a loaded CI runner exceeded with in-test dynamic imports.
import { resolveCustodyToday } from './today';
import { toCustodyResult } from './actionResult';
import { attributeValidationError, invalidAssetTypeError } from '../assetTypeAttributes';

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

describe('custody queue tabs', () => {
  const row = (over: Record<string, unknown>) => ({ state: 'in_office', next_action_party: null, follow_up_on: null, ...over }) as any;

  it('waiting_on_client needs the item in the office and the client as next actor', () => {
    expect(matchesQueueTab(row({ state: 'in_office', next_action_party: 'client' }), 'waiting_on_client', '2026-10-24')).toBe(true);
    expect(matchesQueueTab(row({ state: 'with_vendor', next_action_party: 'client' }), 'waiting_on_client', '2026-10-24')).toBe(false);
  });

  it('overdue compares follow_up_on to the given local date, strictly before', () => {
    expect(matchesQueueTab(row({ follow_up_on: '2026-10-23' }), 'overdue', '2026-10-24')).toBe(true);
    expect(matchesQueueTab(row({ follow_up_on: '2026-10-24' }), 'overdue', '2026-10-24')).toBe(false);
  });
});

describe('resolveCustodyToday', () => {
  // Fixed clock: 2026-10-23T23:30Z is already 2026-10-24 in Auckland but still 2026-10-23 in UTC.
  const now = new Date('2026-10-23T23:30:00Z');

  it('uses the resolved user time zone, so a UTC-today follow-up is overdue for an Auckland user', async () => {
    tz.value = 'Pacific/Auckland';
    const today = await resolveCustodyToday({} as any, 't', 'u', now);
    expect(today).toBe('2026-10-24');
    const followUp = { state: 'in_office', follow_up_on: '2026-10-23' } as any;
    expect(matchesQueueTab(followUp, 'overdue', today)).toBe(true);
    expect(matchesQueueTab(followUp, 'overdue', now.toISOString().slice(0, 10))).toBe(false);
  });

  it('a Los Angeles user is still on the previous day late in the UTC day', async () => {
    tz.value = 'America/Los_Angeles';
    expect(await resolveCustodyToday({} as any, 't', 'u', new Date('2026-10-24T03:00:00Z'))).toBe('2026-10-23');
  });
});

describe('toCustodyResult asset-layer errors', () => {
  it('turns a thrown invalidAssetTypeError into a localizable validation result', async () => {
    const result = await toCustodyResult(async () => {
      throw invalidAssetTypeError('docking station');
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('validation');
    expect(result.error.message).toBe('Asset type "docking station" is not available. Choose a valid asset type.');
    expect(result.error.message).not.toContain('{');
    expect(result.error.messageKey).toBe('msp/assets:errors.asset.typeUnavailableNamed');
    expect(result.error.messageParams).toEqual({ assetType: 'docking station' });
  });

  it('never surfaces an attributes.<key> path: generic missing-field key without a label', async () => {
    const result = await toCustodyResult(async () => {
      throw attributeValidationError([{ key: 'rack_unit', code: 'required', message: 'is required' }]);
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.messageKey).toBe('msp/assets:errors.asset.missingField');
    expect(result.error.message).not.toContain('attributes.');
  });

  it('keeps a field-named key when the issue carries the label', async () => {
    const result = await toCustodyResult(async () => {
      throw new Error(JSON.stringify({ kind: 'validation', issues: [{
        path: ['attributes', 'rack_unit'], code: 'required', message: 'Missing required asset field: Rack Unit.',
        params: { messageKey: 'msp/assets:errors.asset.missingFieldNamed', messageParams: { field: 'Rack Unit' } },
      }] }));
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.messageKey).toBe('msp/assets:errors.asset.missingFieldNamed');
    expect(result.error.messageParams).toEqual({ field: 'Rack Unit' });
    expect(result.error.message).toBe('Missing required asset field: Rack Unit.');
  });

  it('still rethrows unrelated errors', async () => {
    await expect(toCustodyResult(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});
