/**
 * L0b neutrality: hot paths touched by the substrate registries issue exactly the
 * statements they did before. A knex dialect recorder captures every statement;
 * HOTPATH_OUT=<prefix> writes the capture compared by scripts/review/hotpath-diff.mjs
 * between the base commit and HEAD. Needs a migrated disposable database
 * (HOTPATH_DB=1, DB_HOST/DB_PORT/DB_NAME_SERVER/DB_USER_ADMIN/DB_PASSWORD_ADMIN).
 *
 * Scenarios that need the running app (withAuth bootstrap, ticket open/update,
 * comment add/edit through the action layer) are not driven here: they require a
 * session, Redis event bus and a seeded tenant. Their code is untouched by L0b except
 * through withTransaction/afterCommit, which the `with-transaction-after-commit`
 * scenario records directly.
 */
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
// @ts-expect-error plain ESM helper
import { startRecording, emitStep } from '../../../../scripts/review/hotpathRecorder.mjs';

const enabled = process.env.HOTPATH_DB === '1';

describe.skipIf(!enabled)('hot path query budget', () => {
  it('with-transaction-after-commit', async () => {
    const { getAdminConnection } = await import('@alga-psa/db/admin');
    const { withTransaction, registerAfterCommit } = await import('@alga-psa/db');
    const admin = await getAdminConnection();
    const recorder = startRecording();
    let ran = 0;
    await withTransaction(admin, async (trx) => {
      registerAfterCommit(trx, () => { ran += 1; });
      await trx('tenants').select('tenant').limit(1);
      await withTransaction(trx, async (child) => {
        registerAfterCommit(child, () => { ran += 1; });
        await child('tenants').select('tenant').limit(1);
      });
    });
    recorder.stop();
    expect(ran).toBe(2);
    emitStep('with-transaction-after-commit', recorder.statements);
  });

  it('expired-credits-fanout-tick', async () => {
    const { getAdminConnection } = await import('@alga-psa/db/admin');
    const { runMaintenanceJob } = await import('@alga-psa/jobs/lib/maintenanceJobFanout');
    const admin = await getAdminConnection();
    const tenant = randomUUID();
    await admin('tenants').insert({ tenant, client_name: 'hotpath fixture', email: 'fixture@example.com' });
    const recorder = startRecording();
    const result = await runMaintenanceJob('expired-credits', { concurrency: 1 });
    recorder.stop();
    await admin('tenants').where({ tenant }).delete();
     expect(result).toMatchObject({ scope: 'tenant', failed: 0 });
    // A1: the registry fallback adds no probes to the native fan-out.
    expect(recorder.statements.some((s: { sql: string }) => /co_manag/.test(s.sql))).toBe(false);
    emitStep('expired-credits-fanout-tick', recorder.statements);
  }, 120_000);
});
