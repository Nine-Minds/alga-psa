import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.resolve(__dirname, '../scheduleEntry.ts'), 'utf8');

function sectionBetween(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = startIndex === -1 ? -1 : source.indexOf(end, startIndex + start.length);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error(`Unable to locate schedule entry section: ${start} -> ${end}`);
  }
  return source.slice(startIndex, endIndex);
}

const helperAndRecurrenceSection = sectionBetween(
  'getAssignedUserIds: async',
  'getRecurringEntriesWithAssignments: async'
);
const basicRetrievalSection = sectionBetween(
  'getAll: async',
  'create: async'
);

describe('schedule entry model tenant-scoped query contract', () => {
  it('uses the structural tenant-scoped query helper for schedule entry roots', () => {
    expect(source).toContain("import { createTenantScopedQuery } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable(');
    expect(source).toContain('createTenantScopedQuery(knexOrTrx, { table, tenant }).builder');
  });

  it('uses structural tenant scoping for assignment and recurrence helper roots', () => {
    expect(helperAndRecurrenceSection).toContain("tenantScopedTable(knexOrTrx, 'schedule_entries', tenant)");
    expect(helperAndRecurrenceSection).toContain("tenantScopedTable(knexOrTrx, 'schedule_entry_assignees', tenant)");
    expect(helperAndRecurrenceSection).toContain("tenantScopedTable(knexOrTrx, 'users', tenant)");
    expect(helperAndRecurrenceSection).toContain("tenantScopedTable(knexOrTrx, 'holidays', tenant)");
    expect(helperAndRecurrenceSection).not.toContain(".where('schedule_entries.tenant', tenant)");
    expect(helperAndRecurrenceSection).not.toContain(".where('schedule_entry_assignees.tenant', tenant)");
    expect(helperAndRecurrenceSection).not.toContain(".where('users.tenant', tenant)");
    expect(helperAndRecurrenceSection).not.toContain(".where('tenant', tenant)");
  });

  it('uses structural tenant scoping for basic schedule entry retrieval roots', () => {
    expect(basicRetrievalSection).toContain("tenantScopedTable(knexOrTrx, 'schedule_entries', tenant)");
    expect(basicRetrievalSection).not.toContain(".where('schedule_entries.tenant', tenant)");
  });
});
