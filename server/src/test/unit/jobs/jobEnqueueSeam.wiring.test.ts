import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * enqueueImmediateJob is the seam feature packages use to schedule work without
 * importing @alga-psa/jobs. Two ways it silently stops working:
 *
 * 1. The registered enqueuer lands on the legacy pg-boss JobScheduler. On EE the
 *    runner is Temporal and nothing ever calls boss.work(), so the job row is
 *    created, the pg-boss row stays `created` forever, and the user watches a
 *    spinner that never settles.
 * 2. A caller adds a job name the Temporal worker does not know about. The
 *    workflow starts and fails with "No handler registered for job type".
 *
 * Both are EE-only and invisible to typecheck, so assert them on the sources.
 */

// Tests run with cwd=server; the wired sources span server/, packages/, and ee/.
const repoRoot = path.resolve(process.cwd(), '..');
const read = (relativePath: string): string =>
  readFileSync(path.resolve(repoRoot, relativePath), 'utf8');

const initializeAppSource = read('server/src/lib/initializeApp.ts');
const jobActivitiesSource = read('ee/temporal-workflows/src/activities/job-activities.ts');

function enqueuerBody(source: string): string {
  const start = source.indexOf('registerJobEnqueuer(');
  expect(start, 'registerJobEnqueuer is missing from initializeApp').toBeGreaterThan(-1);
  const end = source.indexOf('});', start);
  expect(end, 'could not find the end of the enqueuer').toBeGreaterThan(start);
  return source.slice(start, end);
}

/** Job names passed to enqueueImmediateJob, resolving same-file const literals. */
function enqueuedJobNames(): string[] {
  const names: string[] = [];
  const stack = [path.join(repoRoot, 'packages')];

  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', '.next', 'tests'].includes(entry.name)) stack.push(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        const text = readFileSync(full, 'utf8');
        if (!text.includes('enqueueImmediateJob(')) continue;

        const literals = new Map<string, string>();
        for (const m of text.matchAll(/const\s+([A-Z0-9_]+)\s*=\s*'([^']+)'/g)) {
          literals.set(m[1], m[2]);
        }
        for (const m of text.matchAll(/enqueueImmediateJob\(\s*'([^']+)'/g)) names.push(m[1]);
        for (const m of text.matchAll(/enqueueImmediateJob\(\s*([A-Z0-9_]+)\s*,/g)) {
          const value = literals.get(m[1]);
          if (value) names.push(value);
        }
      }
    }
  }
  return [...new Set(names)];
}

/** Job names the Temporal worker can execute, run in-worker or forwarded. */
function workerHandledJobNames(source: string): string[] {
  const literals = new Map<string, string>();
  for (const m of source.matchAll(/const\s+([A-Z0-9_]+)\s*=\s*'([^']+)'/g)) {
    literals.set(m[1], m[2]);
  }
  // Job names imported from @alga-psa/jobs and @alga-psa/workflows: resolve the
  // identifiers back to their exported literals.
  const stack = [
    path.join(repoRoot, 'packages/jobs/src'),
    path.join(repoRoot, 'ee/packages/workflows/src'),
  ];
  while (stack.length) {
    const dir = stack.pop()!;
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist'].includes(entry.name)) stack.push(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        for (const c of readFileSync(full, 'utf8').matchAll(
          /export\s+const\s+([A-Z0-9_]+)\s*=\s*'([^']+)'/g,
        )) {
          literals.set(c[1], c[2]);
        }
      }
    }
  }

  const handled: string[] = [];
  for (const m of source.matchAll(/registerJobHandlerForActivities\(\s*'([^']+)'/g)) {
    handled.push(m[1]);
  }
  for (const m of source.matchAll(/registerJobHandlerForActivities\(\s*([A-Za-z0-9_]+)\s*,/g)) {
    const value = literals.get(m[1]);
    if (value) handled.push(value);
  }
  return [...new Set(handled)];
}

describe('enqueueImmediateJob seam wiring', () => {
  it('enqueues through the job runner, not the pg-boss-only scheduler', () => {
    const body = enqueuerBody(initializeAppSource);
    expect(body).toContain('await initializeJobRunner()');
    expect(body).toContain('runner.scheduleJob(');
    // JobService.createAndScheduleJob always sends via pg-boss, which has no
    // consumer on EE.
    expect(body).not.toContain('createAndScheduleJob');
  });

  it('every enqueued job name has a Temporal worker registration', () => {
    const enqueued = enqueuedJobNames();
    const handled = workerHandledJobNames(jobActivitiesSource);

    // Guards the scanners themselves against silently matching nothing.
    expect(enqueued).toContain('kb-article-import');
    expect(handled.length).toBeGreaterThan(5);

    const missing = enqueued.filter((name) => !handled.includes(name));
    expect(
      missing,
      missing.length === 0
        ? ''
        : `${missing.join(', ')} — enqueued via enqueueImmediateJob but not registered in ` +
          'ee/temporal-workflows/src/activities/job-activities.ts. On EE the workflow starts ' +
          'and fails with "No handler registered for job type".',
    ).toEqual([]);
  });
});
