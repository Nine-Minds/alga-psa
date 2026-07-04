import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'activityAggregationActions.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionFrom(startMarker: string): string {
  const start = source.indexOf(startMarker);

  expect(start).toBeGreaterThanOrEqual(0);

  return source.slice(start);
}

describe('activity aggregation notification root tenant-scoped query contract', () => {
  it('uses structural tenant scoping for the notification activity root', () => {
    const section = sectionFrom('export async function fetchNotificationActivities');

    expect(section).toContain(".table(\"internal_notifications");
    expect(section).toContain('.where("internal_notifications.user_id", userId)');

    expect(section).not.toContain('return await trx("internal_notifications")');
    expect(section).not.toContain('.where("internal_notifications.tenant", tenant)');
  });
});
