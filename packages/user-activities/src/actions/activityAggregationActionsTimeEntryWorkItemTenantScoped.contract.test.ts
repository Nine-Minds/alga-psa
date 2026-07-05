import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'activityAggregationActions.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('activity aggregation time-entry work-item tenant-scoped query contract', () => {
  it('uses structural tenant scoping for time-entry work-item client filter subqueries', () => {
    const section = sectionBetween('export async function fetchTimeEntryActivities', 'export async function fetchNotificationActivities');

    expect(section).toContain(".table(\"tickets");
    expect(section).toContain(".table(\"project_tasks");
    expect(section).toContain('.whereRaw("tickets.ticket_id = time_entries.work_item_id")');
    expect(section).toContain('.whereRaw("project_tasks.task_id = time_entries.work_item_id")');

    expect(section).not.toContain('.from("tickets")');
    expect(section).not.toContain('.from("project_tasks")');
    expect(section).not.toContain('.andWhere("tickets.tenant", tenant)');
    expect(section).not.toContain('.andWhere("project_tasks.tenant", tenant)');
  });
});
