/**
 * L0b neutrality: the tenant deletion activity issues exactly the statements it did
 * before the manifest (a knex dialect listener records them). Runs only against a
 * migrated, disposable database: HOTPATH_DB=1 plus DB_HOST/DB_PORT/DB_NAME_SERVER/
 * DB_USER_ADMIN/DB_PASSWORD_ADMIN. HOTPATH_OUT=<prefix> writes the capture that
 * scripts/review/hotpath-diff.mjs compares across commits.
 */
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MockActivityEnvironment } from '@temporalio/testing';
// @ts-expect-error plain ESM helper
import { startRecording, emitStep } from '../../../../../scripts/review/hotpathRecorder.mjs';

const enabled = process.env.HOTPATH_DB === '1';

describe.skipIf(!enabled)('tenant deletion query budget', () => {
  it('deleteTenantData on a fixture tenant records a stable statement list', async () => {
    const { getAdminConnection } = await import('@alga-psa/db/admin.js');
    const { deleteTenantData } = await import('../tenant-deletion-activities');
    const admin = await getAdminConnection();
    const tenant = randomUUID();
    await admin('tenants').insert({ tenant, client_name: 'hotpath fixture', email: 'fixture@example.com' });

    const recorder = startRecording();
    const result = await new MockActivityEnvironment().run(() => deleteTenantData(tenant, randomUUID()));
    recorder.stop();

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(recorder.statements.length).toBeGreaterThan(549);
    // A1: the manifest adds no co-managed probes to the deletion path.
    expect(recorder.statements.some((s: { sql: string }) => /co_manag|product_code/.test(s.sql))).toBe(false);
    emitStep('tenant-deletion-dry-run', recorder.statements);
    await admin.destroy();
  }, 300_000);
});
