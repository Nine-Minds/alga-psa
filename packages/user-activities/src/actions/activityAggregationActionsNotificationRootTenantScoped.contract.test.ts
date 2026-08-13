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

describe('activity aggregation notification root tenant-scoped query contract', () => {
  it('uses structural tenant scoping for the notification activity root', () => {
    const section = sectionBetween(
      'function buildNotificationActivitiesQuery',
      '/** Fetch notification activities for a user. */'
    );

    expect(section).toContain("tenantDb(trx, tenant).table('internal_notifications')");
    expect(section).toContain(".where('internal_notifications.user_id', userId)");

    expect(section).not.toContain('return await trx("internal_notifications")');
    expect(section).not.toContain('.where("internal_notifications.tenant", tenant)');
  });
});
