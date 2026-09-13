import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setupE2ETestEnvironment } from '../utils/e2eTestSetup';

it('cleans background job dependencies without deleting another tenant’s jobs or users', async () => {
  const observer = await setupE2ETestEnvironment();
  let target: Awaited<ReturnType<typeof setupE2ETestEnvironment>> | undefined;
  try {
    target = await setupE2ETestEnvironment();
    for (const env of [target, observer]) {
      const jobId = randomUUID();
      await env.db('jobs').insert({ tenant: env.tenant, job_id: jobId, user_id: env.userId,
        type: 'fixture-cleanup-regression', status: 'completed' });
      await env.db('job_details').insert({ tenant: env.tenant, job_id: jobId, detail_id: randomUUID(),
        step_name: 'completed', status: 'completed' });
    }
    const removedTenant = target.tenant;
    await target.cleanup();
    target = undefined;
    for (const table of ['job_details', 'jobs', 'users', 'tenants']) {
      expect(await observer.db(table).where({ tenant: removedTenant })).toEqual([]);
      expect((await observer.db(table).where({ tenant: observer.tenant })).length).toBeGreaterThan(0);
    }
  } finally {
    // Explicit fallback also allows cleanup after the before-fix reproduction.
    for (const tenant of [target?.tenant, observer.tenant].filter(Boolean)) {
      await observer.db('job_details').where({ tenant }).delete();
      await observer.db('jobs').where({ tenant }).delete();
    }
    if (target) await target.db.destroy();
    await observer.cleanup();
  }
}, 120_000);
