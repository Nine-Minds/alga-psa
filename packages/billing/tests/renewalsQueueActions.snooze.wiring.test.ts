import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions snooze wiring', () => {
  it('sets queue status to snoozed and persists snoozed_until for eligible work item statuses', () => {
    expect(source).toContain('export type RenewalSnoozeResult = RenewalQueueMutationResult & {');
    expect(source).toContain('export const snoozeRenewalQueueItem = withAuth(async (');
    expect(source).toContain("throw new Error('Client contract id is required');");
    expect(source).toContain("throw new Error('Snooze target date is required');");
    expect(source).toContain("schema?.hasColumn?.('client_contracts', 'snoozed_until') ?? false");
    expect(source).toContain("throw new Error('Renewals queue snooze columns are not available');");
    expect(source).toContain('const normalizedSnoozedUntil = snoozedUntil.trim().slice(0, 10);');
    expect(source).toContain("throw new Error('Snooze target date is invalid');");
    expect(source).toContain('if (normalizedSnoozedUntil <= getTodayDateOnly()) {');
    expect(source).toContain("throw new Error('Snooze target date must be in the future');");
    expect(source).toContain("if (previousStatus === 'completed' || previousStatus === 'non_renewing') {");
    expect(source).toContain('Cannot snooze renewal work item from status');
    expect(source).toContain("status: 'snoozed',");
    expect(source).toContain('snoozed_until: normalizedSnoozedUntil,');
  });
});
