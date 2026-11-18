import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

const ORDER_NUMBER_UNIQUE_CONSTRAINT = 'service_types_tenant_order_number_unique';
const MAX_ORDER_ALLOCATION_ATTEMPTS = 10;

export interface TestServiceTypeInput {
  id?: string;
  name?: string;
}

/**
 * Insert a tenant service type the way the product does: `order_number` is the
 * tenant's next free position, never a guess. `service_types` is unique on
 * `(tenant, order_number)` and integration files share a seeded tenant while
 * running concurrently, so another writer can take the same position between
 * the read and the insert — retry with a fresh allocation when that happens.
 */
// LEVERAGE: pattern random-test-order-number — other integration fixtures still insert service_types/statuses with Math.random() order numbers (server/src/test/integration/contractWizard, appointmentRequests, multiCurrencyGaps, createContractFromTemplate); route them through an allocator like this one.
export async function insertTestServiceType(
  db: Knex,
  tenant: string,
  input: TestServiceTypeInput = {},
): Promise<{ serviceTypeId: string; orderNumber: number }> {
  const serviceTypeId = input.id ?? uuidv4();
  const scoped = tenantDb(db, tenant);

  for (let attempt = 1; ; attempt += 1) {
    const maxRow = await scoped.table('service_types').max({ max_order: 'order_number' }).first();
    const orderNumber = Number(maxRow?.max_order ?? 0) + 1;
    try {
      await scoped.table('service_types').insert({
        id: serviceTypeId,
        tenant,
        name: input.name ?? `Test Service Type ${serviceTypeId.slice(0, 8)}`,
        order_number: orderNumber,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
      return { serviceTypeId, orderNumber };
    } catch (error) {
      const lostRace =
        (error as { code?: string; constraint?: string })?.code === '23505' &&
        (error as { constraint?: string })?.constraint === ORDER_NUMBER_UNIQUE_CONSTRAINT;
      if (!lostRace || attempt >= MAX_ORDER_ALLOCATION_ATTEMPTS) throw error;
    }
  }
}
