import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '@main-test-utils/dbConfig';

const tenantId = 'dd8cb218-d46d-47f3-be27-8aa50aad5fce';
const billingProfileId = 'd5fbf9da-552f-4164-8796-70fa93e46ba0';
const attemptId = 'c3beca66-599a-4b71-814c-3bf174622bd5';
let db: Knex;

const contextQuery = (trx: Knex.Transaction) => trx('invoice_autopay_attempts as aa')
  .join('payment_methods as pm', function () { this.on('pm.payment_method_id', '=', 'aa.payment_method_id').andOn('pm.tenant', '=', 'aa.tenant'); })
  .join('billing_profile_autopay as bpa', function () { this.on('bpa.tenant', '=', 'aa.tenant').andOn('bpa.billing_profile_id', '=', 'aa.billing_profile_id'); })
  .where('bpa.is_enabled', true).whereRaw('bpa.payment_method_id = aa.payment_method_id')
  .where('pm.status', 'active').where('pm.is_deleted', false).where('aa.attempt_id', attemptId)
  .where(function () { this.where('aa.status', 'processing').orWhere(function () { this.where('aa.status', 'scheduled').whereRaw('aa.scheduled_for >= now()'); }); });

describe('invoice auto-pay context enrollment and card filters (DB integration)', () => {
  beforeAll(async () => {
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
  });

  afterAll(async () => { await db?.destroy().catch(() => undefined); });

  it('returns only enabled enrollments with their active, non-deleted matching method', async () => {
    await db.transaction(async (trx) => {
      await trx('invoice_autopay_attempts').where({ tenant: tenantId, attempt_id: attemptId }).update({ status: 'scheduled', scheduled_for: trx.raw("now() + interval '1 day'") });
      await trx('billing_profile_autopay').where({ tenant: tenantId, billing_profile_id: billingProfileId }).update({ is_enabled: true, payment_method_id: '47c4262c-c171-4954-bd6a-635716e4063c' });
      await trx('payment_methods').where({ tenant: tenantId, payment_method_id: '47c4262c-c171-4954-bd6a-635716e4063c' }).update({ status: 'active', is_deleted: false });
      expect(await contextQuery(trx)).toHaveLength(1);

      await trx('billing_profile_autopay').where({ tenant: tenantId, billing_profile_id: billingProfileId }).update({ is_enabled: false });
      expect(await contextQuery(trx)).toHaveLength(0);
      await trx('billing_profile_autopay').where({ tenant: tenantId, billing_profile_id: billingProfileId }).update({ is_enabled: true, payment_method_id: '1cb1d41c-d315-467c-a296-4a2dee6b315c' });
      expect(await contextQuery(trx)).toHaveLength(0);
      await trx('billing_profile_autopay').where({ tenant: tenantId, billing_profile_id: billingProfileId }).update({ payment_method_id: '47c4262c-c171-4954-bd6a-635716e4063c' });
      await trx('payment_methods').where({ tenant: tenantId, payment_method_id: '47c4262c-c171-4954-bd6a-635716e4063c' }).update({ is_deleted: true });
      expect(await contextQuery(trx)).toHaveLength(0);
      await trx('payment_methods').where({ tenant: tenantId, payment_method_id: '47c4262c-c171-4954-bd6a-635716e4063c' }).update({ is_deleted: false, status: 'detached' });
      expect(await contextQuery(trx)).toHaveLength(0);
      throw new Error('ROLLBACK_AUTOPAY_CONTEXT_FIXTURE');
    }).catch((error) => {
      if (!(error instanceof Error) || error.message !== 'ROLLBACK_AUTOPAY_CONTEXT_FIXTURE') throw error;
    });
  });
});
