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

const TYPED_COLUMNS = [
  'standard_status_id',
  'unresolved_status_id',
  'unresolved_reason',
  'status_source',
];

const TYPED_CONSTRAINTS = [
  'project_template_status_mappings_status_source_check',
  'project_template_status_mappings_variant_shape_check',
  'project_template_status_mappings_tenant_status_id_foreign',
  'project_template_status_mappings_standard_status_id_foreign',
];

const TYPED_INDEXES = [
  'project_template_status_mappings_tenant_status_idx',
  'project_template_status_mappings_standard_status_idx',
  'project_template_status_mappings_source_idx',
];

interface TypedFixture {
  tenantId: string;
  templateId: string;
  tenantStatusId: string;
  standardStatusId: string;
  ambiguousId: string;
  missingId: string;
}

/**
 * Create a tenant and the canonical five-row legacy fixture: a tenant status, a
 * standard-catalog status, an inline custom status, a quarantined missing UUID,
 * and a UUID present in both catalogs (quarantined ambiguous). After up() the
 * standard row writes standard_status_id and the unresolved rows write
 * unresolved_status_id, which is the shape down() must collapse back safely.
 */
async function createTypedFixture(knex: Knex | Knex.Transaction): Promise<TypedFixture> {
  const tenantId = await createFixtureTenant(knex);
  const templateId = uuidv4();
  await createTemplate(knex, tenantId, templateId);

  const tenantStatusId = uuidv4();
  await createTenantStatus(knex, tenantId, tenantStatusId, 1);

  const standardStatuses = await knex('standard_statuses')
    .where({ item_type: 'project_task' })
    .orderBy('standard_status_id')
    .limit(2)
    .select('standard_status_id');
  expect(standardStatuses).toHaveLength(2);
  const standardStatusId = standardStatuses[0].standard_status_id;
  const ambiguousId = standardStatuses[1].standard_status_id;
  await createTenantStatus(knex, tenantId, ambiguousId, 2);

  const missingId = uuidv4();

  await knex('project_template_status_mappings').insert([
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
      status_id: standardStatusId,
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
  ]);

  return { tenantId, templateId, tenantStatusId, standardStatusId, ambiguousId, missingId };
}

/** Assert the legacy shape after down(): every typed UUID collapsed into status_id. */
async function expectLegacyRows(
  knex: Knex | Knex.Transaction,
  fixture: TypedFixture
): Promise<void> {
  const rows = await knex('project_template_status_mappings')
    .where({ tenant: fixture.tenantId })
    .orderBy('display_order')
    .select('*');
  expect(rows).toHaveLength(5);

  const [tenantRow, standardRow, inlineRow, missingRow, ambiguousRow] = rows;

  expect(tenantRow.status_id).toBe(fixture.tenantStatusId);
  expect(tenantRow.custom_status_name).toBeNull();

  expect(standardRow.status_id).toBe(fixture.standardStatusId);
  expect(standardRow.custom_status_name).toBeNull();

  expect(inlineRow.status_id).toBeNull();
  expect(inlineRow.custom_status_name).toBe('Inline custom');

  expect(missingRow.status_id).toBe(fixture.missingId);
  expect(missingRow.custom_status_name).toBeNull();

  expect(ambiguousRow.status_id).toBe(fixture.ambiguousId);
  expect(ambiguousRow.custom_status_name).toBeNull();
}

/** Assert no typed column, CHECK, FK, or helper index survives down(). */
async function expectTypedSchemaGone(knex: Knex | Knex.Transaction): Promise<void> {
  const columns = await knex('information_schema.columns')
    .where({ table_schema: 'public', table_name: 'project_template_status_mappings' })
    .whereIn('column_name', TYPED_COLUMNS)
    .select('column_name');
  expect(columns).toHaveLength(0);

  const constraints = await knex('pg_constraint')
    .whereRaw("conrelid = 'project_template_status_mappings'::regclass")
    .whereIn('conname', TYPED_CONSTRAINTS)
    .select('conname');
  expect(constraints).toHaveLength(0);

  const indexes = await knex('pg_indexes')
    .where({ tablename: 'project_template_status_mappings' })
    .whereIn('indexname', TYPED_INDEXES)
    .select('indexname');
  expect(indexes).toHaveLength(0);
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

  it('down() collapses typed fixtures back to legacy shape and removes all typed schema', async () => {
    const trx = await knex.transaction();
    let testError: unknown;

    try {
      await migration.down(trx);

      const fixture = await createTypedFixture(trx);

      await migration.up(trx);
      const typedRows = await trx('project_template_status_mappings')
        .where({ tenant: fixture.tenantId })
        .orderBy('display_order')
        .select('*');
      expect(typedRows).toHaveLength(5);
      expect(typedRows.filter((row) => row.status_source === 'standard')).toHaveLength(1);
      expect(typedRows.filter((row) => row.status_source === 'unresolved')).toHaveLength(2);

      await migration.down(trx);

      await expectLegacyRows(trx, fixture);
      await expectTypedSchemaGone(trx);
    } catch (error) {
      testError = error;
    } finally {
      await trx.rollback();
    }

    if (testError) {
      throw testError;
    }
  });

  it('down() is a no-op on a table already in legacy shape', async () => {
    const trx = await knex.transaction();
    let testError: unknown;

    try {
      await migration.down(trx);
      await migration.down(trx);

      const fixture = await createTypedFixture(trx);
      await migration.down(trx);

      await expectLegacyRows(trx, fixture);
      await expectTypedSchemaGone(trx);
    } catch (error) {
      testError = error;
    } finally {
      await trx.rollback();
    }

    if (testError) {
      throw testError;
    }
  });

  it('up() after down() deterministically re-types collapsed rows', async () => {
    const trx = await knex.transaction();
    let testError: unknown;

    try {
      await migration.down(trx);
      const fixture = await createTypedFixture(trx);

      await migration.up(trx);
      await migration.down(trx);
      await migration.up(trx);

      const rows = await trx('project_template_status_mappings')
        .where({ tenant: fixture.tenantId })
        .orderBy('display_order')
        .select('*');
      expect(rows).toHaveLength(5);

      const [tenantRow, standardRow, inlineRow, missingRow, ambiguousRow] = rows;

      expect(tenantRow).toMatchObject({
        status_id: fixture.tenantStatusId,
        status_source: 'tenant',
      });
      expect(standardRow).toMatchObject({
        status_id: null,
        standard_status_id: fixture.standardStatusId,
        status_source: 'standard',
      });
      expect(inlineRow).toMatchObject({
        status_id: null,
        custom_status_name: 'Inline custom',
        status_source: 'inline',
      });
      expect(missingRow).toMatchObject({
        status_id: null,
        unresolved_status_id: fixture.missingId,
        unresolved_reason: 'missing',
        status_source: 'unresolved',
      });
      expect(ambiguousRow).toMatchObject({
        status_id: null,
        unresolved_status_id: fixture.ambiguousId,
        unresolved_reason: 'ambiguous',
        status_source: 'unresolved',
      });
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
