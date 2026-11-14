import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setupE2ETestEnvironment } from '../utils/e2eTestSetup';
import { ensureDefaultBillingProfile } from '../../../../test-utils/billingProfileTestHelpers';

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

it('cleans stopwatch sessions and suggestion dismissals before deleting the fixture users', async () => {
  const target = await setupE2ETestEnvironment();
  const { db, tenant, userId } = target;
  let cleanupAttempted = false;
  try {
    const sessionId = randomUUID();
    await db('time_tracking_sessions').insert({ tenant, session_id: sessionId, user_id: userId,
      work_item_type: 'ad_hoc', status: 'running' });
    await db('time_tracking_session_segments').insert({ tenant, session_id: sessionId,
      started_at: new Date().toISOString() });
    await db('time_entry_suggestion_dismissals').insert({ tenant, user_id: userId,
      work_item_type: 'ticket', work_item_id: randomUUID(), work_date: '2026-10-10' });

    // Before the fix this threw: users still referenced by time_tracking_sessions.
    cleanupAttempted = true;
    await target.cleanup();

    const observer = await setupE2ETestEnvironment();
    try {
      for (const table of ['time_tracking_session_segments', 'time_tracking_sessions',
        'time_entry_suggestion_dismissals', 'users', 'tenants']) {
        expect(await observer.db(table).where({ tenant })).toEqual([]);
      }
    } finally {
      await observer.cleanup();
    }
  } finally {
    // cleanup() closes its connection either way; only fall back if it never ran.
    if (!cleanupAttempted) await target.cleanup();
  }
}, 120_000);

it('cleans billing cycles before deleting their client billing profiles', async () => {
  const observer = await setupE2ETestEnvironment();
  let target: Awaited<ReturnType<typeof setupE2ETestEnvironment>> | undefined;
  let billingCycleId: string | undefined;
  try {
    target = await setupE2ETestEnvironment();
    const billingProfileId = await ensureDefaultBillingProfile(
      { db: target.db, tenantId: target.tenant },
      target.clientId,
    );
    billingCycleId = randomUUID();
    await target.db('client_billing_cycles').insert({
      tenant: target.tenant,
      billing_cycle_id: billingCycleId,
      billing_profile_id: billingProfileId,
      client_id: target.clientId,
      billing_cycle: 'monthly',
      effective_date: '2026-11-01',
      period_start_date: '2026-11-01',
      period_end_date: '2026-12-01',
      is_active: true,
    });

    const removedTenant = target.tenant;
    await target.cleanup();
    target = undefined;

    expect(await observer.db('client_billing_cycles').where({
      tenant: removedTenant,
      billing_cycle_id: billingCycleId,
    })).toEqual([]);
    expect(await observer.db('client_billing_profiles').where({ tenant: removedTenant })).toEqual([]);
    expect(await observer.db('client_billing_cycles').where({ tenant: observer.tenant })).toEqual([]);
  } finally {
    // cleanup() closes the target connection even when the pre-fix FK blocks it.
    if (target) {
      if (billingCycleId) {
        await observer.db('client_billing_cycles').where({
          tenant: target.tenant,
          billing_cycle_id: billingCycleId,
        }).delete();
      }
      await target.cleanup();
    }
    await observer.cleanup();
  }
}, 120_000);
