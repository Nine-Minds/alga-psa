import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const migration = require('../../../migrations/20260809120000_type_template_status_mappings.cjs') as {
  up: (knex: Knex | Knex.Transaction) => Promise<void>;
  down: (knex: Knex | Knex.Transaction) => Promise<void>;
};

async function createFixtureTenant(knex: Knex | Knex.Transaction): Promise<string> {
  const tenantId = uuidv4();
  const userId = uuidv4();

  await knex('tenants').insert({
    tenant: tenantId,
    client_name: `Template status migration tenant ${tenantId.slice(0, 8)}`,
    email: `tpl-status-${tenantId.slice(0, 8)}@example.com`,
    billing_source: 'internal',
  });

  await knex('users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `tpl-status-user-${tenantId.slice(0, 8)}`,
    email: `tpl-status-user-${tenantId.slice(0, 8)}@example.com`,
    hashed_password: 'not-used',
    user_type: 'internal',
  });

  return tenantId;
}

async function createTemplate(
  knex: Knex | Knex.Transaction,
  tenantId: string,
  templateId: string
): Promise<void> {
  await knex('project_templates').insert({
    tenant: tenantId,
    template_id: templateId,
    template_name: `Template ${templateId.slice(0, 8)}`,
    use_count: 0,
  });
}

async function createTenantStatus(
  knex: Knex | Knex.Transaction,
  tenantId: string,
  statusId: string,
  orderNumber: number
): Promise<void> {
  await knex('statuses').insert({
    tenant: tenantId,
    status_id: statusId,
    name: `Tenant status ${statusId.slice(0, 8)}`,
    status_type: 'project_task',
    item_type: 'project_task',
    is_closed: false,
    order_number: orderNumber,
  });
}

describe('project_template_status_mappings typed migration (integration)', () => {
  let knex: Knex;

  beforeAll(async () => {
    knex = await createTestDbConnection({ runSeeds: true });
  });

  afterAll(async () => {
    await knex?.destroy();
  }, 120_000);

  it('deterministically backfills legacy rows and quarantines ambiguous/missing UUIDs, then reruns idempotently', async () => {
    const trx = await knex.transaction();
    let testError: unknown;

    try {
      await migration.down(trx);

      const tenantId = await createFixtureTenant(trx);
      const templateId = uuidv4();
      await createTemplate(trx, tenantId, templateId);

      const tenantStatusId = uuidv4();
      await createTenantStatus(trx, tenantId, tenantStatusId, 1);

      const standardStatuses = await trx('standard_statuses')
        .where({ item_type: 'project_task' })
        .orderBy('standard_status_id')
        .limit(2)
        .select('standard_status_id');
      const standardStatus = standardStatuses[0];
      const ambiguousId = standardStatuses[1].standard_status_id;
      expect(standardStatus).toBeTruthy();
      await createTenantStatus(trx, tenantId, ambiguousId, 2);

      const missingId = uuidv4();

      const fixtureRows = [
        {
          tenant: tenantId,
          template_id: templateId,
          template_status_mapping_id: uuidv4(),
          status_id: tenantStatusId,
          custom_status_name: null,
          display_order: 0,
        },
        {
          tenant: tenantId,
          template_id: templateId,
          template_status_mapping_id: uuidv4(),
          status_id: standardStatus.standard_status_id,
          custom_status_name: null,
          display_order: 1,
        },
        {
          tenant: tenantId,
          template_id: templateId,
          template_status_mapping_id: uuidv4(),
          status_id: null,
          custom_status_name: 'Inline custom',
          custom_status_color: '#FF5733',
          display_order: 2,
        },
        {
          tenant: tenantId,
          template_id: templateId,
          template_status_mapping_id: uuidv4(),
          status_id: missingId,
          custom_status_name: null,
          display_order: 3,
        },
        {
          tenant: tenantId,
          template_id: templateId,
          template_status_mapping_id: uuidv4(),
          status_id: ambiguousId,
          custom_status_name: null,
          display_order: 4,
        },
      ];
      await trx('project_template_status_mappings').insert(fixtureRows);

      await migration.up(trx);
      await migration.up(trx);

      const migrated = await trx('project_template_status_mappings')
        .where({ tenant: tenantId })
        .orderBy('display_order')
        .select('*');

      expect(migrated).toHaveLength(5);

      const byId = new Map(migrated.map((row) => [row.status_id ?? row.standard_status_id ?? row.unresolved_status_id ?? row.custom_status_name, row]));
      const tenantRow = migrated.find((row) => row.status_source === 'tenant');
      const standardRow = migrated.find((row) => row.status_source === 'standard');
      const inlineRow = migrated.find((row) => row.status_source === 'inline');
      const missingRow = migrated.find((row) => row.unresolved_reason === 'missing');
      const ambiguousRow = migrated.find((row) => row.unresolved_reason === 'ambiguous');

      expect(tenantRow).toMatchObject({
        status_id: tenantStatusId,
        standard_status_id: null,
        unresolved_status_id: null,
        status_source: 'tenant',
      });

      expect(standardRow).toMatchObject({
        status_id: null,
        standard_status_id: standardStatus.standard_status_id,
        unresolved_status_id: null,
        status_source: 'standard',
      });

      expect(inlineRow).toMatchObject({
        status_id: null,
        standard_status_id: null,
        unresolved_status_id: null,
        custom_status_name: 'Inline custom',
        status_source: 'inline',
      });

      expect(missingRow).toMatchObject({
        status_id: null,
        standard_status_id: null,
        unresolved_status_id: missingId,
        unresolved_reason: 'missing',
        status_source: 'unresolved',
      });

      expect(ambiguousRow).toMatchObject({
        status_id: null,
        standard_status_id: null,
        unresolved_status_id: ambiguousId,
        unresolved_reason: 'ambiguous',
        status_source: 'unresolved',
      });

      const sourceNullable = await trx('information_schema.columns')
        .where({
          table_schema: 'public',
          table_name: 'project_template_status_mappings',
          column_name: 'status_source',
        })
        .select('is_nullable')
        .first();
      expect(sourceNullable?.is_nullable).toBe('NO');

      void byId;
    } catch (error) {
      testError = error;
    } finally {
      await trx.rollback();
    }

    if (testError) {
      throw testError;
    }
  });

  it('rejects contradictory typed shapes via the variant CHECK constraint', async () => {
    const trx = await knex.transaction();
    let testError: unknown;

    try {
      const tenantId = await createFixtureTenant(trx);
      const templateId = uuidv4();
      await createTemplate(trx, tenantId, templateId);

      let rejected = false;
      try {
        await trx('project_template_status_mappings').insert({
          tenant: tenantId,
          template_id: templateId,
          template_status_mapping_id: uuidv4(),
          status_id: null,
          standard_status_id: null,
          unresolved_status_id: null,
          status_source: 'tenant',
          display_order: 0,
        });
      } catch (error) {
        expect(error).toMatchObject({ code: '23514' });
        rejected = true;
      }
      expect(rejected).toBe(true);
    } catch (error) {
      testError = error;
    } finally {
      await trx.rollback();
    }

    if (testError) {
      throw testError;
    }
  });
});
