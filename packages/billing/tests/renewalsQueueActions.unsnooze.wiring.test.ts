import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions unsnooze wiring', () => {
  it('automatically transitions elapsed snoozed work items back to pending during queue refresh', () => {
    expect(source).toContain('const getTodayDateOnly = (): string => new Date().toISOString().slice(0, 10);');
    expect(source).toContain("await knex('client_contracts')");
    expect(source).toContain(".whereNotNull('snoozed_until')");
    expect(source).toContain("status: 'snoozed',");
    expect(source).toContain(".andWhereNot('status', 'completed')");
    expect(source).toContain(".andWhere('snoozed_until', '<=', getTodayDateOnly())");
    expect(source).toContain("status: 'pending',");
    expect(source).toContain('snoozed_until: null,');
  });
});
