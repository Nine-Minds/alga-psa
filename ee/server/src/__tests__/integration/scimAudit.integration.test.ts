import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '@ee/lib/testing/db-test-utils';
import { writeScimAudit } from '@ee/lib/scim/audit';

// audit_logs carries a BEFORE INSERT trigger (set_tenant_on_audit_log_insert)
// that attributes the row to NEW.tenant, falling back to app.current_tenant and
// raising when neither is present. Ordinary request connections never set that
// GUC, so the original tenant-less insert aborted the enclosing transaction —
// which is what made every SCIM admin mutation return HTTP 500.
describe('SCIM audit writes', () => {
  let db: Knex;

  beforeAll(() => {
    db = createTestDbConnection();
  });

  afterAll(async () => {
    await db.destroy();
  });

  async function anyTenant(trx: Knex.Transaction): Promise<string> {
    const row = await tenantDb(trx, '__scim_audit_discovery__')
      .unscoped('tenants as t', 'SCIM audit test needs any tenant to attribute the audit row to')
      .select('t.tenant')
      .first();
    expect(row?.tenant).toBeTruthy();
    return row.tenant as string;
  }

  it('records the audit row and leaves the transaction usable', async () => {
    const trx = await db.transaction();
    try {
      const tenant = await anyTenant(trx);
      const recordId = randomUUID();
      const userId = randomUUID();

      await writeScimAudit(trx, tenant, userId, 'scim_connection_created', recordId, {
        enabled: true,
        tokenGeneration: 1,
      });

      const row = await tenantDb(trx, tenant).table('audit_logs')
        .where({ record_id: recordId })
        .first('tenant', 'operation', 'table_name', 'user_id');
      expect(row).toMatchObject({
        tenant,
        operation: 'scim_connection_created',
        table_name: 'scim_connections',
        user_id: userId,
      });

      // The enclosing transaction is still healthy, so the connection insert
      // that precedes this audit write in createScimConnection can commit.
      expect(await tenantDb(trx, tenant).table('tenants').where({ tenant }).first('tenant'))
        .toMatchObject({ tenant });
    } finally {
      await trx.rollback();
    }
  });

  it('leaves the GUC unset outside the transaction that set it', async () => {
    const trx = await db.transaction();
    try {
      const tenant = await anyTenant(trx);
      await writeScimAudit(trx, tenant, randomUUID(), 'scim_enabled', randomUUID(), {});
    } finally {
      await trx.rollback();
    }

    // set_config(..., is_local = true) must not survive onto the pooled
    // connection, or one tenant's GUC would leak into the next request.
    const leaked = await db.raw("select current_setting('app.current_tenant', true) as tenant");
    expect(leaked.rows?.[0]?.tenant ?? null).toBeFalsy();
  });

  // The control: an insert that names neither an owner nor a tenant context,
  // as the SCIM admin actions used to do it. The trigger still fails closed and
  // still takes the enclosing transaction with it, which is what turned every
  // SCIM admin mutation into an HTTP 500.
  //
  // This needs its own pool: once set_config has named a custom GUC on a
  // connection the parameter stays defined for that session and reverts to ''
  // at transaction end rather than becoming absent, so the tests above would
  // otherwise leave a tenant context behind on the connection under test.
  it('still fails with neither an explicit tenant nor tenant context', async () => {
    const pristine = createTestDbConnection();
    const trx = await pristine.transaction();
    try {
      // Proves the transaction is healthy before the control insert.
      await anyTenant(trx);

      await expect(
        tenantDb(trx, '__scim_audit_control__')
          .unscoped('audit_logs', 'the control deliberately writes no tenant at all')
          .insert({
            audit_id: randomUUID(),
            user_id: randomUUID(),
            operation: 'scim_connection_created',
            table_name: 'scim_connections',
            record_id: randomUUID(),
            changed_data: JSON.stringify({}),
            details: JSON.stringify({}),
            timestamp: trx.fn.now(),
          })
      ).rejects.toThrow(/require an explicit tenant or current tenant context/);

      // …and it took the enclosing transaction with it, exactly as before.
      await expect(trx.raw('select 1')).rejects.toThrow();
    } finally {
      await trx.rollback();
      await pristine.destroy();
    }
  });
});
