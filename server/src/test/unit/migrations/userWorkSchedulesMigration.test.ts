import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('user work schedules migration', () => {
  const migration = readRepoFile('server/migrations/20260727120000_create_user_work_schedules.cjs');

  it('keys one row per user per weekday with tenant first', () => {
    expect(migration).toContain("createTable('user_work_schedules'");
    expect(migration).toContain("table.primary(['tenant', 'user_id', 'day_of_week'])");
    expect(migration).toContain("table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users').onDelete('CASCADE')");
  });

  it('rejects impossible weekdays and windows in the database', () => {
    expect(migration).toContain('chk_user_work_schedules_day_of_week');
    expect(migration).toContain('CHECK (day_of_week BETWEEN 0 AND 6)');
    expect(migration).toContain('chk_user_work_schedules_window');
    expect(migration).toContain('CHECK (end_time > start_time)');
  });

  it('distributes on tenant, colocating with users when they are distributed', () => {
    expect(migration).toContain("create_distributed_table('user_work_schedules', 'tenant', colocate_with => 'users')");
    expect(migration).toContain("create_distributed_table('user_work_schedules', 'tenant')");
    expect(migration).toContain('exports.config = { transaction: false }');
  });

  it('is safe to retry after a partial run', () => {
    expect(migration).toContain("hasTable('user_work_schedules')");
    expect(migration).toContain('FROM pg_dist_partition');
    expect(migration).toContain("dropTableIfExists('user_work_schedules')");
  });
});
