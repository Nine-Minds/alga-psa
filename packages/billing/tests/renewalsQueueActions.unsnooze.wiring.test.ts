import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions unsnooze wiring', () => {
  it('automatically transitions elapsed snoozed work items back to pending during queue refresh', () => {
    expect(source).toContain('const getTodayDateOnly = (): string => new Date().toISOString().slice(0, 10);');
    expect(source).toContain("schema?.hasColumn?.('client_contracts', 'status') ?? false");
    expect(source).toContain("schema?.hasColumn?.('client_contracts', 'snoozed_until') ?? false");
    expect(source).toContain('if (hasStatusColumn && hasSnoozedUntilColumn) {');
    expect(source).toContain("status: 'snoozed',");
    expect(source).toContain(".andWhere('snoozed_until', '<=', getTodayDateOnly())");
    expect(source).toContain("status: 'pending',");
    expect(source).toContain('snoozed_until: null,');
  });
});
