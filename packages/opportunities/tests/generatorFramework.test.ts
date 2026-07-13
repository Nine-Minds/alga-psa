import { describe, expect, it } from 'vitest';
import { classifyExistingSuggestion } from '../src/lib/generators/runGenerators';

describe('opportunity suggestion dedupe decisions', () => {
  const now = new Date('2026-07-12T12:00:00.000Z');

  it('refreshes pending facts and reopens only expired snoozes', () => {
    expect(classifyExistingSuggestion({ status: 'pending', snoozed_until: null }, now))
      .toBe('refresh');
    expect(classifyExistingSuggestion({
      status: 'snoozed',
      snoozed_until: '2026-07-12T11:59:59.000Z',
    }, now)).toBe('reopen');
    expect(classifyExistingSuggestion({
      status: 'snoozed',
      snoozed_until: '2026-07-13T00:00:00.000Z',
    }, now)).toBe('dedupe');
  });

  it('keeps accepted and dismissed dedupe keys terminal', () => {
    expect(classifyExistingSuggestion({ status: 'accepted', snoozed_until: null }, now))
      .toBe('dedupe');
    expect(classifyExistingSuggestion({ status: 'dismissed', snoozed_until: null }, now))
      .toBe('dedupe');
  });
});
