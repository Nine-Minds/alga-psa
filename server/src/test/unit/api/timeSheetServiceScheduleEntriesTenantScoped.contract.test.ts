import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/TimeSheetService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('time sheet service schedule entries tenant-scoped query contract', () => {
  it('uses structural tenant scoping for schedule-entry roots', () => {
    const section = sectionBetween('// Schedule entries', '// Search and statistics');

    expect(section).toContain('tenantDb(');
    expect(section).toContain('tenantDb(');
    expect(section).toContain(".table('schedule_entries')");
    expect(section).toContain(".table('schedule_entry_assignees')");
    expect(section).toContain("await tenantDb(trx, context.tenant).table('schedule_entry_assignees').insert(assigneeData)");

    expect(section).not.toMatch(/knex\('schedule_entries'\)\s*\./);
    expect(section).not.toMatch(/trx\('schedule_entries'\)\s*[\r\n]+\s*\./);
    expect(section).not.toMatch(/trx\('schedule_entry_assignees'\)\s*[\r\n]+\s*\.where/);
    expect(section).not.toMatch(/\.where\(\{\s*entry_id: id,\s*tenant: context\.tenant\s*\}\)/);
  });

  it('uses structural tenant scoping for schedule-entry hydration helpers', () => {
    const section = sectionBetween('async getScheduleEntry', 'private async getWorkItemForSchedule');

    expect(section).toContain('tenantDb(');
    expect(section).toContain(".table('schedule_entries')");
    expect(section).toContain(".table('schedule_entry_assignees')");

    expect(section).not.toMatch(/knex\('schedule_entries'\)\s*\./);
    expect(section).not.toMatch(/knex\('schedule_entry_assignees'\)\s*\./);
    expect(section).not.toMatch(/\.where\(\{\s*entry_id: id,\s*tenant: context\.tenant\s*\}\)/);
    expect(section).not.toMatch(/\.where\(\{\s*'schedule_entry_assignees\.entry_id': entryId,\s*'schedule_entry_assignees\.tenant': context\.tenant\s*\}\)/);
  });
});
