import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('shared calendars tenant deletion ordering', () => {
  const source = readRepoFile('ee/temporal-workflows/src/activities/tenant-deletion-activities.ts');
  const indexOf = (table: string) => source.indexOf(`'${table}'`);

  it('deletes calendar_shares and calendars after their dependents and before users', () => {
    const shares = indexOf('calendar_shares');
    const calendars = indexOf('calendars');
    const scheduleEntries = indexOf('schedule_entries');
    const users = indexOf('users');

    expect(shares).toBeGreaterThan(-1);
    expect(calendars).toBeGreaterThan(-1);

    // schedule_entries.calendar_id and calendar_shares.calendar_id reference calendars.
    expect(scheduleEntries).toBeLessThan(calendars);
    expect(shares).toBeLessThan(calendars);
    // calendars.owner_user_id references users.
    expect(calendars).toBeLessThan(users);
  });
});
