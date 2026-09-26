import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationActions = readFileSync(
  path.resolve(fileURLToPath(new URL('../../../lib/migrations/migrationActions.ts', import.meta.url))),
  'utf8',
);

describe('AMP apply dispatch', () => {
  it('schedules through the initialized edition-aware runner', () => {
    expect(migrationActions).toContain("import { getJobRunner } from '@/lib/jobs/JobRunnerFactory';");
    expect(migrationActions).toContain("import { initializeJobRunner } from '@/lib/jobs/initializeJobRunner';");
    expect(migrationActions).toContain('await initializeJobRunner();');
    expect(migrationActions).toContain("runner.scheduleJob('migration_apply'");
    expect(migrationActions).toContain('job_id: jobId');
    expect(migrationActions).not.toContain("import { JobService } from '@alga-psa/jobs';");
    expect(migrationActions).not.toContain("createAndScheduleJob('migration_apply'");
  });
});
